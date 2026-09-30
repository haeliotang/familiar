import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { LocalTranscriberBusy, transcribeLocal } from './asr'
import { cueFromMemory } from '../src/encounter'

export function registerTranscriptionRoutes(app: FastifyInstance, pool: pg.Pool, root: string, owner: (cookie: string | undefined) => Promise<string | null>, transcribe = transcribeLocal) {
  let busy = false
  const owned = (id: string, ownerId: string) => pool.query('SELECT a.kind,a.speaker_role,a.state FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND p.deleted_at IS NULL', [id, ownerId])
  const saved = async (id: string) => {
    const result = await pool.query('SELECT model_id,text,segments FROM asset_transcripts WHERE asset_id=$1', [id])
    const row = result.rows[0]
    return row ? { sourceAssetId: id, origin: 'user_memory_audio', modelId: row.model_id, text: row.text, segments: row.segments } : null
  }

  app.post('/v1/assets/:id/transcription/skip', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const asset = await owned(params.data.id, ownerId)
    if (!asset.rowCount) return reply.code(404).send({ code: 'not_found' })
    if (asset.rows[0].kind !== 'user_memory_audio' || asset.rows[0].speaker_role !== 'user') return reply.code(409).send({ code: 'not_memory_audio' })
    const updated = await pool.query("UPDATE source_assets a SET review_state=CASE WHEN a.review_state='pending' THEN 'skipped' ELSE a.review_state END FROM persons p WHERE a.id=$1 AND a.owner_id=$2 AND p.id=a.person_id AND p.deleted_at IS NULL RETURNING a.id", [params.data.id, ownerId])
    if (!updated.rowCount) return reply.code(404).send({ code: 'not_found' })
    return reply.code(204).send()
  })

  app.post('/v1/assets/:id/transcription/confirm', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    const body = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(request.body)
    if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_input' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const asset = await client.query("SELECT a.person_id,a.kind,a.speaker_role,a.state FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p,a", [params.data.id, ownerId])
      if (!asset.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'not_found' }) }
      const source = asset.rows[0]
      if (source.kind !== 'user_memory_audio' || source.speaker_role !== 'user' || source.state !== 'ready') { await client.query('ROLLBACK'); return reply.code(409).send({ code: 'not_memory_audio' }) }
      const transcript = await client.query<{ segments: Array<{ startSec: number; endSec: number }> }>('SELECT segments FROM asset_transcripts WHERE asset_id=$1', [params.data.id])
      if (!transcript.rowCount) { await client.query('ROLLBACK'); return reply.code(409).send({ code: 'transcript_not_ready' }) }
      const existing = await client.query('SELECT id,cue,usable FROM evidence WHERE source_asset_id=$1 AND text=$2', [params.data.id, body.data.text])
      if (existing.rowCount) {
        if (existing.rows[0].usable) await client.query("UPDATE source_assets SET review_state='confirmed' WHERE id=$1", [params.data.id])
        await client.query('COMMIT')
        if (!existing.rows[0].usable) return reply.code(409).send({ code: 'confirmation_retracted' })
        return { evidenceId: existing.rows[0].id, cue: existing.rows[0].cue }
      }
      const evidenceId = randomUUID()
      const cue = cueFromMemory(body.data.text)
      const locator = { confirmed: true, segments: transcript.rows[0].segments.map(({ startSec, endSec }) => ({ startSec, endSec })) }
      await client.query('UPDATE evidence SET usable=false WHERE source_asset_id=$1 AND usable=true', [params.data.id])
      await client.query("INSERT INTO evidence(id,person_id,text,cue,source_asset_id,origin,locator) VALUES($1,$2,$3,$4,$5,'user_memory_audio',$6)", [evidenceId, source.person_id, body.data.text, cue, params.data.id, JSON.stringify(locator)])
      await client.query('UPDATE persons SET revision=revision+1 WHERE id=$1', [source.person_id])
      await client.query("UPDATE source_assets SET review_state='confirmed' WHERE id=$1", [params.data.id])
      await client.query('COMMIT')
      return reply.code(201).send({ evidenceId, cue })
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  })

  app.route({ method: ['GET', 'POST'], url: '/v1/assets/:id/transcription', handler: async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const id = params.data.id
    const asset = await owned(id, ownerId)
    if (!asset.rowCount) return reply.code(404).send({ code: 'not_found' })
    if (asset.rows[0].kind !== 'user_memory_audio' || asset.rows[0].speaker_role !== 'user') return reply.code(409).send({ code: 'not_memory_audio' })
    if (asset.rows[0].state !== 'ready') return reply.code(409).send({ code: 'audio_not_ready' })
    const transcript = await saved(id)
    if (request.method === 'GET' || transcript) return { transcript }
    if (busy) return reply.code(429).send({ code: 'local_transcriber_busy' })
    busy = true
    try {
      const result = await transcribe(join(root, `${id}.wav`))
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const available = await client.query("SELECT a.id FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND a.kind='user_memory_audio' AND a.speaker_role='user' AND a.state='ready' AND p.deleted_at IS NULL FOR UPDATE OF p,a", [id, ownerId])
        if (!available.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'not_found' }) }
        await client.query('INSERT INTO asset_transcripts(asset_id,model_id,text,segments) VALUES($1,$2,$3,$4) ON CONFLICT(asset_id) DO NOTHING', [id, result.modelId, result.text, JSON.stringify(result.segments)])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
      return { transcript: await saved(id) }
    } catch (error) {
      if (!(await owned(id, ownerId)).rowCount) return reply.code(404).send({ code: 'not_found' })
      if (error instanceof LocalTranscriberBusy) return reply.code(429).send({ code: 'local_transcriber_busy' })
      return reply.code(503).send({ code: 'local_transcription_unavailable' })
    } finally { busy = false }
  } })
}
