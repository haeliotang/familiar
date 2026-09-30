import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { manifestContent } from '../src/manifest'

export function clipStandardWav(bytes: Buffer, startSec: number, endSec: number) {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || endSec - startSec > 30 || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('unsupported_audio')
  let format: Buffer | undefined
  let pcm: Buffer | undefined
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4)
    if (offset + 8 + size > bytes.length) throw new Error('unsupported_audio')
    const kind = bytes.toString('ascii', offset, offset + 4)
    if (kind === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size)
    if (kind === 'data') pcm = bytes.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + size % 2
  }
  if (!format || format.length < 16 || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000 || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16 || !pcm || pcm.length % 2) throw new Error('unsupported_audio')
  const from = Math.round(startSec * 16000) * 2
  const to = Math.round(endSec * 16000) * 2
  if (from >= to || to > pcm.length) throw new Error('unsupported_audio')
  const output = Buffer.alloc(44 + to - from)
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16); format.copy(output, 20, 0, 16)
  output.write('data', 36); output.writeUInt32LE(to - from, 40); pcm.copy(output, 44, from, to)
  return output
}

export function registerAudioClipRoutes(app: FastifyInstance, pool: pg.Pool, root: string, owner: (cookie: string | undefined) => Promise<string | null>, read: (path: string) => Promise<Buffer> = readFile) {
  app.get('/v1/assets/:id/audio-review/clip', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    const query = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(request.query)
    if (!params.success || !query.success) return reply.code(400).send({ code: 'invalid_input' })
    const available = () => pool.query("SELECT o.observations FROM source_assets a JOIN persons p ON p.id=a.person_id JOIN asset_audio_observations o ON o.asset_id=a.id WHERE a.id=$1 AND a.owner_id=$2 AND a.kind='deceased_audio' AND a.state='ready' AND p.deleted_at IS NULL", [params.data.id, ownerId])
    const current = await available()
    if (!current.rowCount) return reply.code(404).send({ code: 'not_found' })
    const observation = current.rows[0].observations
    const fingerprint = (value: Record<string, unknown>) => createHash('sha256').update(manifestContent(value)).digest('hex')
    if (fingerprint(observation) !== query.data.fingerprint) return reply.code(409).send({ code: 'audio_observation_changed' })
    let audio
    try {
      const bytes = await read(join(root, `${params.data.id}.wav`))
      if (createHash('sha256').update(bytes).digest('hex') !== observation.normalizedAudioSha256) throw new Error('source_changed')
      audio = clipStandardWav(bytes, observation.selectedWindow.startSec, observation.selectedWindow.endSec)
    } catch { return reply.code(503).send({ code: 'audio_analysis_unavailable' }) }
    const again = await available()
    if (!again.rowCount) return reply.code(404).send({ code: 'not_found' })
    if (fingerprint(again.rows[0].observations) !== query.data.fingerprint) return reply.code(409).send({ code: 'audio_observation_changed' })
    return reply.type('audio/wav').send(audio)
  })
}
