import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { normalizePhoto, PhotoDecoderUnavailable } from './normalize-photo'
import { z } from 'zod'

const run = promisify(execFile)
const uuid = z.string().uuid()
const intent = z.object({
  personId: uuid,
  kind: z.enum(['photo', 'deceased_audio', 'user_memory_audio']),
  mediaType: z.string(),
  sizeBytes: z.number().int().positive(),
})
const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const audioTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/ogg'])

function paths(root: string, id: string) {
  return { raw: join(root, `${id}.upload`), image: join(root, `${id}.jpg`), audio: join(root, `${id}.wav`) }
}

async function remove(path: string) {
  try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function cleanupDeletedAssets(pool: pg.Pool, root: string, personId?: string) {
  const result = await pool.query<{ id: string }>('SELECT a.id FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE p.deleted_at IS NOT NULL AND ($1::uuid IS NULL OR p.id=$1)', [personId || null])
  for (const row of result.rows) {
    const files = paths(root, row.id)
    await Promise.all([remove(files.raw), remove(files.image), remove(files.audio)])
    await pool.query('DELETE FROM source_assets WHERE id=$1', [row.id])
  }
}

export function registerAssetRoutes(app: FastifyInstance, pool: pg.Pool, root: string, owner: (cookie: string | undefined) => Promise<string | null>) {
  const processing = new Map<string, Promise<void>>()

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 30 * 1024 * 1024 }, (_request, body, done) => done(null, body))

  app.post('/v1/assets/upload-intents', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const parsed = intent.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'invalid_input' })
    const { personId, kind, mediaType, sizeBytes } = parsed.data
    const max = kind === 'photo' ? 20 * 1024 * 1024 : 30 * 1024 * 1024
    const supported = kind === 'photo' ? photoTypes : audioTypes
    if (sizeBytes > max || !supported.has(mediaType)) return reply.code(415).send({ code: 'unsupported_media' })
    const speakerRole = kind === 'deceased_audio' ? 'deceased' : kind === 'user_memory_audio' ? 'user' : 'none'
    const id = randomUUID()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM sessions WHERE id=$1 FOR UPDATE', [ownerId])
      const person = await client.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [personId, ownerId])
      if (!person.rowCount) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ code: 'not_found' })
      }
      if (kind === 'photo') {
        const photos = await client.query<{ count: number }>("SELECT count(*)::integer AS count FROM source_assets WHERE person_id=$1 AND kind='photo' AND state<>'rejected'", [personId])
        if (photos.rows[0].count >= 5) {
          await client.query('ROLLBACK')
          return reply.code(409).send({ code: 'photo_limit' })
        }
      }
      const usage = await client.query<{ bytes: number }>("SELECT coalesce(sum(expected_bytes),0)::integer AS bytes FROM source_assets WHERE owner_id=$1 AND state<>'rejected'", [ownerId])
      if (usage.rows[0].bytes + sizeBytes > 256 * 1024 * 1024) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ code: 'storage_limit' })
      }
      await client.query('INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, ownerId, personId, kind, speakerRole, mediaType, sizeBytes])
      await client.query('COMMIT')
      return reply.code(201).send({ assetId: id, uploadUrl: `/v1/assets/${id}/content`, maxBytes: max })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })

  app.put('/v1/assets/:id/content', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: uuid }).safeParse(request.params)
    if (!params.success || !Buffer.isBuffer(request.body)) return reply.code(400).send({ code: 'invalid_input' })
    const asset = await pool.query<{ expected_bytes: number; state: string; sha256: string | null }>("SELECT a.expected_bytes,a.state,a.sha256 FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND a.state IN ('awaiting_upload','uploaded') AND p.deleted_at IS NULL", [params.data.id, ownerId])
    if (!asset.rowCount) return reply.code(404).send({ code: 'not_found' })
    const body = request.body as Buffer
    if (body.length !== asset.rows[0].expected_bytes) return reply.code(400).send({ code: 'size_mismatch' })
    const sha256 = createHash('sha256').update(body).digest('hex')
    if (asset.rows[0].state === 'uploaded') return asset.rows[0].sha256 === sha256 ? reply.code(202).send({ assetId: params.data.id, state: 'uploaded' }) : reply.code(409).send({ code: 'content_conflict' })
    await mkdir(root, { recursive: true, mode: 0o700 })
    const file = paths(root, params.data.id).raw
    try {
      await writeFile(file, body, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await readFile(file)
      if (createHash('sha256').update(existing).digest('hex') !== sha256) return reply.code(409).send({ code: 'content_conflict' })
    }
    const updated = await pool.query("UPDATE source_assets a SET state='uploaded',size_bytes=$3,sha256=$4 FROM persons p WHERE a.id=$1 AND a.owner_id=$2 AND a.state='awaiting_upload' AND p.id=a.person_id AND p.deleted_at IS NULL RETURNING a.id", [params.data.id, ownerId, body.length, sha256])
    if (!updated.rowCount) { await remove(file); return reply.code(404).send({ code: 'not_found' }) }
    return reply.code(202).send({ assetId: params.data.id, state: 'uploaded' })
  })

  app.post('/v1/assets/:id/complete', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: uuid }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const id = params.data.id
    const previous = processing.get(id) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const queued = previous.then(() => current)
    processing.set(id, queued)
    await previous
    try {
      const asset = await pool.query<{ kind: string; state: string }>("SELECT a.kind,a.state FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND a.state IN ('uploaded','ready') AND p.deleted_at IS NULL", [params.data.id, ownerId])
      if (!asset.rowCount) return reply.code(404).send({ code: 'not_found' })
      if (asset.rows[0].state === 'ready') return { assetId: params.data.id, state: 'ready' }
      const file = paths(root, params.data.id)
      const output = asset.rows[0].kind === 'photo' ? file.image : file.audio
      try {
        if (asset.rows[0].kind === 'photo') {
          await normalizePhoto(file.raw, output)
        } else {
          const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file.raw], { timeout: 10_000 })
          const info = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string }> }
          const duration = Number(info.format?.duration)
          if (!info.streams?.some(stream => stream.codec_type === 'audio') || (Number.isFinite(duration) && (duration <= 0 || duration > 180))) throw new Error('invalid_audio')
          await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', file.raw, '-vn', '-t', '181', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output], { timeout: 30_000 })
          const normalized = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output], { timeout: 10_000 })
          const decodedDuration = Number((JSON.parse(normalized.stdout) as { format?: { duration?: string } }).format?.duration)
          if (!Number.isFinite(decodedDuration) || decodedDuration <= 0 || decodedDuration > 180) throw new Error('invalid_audio')
        }
      } catch (error) {
        if (error instanceof PhotoDecoderUnavailable) return reply.code(503).send({ code: 'photo_decoder_unavailable' })
        if (asset.rows[0].kind !== 'photo' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await remove(output)
          return reply.code(503).send({ code: 'audio_processor_unavailable' })
        }
        await Promise.all([remove(file.raw), remove(output)])
        await pool.query("UPDATE source_assets SET state='rejected' WHERE id=$1 AND state='uploaded'", [params.data.id])
        return reply.code(422).send({ code: 'invalid_media' })
      }
      const updated = await pool.query("UPDATE source_assets a SET state='ready',object_key=$3 FROM persons p WHERE a.id=$1 AND a.owner_id=$2 AND a.state='uploaded' AND p.id=a.person_id AND p.deleted_at IS NULL RETURNING a.id", [params.data.id, ownerId, output])
      await remove(file.raw)
      if (!updated.rowCount) { await remove(output); return reply.code(404).send({ code: 'not_found' }) }
      return { assetId: params.data.id, state: 'ready' }
    } finally {
      release()
      if (processing.get(id) === queued) processing.delete(id)
    }
  })

  app.get('/v1/persons/:id/assets', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: uuid }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const person = await pool.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [params.data.id, ownerId])
    if (!person.rowCount) return reply.code(404).send({ code: 'not_found' })
    const result = await pool.query('SELECT id,kind,speaker_role,state,review_state FROM source_assets WHERE person_id=$1 ORDER BY created_at', [params.data.id])
    reply.header('Cache-Control', 'private, no-store')
    return { assets: result.rows.map(row => ({ assetId: row.id, kind: row.kind, speakerRole: row.speaker_role, state: row.state, reviewState: row.review_state })) }
  })
}
