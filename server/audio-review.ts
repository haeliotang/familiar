import { createHash } from 'node:crypto'
import { manifestContent } from '../src/manifest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { estimateChineseSpeechRate } from './speech-rate'

export function registerAudioReviewRoutes(app: FastifyInstance, pool: pg.Pool, owner: (cookie: string | undefined) => Promise<string | null>) {
  app.route({ method: ['GET', 'POST'], url: '/v1/assets/:id/audio-review', handler: async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const body = request.method === 'POST' ? z.object({
      normalizedAudioSha256: z.string().regex(/^[a-f0-9]{64}$/), observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      startSec: z.number().finite().min(0).max(180), endSec: z.number().finite().positive().max(180),
      subject: z.enum(['single_person', 'mixed', 'uncertain']), text: z.string().trim().max(500).default(''),
    }).refine(value => value.endSec > value.startSec && value.endSec - value.startSec <= 30).safeParse(request.body) : null
    if (body && !body.success) return reply.code(400).send({ code: 'invalid_input' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const asset = await client.query("SELECT a.person_id FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND a.kind='deceased_audio' AND a.speaker_role='deceased' AND a.state='ready' AND p.deleted_at IS NULL FOR UPDATE OF p,a", [params.data.id, ownerId])
      if (!asset.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'not_found' }) }
      const saved = await client.query('SELECT observations,review FROM asset_audio_observations WHERE asset_id=$1 FOR UPDATE', [params.data.id])
      if (!saved.rowCount) { await client.query('ROLLBACK'); return reply.code(409).send({ code: 'audio_observation_not_ready' }) }
      const { observations, review } = saved.rows[0]
      const observationFingerprint = createHash('sha256').update(manifestContent(observations)).digest('hex')
      if (request.method === 'GET') {
        await client.query('COMMIT')
        const current = review?.observationFingerprint === observationFingerprint && review?.normalizedAudioSha256 === observations.normalizedAudioSha256 && review?.selectedWindow?.startSec === observations.selectedWindow.startSec && review?.selectedWindow?.endSec === observations.selectedWindow.endSec
        return { review: current ? review : null, observationFingerprint }
      }
      if (!body?.success) { await client.query('ROLLBACK'); return reply.code(400).send({ code: 'invalid_input' }) }
      const input = body.data
      if (input.observationFingerprint !== observationFingerprint || input.normalizedAudioSha256 !== observations.normalizedAudioSha256 || input.startSec !== observations.selectedWindow.startSec || input.endSec !== observations.selectedWindow.endSec) {
        await client.query('ROLLBACK'); return reply.code(409).send({ code: 'audio_observation_changed' })
      }
      const estimate = input.subject === 'single_person' && observations.speechActivity?.status === 'measured'
        ? estimateChineseSpeechRate(input.text, observations.speechActivity.speechDurationSec, input.endSec - input.startSec) : null
      const confirmed = { observationFingerprint, normalizedAudioSha256: input.normalizedAudioSha256, selectedWindow: observations.selectedWindow, subject: input.subject, text: input.text, confirmationSource: 'user', rateEstimate: estimate ? { ...estimate, reviewStatus: 'user_confirmed_text' } : null }
      const changed = await client.query('UPDATE asset_audio_observations SET review=$2 WHERE asset_id=$1 AND review IS DISTINCT FROM $2::jsonb RETURNING asset_id', [params.data.id, confirmed])
      if (changed.rowCount) await client.query('UPDATE persons SET revision=revision+1 WHERE id=$1', [asset.rows[0].person_id])
      await client.query('COMMIT')
      return { review: confirmed, observationFingerprint }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  } })
}
