import { registerAudioObservationRoutes } from './audio-observations'
import { episodeManifest } from './episode-manifest'
import { registerPreparationRoutes } from './preparations'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { cueFromMemory, type Cue } from '../src/encounter'
import { registerHealthRoutes } from './health'
import { registerAssetRoutes } from './assets'
import { registerTtsRoutes } from './tts'
import { processDeletionJobs, registerDeletionRoutes } from './deletions'
import { registerTranscriptionRoutes } from './transcriptions'

const uuid = z.string().uuid()
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

function cookieToken(header: string | undefined) {
  return header?.split(';').map(part => part.trim()).find(part => part.startsWith('of_session='))?.slice(11)
}

export function createApp(pool: pg.Pool, assetRoot?: string) {
const app = Fastify({ logger: false })
registerHealthRoutes(app, pool)

async function owner(cookie: string | undefined) {
  const token = cookieToken(cookie)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const result = await pool.query<{ id: string }>('SELECT id FROM sessions WHERE token_hash=$1', [hash(token)])
  return result.rows[0]?.id || null
}

if (assetRoot) registerAssetRoutes(app, pool, assetRoot, owner)
if (assetRoot) registerAudioObservationRoutes(app, pool, assetRoot, owner)
if (assetRoot) registerTranscriptionRoutes(app, pool, assetRoot, owner)
registerTtsRoutes(app, pool, owner)
registerPreparationRoutes(app, pool, owner, assetRoot)
registerDeletionRoutes(app, pool, owner)
let cleaner: ReturnType<typeof setInterval> | undefined
let cleaning: Promise<void> | undefined
function clean() {
  cleaning ||= processDeletionJobs(pool, assetRoot).catch(error => { app.log.error(error) }).finally(() => { cleaning = undefined })
  return cleaning
}
app.addHook('onReady', async () => { await clean(); cleaner = setInterval(() => { void clean() }, 60_000); cleaner.unref() })
app.addHook('preClose', async () => { clearInterval(cleaner); await cleaning })

app.post('/v1/sessions/anonymous', async (_request, reply) => {
  const token = randomBytes(32).toString('hex')
  await pool.query('INSERT INTO sessions(id, token_hash) VALUES($1,$2)', [randomUUID(), hash(token)])
  reply.header('Set-Cookie', `of_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
  return reply.code(201).send({ ok: true })
})

app.get('/v1/sessions/current', async (request, reply) => {
  return (await owner(request.headers.cookie)) ? { ok: true } : reply.code(401).send({ code: 'unauthorized' })
})

app.get('/v1/persons', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const result = await pool.query('SELECT id,revision FROM persons WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [ownerId])
  return { persons: result.rows.map(row => ({ personId: row.id, revision: row.revision })) }
})

app.post('/v1/persons', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const parsed = z.object({ label: z.string().max(100).optional() }).safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ code: 'invalid_input' })
  const id = randomUUID()
  await pool.query('INSERT INTO persons(id, owner_id, label) VALUES($1,$2,$3)', [id, ownerId, parsed.data.label || null])
  return reply.code(201).send({ personId: id, revision: 1 })
})

app.post('/v1/persons/:id/memories', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  const body = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(request.body)
  if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_input' })
  const evidenceId = randomUUID()
  const cue = cueFromMemory(body.data.text)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const person = await client.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [params.data.id, ownerId])
    if (!person.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ code: 'not_found' })
    }
    await client.query('INSERT INTO evidence(id,person_id,text,cue) VALUES($1,$2,$3,$4)', [evidenceId, params.data.id, body.data.text, cue])
    await client.query('UPDATE persons SET revision=revision+1 WHERE id=$1', [params.data.id])
    await client.query('COMMIT')
    return reply.code(201).send({ evidenceId, cue })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/persons/:id/episodes', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  const key = request.headers['idempotency-key']
  if (!params.success || typeof key !== 'string' || key.length < 8 || key.length > 128) return reply.code(400).send({ code: 'invalid_input' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const person = await client.query('SELECT revision FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [params.data.id, ownerId])
    if (!person.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ code: 'not_found' })
    }
    const existing = await client.query('SELECT id,status,person_id FROM episodes WHERE owner_id=$1 AND idempotency_key=$2', [ownerId, key])
    if (existing.rowCount) {
      await client.query('COMMIT')
      if (existing.rows[0].person_id !== params.data.id) return reply.code(409).send({ code: 'idempotency_conflict' })
      if (existing.rows[0].status === 'revoked') return reply.code(404).send({ code: 'not_found' })
      return reply.send({ episodeId: existing.rows[0].id, status: existing.rows[0].status })
    }
    const evidence = await client.query<{ id: string; cue: Cue; text: string }>('SELECT id,cue,text FROM evidence WHERE person_id=$1 AND usable=true ORDER BY created_at DESC LIMIT 1', [params.data.id])
    const assets = evidence.rowCount ? null : await client.query("SELECT id FROM source_assets WHERE person_id=$1 AND state='ready' LIMIT 1", [params.data.id])
    if (!evidence.rowCount && !assets?.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ code: 'no_usable_evidence' })
    }
    const episodeId = randomUUID()
    const previous = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM episodes WHERE person_id=$1', [params.data.id])
    const cue = evidence.rowCount ? cueFromMemory(evidence.rows[0].text) : 'general'
    const evidenceId = evidence.rows[0]?.id || null
    const published = episodeManifest(episodeId, person.rows[0].revision, evidenceId, cue, previous.rows[0].count)
    const inserted = await client.query("INSERT INTO episodes(id,owner_id,person_id,person_revision,evidence_id,idempotency_key,manifest,status) VALUES($1,$2,$3,$4,$5,$6,$7,'prototype') ON CONFLICT(owner_id,idempotency_key) DO NOTHING RETURNING id,status", [episodeId, ownerId, params.data.id, person.rows[0].revision, evidenceId, key, published])
    if (!inserted.rowCount) {
      const raced = await client.query('SELECT id,status,person_id FROM episodes WHERE owner_id=$1 AND idempotency_key=$2', [ownerId, key])
      await client.query('COMMIT')
      if (raced.rows[0].person_id !== params.data.id) return reply.code(409).send({ code: 'idempotency_conflict' })
      if (raced.rows[0].status === 'revoked') return reply.code(404).send({ code: 'not_found' })
      return reply.send({ episodeId: raced.rows[0].id, status: raced.rows[0].status })
    }
    await client.query('COMMIT')
    return reply.code(201).send({ episodeId, status: 'prototype' })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.post('/v1/evidence/:id/retract', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const evidence = await client.query('SELECT e.person_id,e.usable FROM evidence e JOIN persons p ON p.id=e.person_id WHERE e.id=$1 AND p.owner_id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p', [params.data.id, ownerId])
    if (!evidence.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ code: 'not_found' })
    }
    if (evidence.rows[0].usable) {
      await client.query('UPDATE evidence SET usable=false WHERE id=$1', [params.data.id])
      await client.query('UPDATE persons SET revision=revision+1 WHERE id=$1', [evidence.rows[0].person_id])
    }
    await client.query('COMMIT')
    return { status: 'retracted' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})

app.get('/v1/persons/:id/episodes', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const person = await pool.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [params.data.id, ownerId])
  if (!person.rowCount) return reply.code(404).send({ code: 'not_found' })
  const episodes = await pool.query('SELECT ep.id,ep.status,ep.manifest,ep.created_at,(ev.usable=false) AS retracted FROM episodes ep LEFT JOIN evidence ev ON ev.id=ep.evidence_id WHERE ep.person_id=$1 ORDER BY ep.created_at DESC', [params.data.id])
  return { episodes: episodes.rows.map(row => ({ episodeId: row.id, status: row.status, manifest: row.manifest, createdAt: row.created_at, retracted: row.retracted })) }
})

app.get('/v1/episodes/:id', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const result = await pool.query("SELECT ep.status,ep.manifest,(ev.usable=false) AS retracted FROM episodes ep JOIN persons p ON p.id=ep.person_id LEFT JOIN evidence ev ON ev.id=ep.evidence_id WHERE ep.id=$1 AND ep.owner_id=$2 AND p.deleted_at IS NULL AND ep.status<>'revoked'", [params.data.id, ownerId])
  if (!result.rowCount) return reply.code(404).send({ code: 'not_found' })
  return result.rows[0]
})

app.post('/v1/episodes/:id/hide', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const result = await pool.query("UPDATE episodes ep SET status='revoked',evidence_id=NULL,manifest='{}'::jsonb,retained_voice_base64=NULL FROM persons p WHERE ep.id=$1 AND ep.owner_id=$2 AND p.id=ep.person_id AND p.deleted_at IS NULL AND ep.status<>'revoked' RETURNING ep.id", [params.data.id, ownerId])
  return result.rowCount ? reply.code(204).send() : reply.code(404).send({ code: 'not_found' })
})

app.get('/v1/episodes/:id/feedback', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const result = await pool.query("SELECT f.experience,f.issue,f.comment FROM episodes ep JOIN persons p ON p.id=ep.person_id LEFT JOIN episode_feedback f ON f.episode_id=ep.id WHERE ep.id=$1 AND ep.owner_id=$2 AND p.deleted_at IS NULL AND ep.status<>'revoked'", [params.data.id, ownerId])
  if (!result.rowCount) return reply.code(404).send({ code: 'not_found' })
  reply.header('Cache-Control', 'private, no-store')
  return { feedback: result.rows[0].experience || result.rows[0].issue || result.rows[0].comment ? result.rows[0] : null }
})

app.post('/v1/episodes/:id/feedback', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  const body = z.object({
    experience: z.enum(['familiar', 'unfamiliar', 'uncertain']).optional(),
    issue: z.enum(['incorrect_detail', 'unnatural_voice', 'slow_preparation', 'other']).optional(),
    comment: z.string().trim().max(500).optional(),
  }).strict().refine(value => Boolean(value.experience || value.issue || value.comment)).safeParse(request.body)
  if (!params.success || !body.success) return reply.code(400).send({ code: 'invalid_input' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const episode = await client.query("SELECT ep.id FROM episodes ep JOIN persons p ON p.id=ep.person_id WHERE ep.id=$1 AND ep.owner_id=$2 AND p.deleted_at IS NULL AND ep.status<>'revoked' FOR UPDATE OF p,ep", [params.data.id, ownerId])
    if (!episode.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ code: 'not_found' })
    }
    await client.query('INSERT INTO episode_feedback(episode_id,experience,issue,comment) VALUES($1,$2,$3,$4) ON CONFLICT(episode_id) DO UPDATE SET experience=excluded.experience,issue=excluded.issue,comment=excluded.comment,updated_at=now()', [params.data.id, body.data.experience || null, body.data.issue || null, body.data.comment || null])
    await client.query('COMMIT')
    return reply.code(204).send()
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
})

app.delete('/v1/persons/:id', async (request, reply) => {
  const ownerId = await owner(request.headers.cookie)
  if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
  const params = z.object({ id: uuid }).safeParse(request.params)
  if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
  const client = await pool.connect()
  let deletionJobId: string
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 FOR UPDATE', [params.data.id, ownerId])
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ code: 'not_found' })
    }
    await client.query('UPDATE persons SET deleted_at=coalesce(deleted_at,now()),label=NULL WHERE id=$1', [params.data.id])
    await client.query("UPDATE episodes SET status='revoked', evidence_id=NULL, manifest='{}'::jsonb,retained_voice_base64=NULL WHERE person_id=$1", [params.data.id])
    await client.query('DELETE FROM episode_feedback WHERE episode_id IN (SELECT id FROM episodes WHERE person_id=$1)', [params.data.id])
    await client.query("UPDATE preparation_jobs SET status='cancelled',episode_id=NULL,error_code=NULL,attempt_metrics='[]'::jsonb WHERE person_id=$1", [params.data.id])
    await client.query('DELETE FROM evidence WHERE person_id=$1', [params.data.id])
    await client.query('DELETE FROM asset_audio_observations WHERE asset_id IN (SELECT id FROM source_assets WHERE person_id=$1)', [params.data.id])
    await client.query('DELETE FROM asset_transcripts WHERE asset_id IN (SELECT id FROM source_assets WHERE person_id=$1)', [params.data.id])
    const job = await client.query('INSERT INTO deletion_jobs(id,person_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(person_id) DO UPDATE SET person_id=excluded.person_id RETURNING id', [randomUUID(), params.data.id, ownerId])
    await client.query('COMMIT')
    deletionJobId = job.rows[0].id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  await clean()
  return reply.code(202).send({ status: 'revoked', deletionJobId })
})

return app
}
