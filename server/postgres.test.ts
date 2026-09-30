import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createApp } from './index'
import { processPreparationJobs } from './preparations'
import Fastify from 'fastify'
import { registerTtsRoutes } from './tts'
import { registerTranscriptionRoutes } from './transcriptions'
import { createHash, randomUUID } from 'node:crypto'
import { observeAudio, registerAudioObservationRoutes } from './audio-observations'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('PostgreSQL integration', () => {
  it('measures normalized synthetic audio, isolates it and deletes observations', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const root = await mkdtemp(join(tmpdir(), 'friend-audio-observations-'))
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    const app = createApp(pool, root)
    try {
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const audio = await readFile(new URL('../public/assets/voices/kokoro-zh-zm009-v1/general.wav', import.meta.url))
      const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'deceased_audio', mediaType: 'audio/wav', sizeBytes: audio.length } })
      const id = intent.json().assetId
      await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: audio })
      expect((await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })).statusCode).toBe(200)
      const path = `/v1/assets/${id}/audio-observations`
      for (const method of ['GET', 'POST'] as const) expect((await app.inject({ method, url: path, headers: { cookie: foreign } })).statusCode).toBe(404)
      const measured = await app.inject({ method: 'POST', url: path, headers: { cookie } })
      expect(measured.statusCode).toBe(200)
      expect(measured.json()).toMatchObject({ sourceAssetId: id, observations: { analyzerVersion: 'signal-window-v1', subjectAttribution: 'unverified', speechRate: null } })
      expect(measured.json().observations.normalizedAudioSha256).toBe(createHash('sha256').update(await readFile(join(root, `${id}.wav`))).digest('hex'))
      expect(measured.json().observations.speechActivity.status).toBe('measured')
      expect(measured.json().observations.speechActivity.speechDurationSec).toBeGreaterThan(0)
      expect((await app.inject({ method: 'POST', url: path, headers: { cookie } })).json()).toEqual(measured.json())
      expect((await app.inject({ url: path, headers: { cookie } })).json()).toEqual(measured.json())
      await pool.query('DELETE FROM asset_audio_observations WHERE asset_id=$1', [id])
      for (const unavailable of [false, true]) {
        const queued = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': `audio-observed-task-${unavailable}` } })
        await processPreparationJobs(pool, undefined, root, unavailable ? async () => { throw new Error('synthetic_analysis_failure') } : undefined)
        const status = await app.inject({ url: queued.json().statusUrl, headers: { cookie } })
        expect(status.json().status).toBe('completed')
        const episode = await app.inject({ url: `/v1/episodes/${status.json().episodeId}`, headers: { cookie } })
        expect(episode.json().manifest).toMatchObject({ schemaVersion: '1.3', degraded: unavailable, personalizationLevel: 'generic', audioObservation: { sourceAssetId: id, status: unavailable ? 'unavailable' : 'measured', subjectAttribution: 'unverified' }, audioPlan: { voiceMode: 'standard_voice_without_transfer', cadenceEvidenceIds: [] } })
        expect(status.json().attemptMetrics[0].stages.map((item: { stage: string }) => item.stage)).toContain('audio_signal_observation')
        if (!unavailable) {
          expect(episode.json().manifest.audioObservation.normalizedAudioSha256).toBe(measured.json().observations.normalizedAudioSha256)
          expect((await pool.query('SELECT asset_id FROM asset_audio_observations WHERE asset_id=$1', [id])).rows).toHaveLength(1)
        }
      }
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(404)
      expect((await pool.query('SELECT attempt_metrics FROM preparation_jobs WHERE person_id=$1', [personId])).rows.every(row => row.attempt_metrics.length === 0)).toBe(true)
      expect((await pool.query('SELECT asset_id FROM asset_audio_observations WHERE asset_id=$1', [id])).rows).toEqual([])
    } finally { await app.close(); await pool.end(); await rm(root, { recursive: true, force: true }) }
  })

  it('rejects analysis that finishes after the person is deleted', async () => {
    const pool = new pg.Pool({ connectionString: url })
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    const app = createApp(pool)
    const analysis = Fastify()
    let started!: () => void
    let finish!: () => void
    const reached = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { finish = resolve })
    try {
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const ownerId = (await pool.query<{ owner_id: string }>('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
      const id = randomUUID()
      await pool.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'deceased_audio','deceased','audio/wav',100,'ready')", [id, ownerId, personId])
      registerAudioObservationRoutes(analysis, pool, '/synthetic-test', async () => ownerId, async () => { started(); await released; return { ...observeAudio(new Float32Array(16000 * 3), 16000), normalizedAudioSha256: 'synthetic-only', selectionMethod: 'bounded_energy_v1', rateObservation: { status: 'unavailable' }, speechActivity: { status: 'unavailable' as const, modelId: 'silero-vad-v4' } } })
      const pending = analysis.inject({ method: 'POST', url: `/v1/assets/${id}/audio-observations` })
      await reached
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      finish()
      expect((await pending).statusCode).toBe(404)
      expect((await pool.query('SELECT asset_id FROM asset_audio_observations WHERE asset_id=$1', [id])).rows).toEqual([])
    } finally { finish?.(); await analysis.close(); await app.close(); await pool.end() }
  })

  it('publishes a persisted preparation once when two workers claim the same queued job', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成多 worker：回头等我' } })
      const headers = { cookie, 'idempotency-key': `persisted-workers-${randomUUID()}` }
      const submissions = await Promise.all([0, 1].map(() => app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers })))
      expect(submissions.map(result => result.statusCode)).toEqual([202, 202])
      expect(submissions[0].json().preparationId).toBe(submissions[1].json().preparationId)
      let snapshots = 0
      let release!: () => void
      const bothRead = new Promise<void>(resolve => { release = resolve })
      const workers = {
        connect: () => pool.connect(),
        query: async (text: string, values?: unknown[]) => {
          const result = await pool.query(text, values)
          if (text.startsWith('SELECT id,person_id FROM preparation_jobs')) {
            expect(result.rows.some(row => row.id === submissions[0].json().preparationId)).toBe(true)
            if (++snapshots === 2) release()
            await bothRead
          }
          return result
        },
      } as unknown as pg.Pool
      await Promise.all([processPreparationJobs(workers), processPreparationJobs(workers)])
      expect(snapshots).toBe(2)
      const statusUrl = submissions[0].json().statusUrl
      const result = await app.inject({ url: statusUrl, headers: { cookie } })
      expect(result.json()).toMatchObject({ status: 'completed', attempts: 1, providerCostUsd: 0 })
      const episodeId = result.json().episodeId
      expect((await pool.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([{ id: episodeId }])
      expect((await app.inject({ url: statusUrl, headers: { cookie: foreign } })).statusCode).toBe(404)
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      await Promise.all([processPreparationJobs(pool), processPreparationJobs(pool)])
      expect((await app.inject({ url: statusUrl, headers: { cookie } })).statusCode).toBe(404)
      expect((await pool.query('SELECT status,episode_id FROM preparation_jobs WHERE id=$1', [submissions[0].json().preparationId])).rows[0]).toEqual({ status: 'cancelled', episode_id: null })
      expect((await pool.query('SELECT status,manifest FROM episodes WHERE id=$1', [episodeId])).rows[0]).toEqual({ status: 'revoked', manifest: {} })
    } finally { await app.close(); await pool.end() }
  })

  it('isolates competing episode retry keys across persons and revocation', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const persons: string[] = []
      for (let index = 0; index < 2; index++) {
        const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
        persons.push(personId)
        await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成并发重试：回头等我' } })
      }
      const headers = { cookie, 'idempotency-key': `competing-persons-${randomUUID()}` }
      const results = await Promise.all(persons.map(personId => app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers })))
      expect(results.map(result => result.statusCode).sort()).toEqual([201, 409])
      const winner = results.findIndex(result => result.statusCode === 201)
      const episodeId = results[winner].json().episodeId
      expect(results[1 - winner].json()).toEqual({ code: 'idempotency_conflict' })
      const stored = await pool.query('SELECT id,person_id FROM episodes WHERE idempotency_key=$1', [headers['idempotency-key']])
      expect(stored.rows).toEqual([{ id: episodeId, person_id: persons[winner] }])
      const retry = () => app.inject({ method: 'POST', url: `/v1/persons/${persons[winner]}/episodes`, headers })
      expect((await retry()).json().episodeId).toBe(episodeId)
      await app.inject({ method: 'POST', url: `/v1/episodes/${episodeId}/hide`, headers: { cookie } })
      expect((await retry()).statusCode).toBe(404)
      await app.inject({ method: 'DELETE', url: `/v1/persons/${persons[winner]}`, headers: { cookie } })
      expect((await retry()).statusCode).toBe(404)
    } finally { await app.close(); await pool.end() }
  })

  it('deduplicates transcript confirmation and clears concurrent confirmation on deletion', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    const speech = Fastify()
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const ownerId = (await pool.query('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
      const assetId = randomUUID()
      await pool.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'user_memory_audio','user','audio/wav',100,'ready')", [assetId, ownerId, personId])
      registerTranscriptionRoutes(speech, pool, '/synthetic-test', async () => ownerId, async () => ({ modelId: 'synthetic-asr', text: '合成测试：回头等我', segments: [{ startSec: 0, endSec: 2, text: '合成测试' }] }))
      const path = `/v1/assets/${assetId}/transcription`
      expect((await speech.inject({ method: 'POST', url: path })).statusCode).toBe(200)
      const request = { method: 'POST' as const, url: `${path}/confirm`, payload: { text: '合成测试：回头等我' } }
      const confirmed = await Promise.all([speech.inject(request), speech.inject(request)])
      expect(confirmed.map(response => response.statusCode).sort()).toEqual([200, 201])
      expect(confirmed[0].json().evidenceId).toBe(confirmed[1].json().evidenceId)
      expect((await pool.query('SELECT id FROM evidence WHERE person_id=$1', [personId])).rows).toHaveLength(1)
      expect((await pool.query('SELECT revision FROM persons WHERE id=$1', [personId])).rows[0].revision).toBe(2)
      const [late, deleted] = await Promise.all([
        speech.inject({ ...request, payload: { text: '合成测试：会修东西' } }),
        app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } }),
      ])
      expect([201, 404]).toContain(late.statusCode)
      expect(deleted.statusCode).toBe(202)
      expect((await pool.query('SELECT id FROM evidence WHERE person_id=$1', [personId])).rows).toEqual([])
      expect((await pool.query('SELECT asset_id FROM asset_transcripts WHERE asset_id=$1', [assetId])).rows).toEqual([])
      expect((await speech.inject(request)).statusCode).toBe(404)
    } finally { await speech.close(); await app.close(); await pool.end() }
  })

  it('does not publish a transcript that finishes after person deletion', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    const speech = Fastify()
    let started!: () => void
    let finish!: () => void
    const reached = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { finish = resolve })
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const ownerId = (await pool.query('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
      const assetId = randomUUID()
      await pool.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'user_memory_audio','user','audio/wav',100,'ready')", [assetId, ownerId, personId])
      registerTranscriptionRoutes(speech, pool, '/synthetic-test', async () => ownerId, async () => { started(); await released; return { modelId: 'synthetic-asr', text: '合成迟到转写', segments: [] } })
      const late = speech.inject({ method: 'POST', url: `/v1/assets/${assetId}/transcription` })
      await reached
      expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).statusCode).toBe(202)
      finish()
      expect((await late).statusCode).toBe(404)
      expect((await pool.query('SELECT asset_id FROM asset_transcripts WHERE asset_id=$1', [assetId])).rows).toEqual([])
    } finally { finish?.(); await speech.close(); await app.close(); await pool.end() }
  })

  it.each([['upload', 'jpeg'], ['normalize', 'jpeg'], ['normalize', 'heic']])('leaves no asset after deletion races with %s of %s', async (stage, format) => {
    const pool = new pg.Pool({ connectionString: url })
    const root = await mkdtemp(join(tmpdir(), 'ordinary-friend-pg-race-'))
    let pause = false
    let reached!: () => void
    let resume!: () => void
    const paused = new Promise<void>(resolve => { reached = resolve })
    const released = new Promise<void>(resolve => { resume = resolve })
    const wrapped = {
      connect: () => pool.connect(),
      query: async (text: string, values?: unknown[]) => {
        const target = stage === 'upload' ? text.startsWith('SELECT a.expected_bytes') : text.startsWith("UPDATE source_assets a SET state='ready'")
        if (pause && target && stage === 'normalize') { pause = false; reached(); await released }
        const result = await pool.query(text, values)
        if (pause && target && stage === 'upload') { pause = false; reached(); await released }
        return result
      },
    } as unknown as pg.Pool
    const app = createApp(wrapped, root)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const image = format === 'heic' ? await readFile(new URL('./fixtures/synthetic.heic', import.meta.url)) : await sharp({ create: { width: 16, height: 16, channels: 3, background: '#779977' } }).jpeg().toBuffer()
      const assetId = (await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: `image/${format}`, sizeBytes: image.length } })).json().assetId
      const upload = { method: 'PUT' as const, url: `/v1/assets/${assetId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image }
      if (stage === 'normalize') expect((await app.inject(upload)).statusCode).toBe(202)
      pause = true
      const late = app.inject(stage === 'upload' ? upload : { method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie } })
      await paused
      expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).statusCode).toBe(202)
      resume()
      expect((await late).statusCode).toBe(404)
      expect(await readdir(root)).toEqual([])
      expect((await pool.query('SELECT id FROM source_assets WHERE person_id=$1', [personId])).rows).toEqual([])
      expect((await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'after-delete' } })).statusCode).toBe(404)
    } finally { resume?.(); await app.close(); await pool.end(); await rm(root, { recursive: true, force: true }) }
  })

  it.each(['delete', 'retract', 'hide'])('rejects speech finishing after %s commits', async action => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    const speech = Fastify()
    let started!: () => void
    let finish!: (audio: Buffer) => void
    const generating = new Promise<void>(resolve => { started = resolve })
    const audio = new Promise<Buffer>(resolve => { finish = resolve })
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const ownerId = (await pool.query('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
      const evidenceId = (await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成测试：回头等我' } })).json().evidenceId
      const episodeId = (await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'speech-revoke' } })).json().episodeId
      registerTtsRoutes(speech, pool, async () => ownerId, async () => { started(); return audio })
      const response = speech.inject({ method: 'GET', url: `/v1/episodes/${episodeId}/voice` })
      await generating
      const revoked = await app.inject(action === 'delete'
        ? { method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } }
        : { method: 'POST', url: action === 'retract' ? `/v1/evidence/${evidenceId}/retract` : `/v1/episodes/${episodeId}/hide`, headers: { cookie } })
      expect(revoked.statusCode).toBe(action === 'delete' ? 202 : action === 'retract' ? 200 : 204)
      finish(Buffer.from('synthetic-late-audio'))
      expect((await response).statusCode).toBe(404)
    } finally { finish?.(Buffer.alloc(0)); await speech.close(); await app.close(); await pool.end() }
  })

  it('does not retain or resurrect feedback when submission races with deletion', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成测试：修东西' } })
      const episodeId = (await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'feedback-race' } })).json().episodeId
      const feedback = { method: 'POST' as const, url: `/v1/episodes/${episodeId}/feedback`, headers: { cookie }, payload: { comment: '合成反馈' } }
      expect((await app.inject(feedback)).statusCode).toBe(204)
      const [saved, deleted] = await Promise.all([app.inject(feedback), app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })])
      expect([204, 404]).toContain(saved.statusCode)
      expect(deleted.statusCode).toBe(202)
      expect((await app.inject(feedback)).statusCode).toBe(404)
      expect((await pool.query('SELECT count(*) FROM episode_feedback WHERE episode_id=$1', [episodeId])).rows[0].count).toBe('0')
    } finally { await app.close(); await pool.end() }
  })

  it('migrates and enforces owner, idempotency and deletion on the real server', async () => {
    const pool = new pg.Pool({ connectionString: url })
    const app = createApp(pool)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const createSession = async () => (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const alice = await createSession()
      const bob = await createSession()
      const person = await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie: alice }, payload: {} })
      expect(person.statusCode).toBe(201)
      const id = person.json().personId as string
      const memory = await app.inject({ method: 'POST', url: `/v1/persons/${id}/memories`, headers: { cookie: alice }, payload: { text: '他走路时总会回头等我' } })
      expect(memory.statusCode).toBe(201)
      const evidenceId = memory.json().evidenceId as string
      const request = { method: 'POST' as const, url: `/v1/persons/${id}/episodes`, headers: { cookie: alice, 'idempotency-key': 'same-request-key' } }
      const [first, second] = await Promise.all([app.inject(request), app.inject(request)])
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201])
      const episodeId = first.json().episodeId as string
      expect(second.json().episodeId).toBe(episodeId)
      expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: bob } })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: `/v1/evidence/${evidenceId}/retract`, headers: { cookie: alice } })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: alice } })).json().retracted).toBe(true)
      expect((await app.inject({ method: 'POST', url: `/v1/persons/${id}/episodes`, headers: { cookie: alice, 'idempotency-key': 'new-request-after-retract' } })).statusCode).toBe(409)
      expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${id}`, headers: { cookie: alice } })).statusCode).toBe(202)
      expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: alice } })).statusCode).toBe(404)
      const evidence = await pool.query<{ count: string }>('SELECT count(*) FROM evidence WHERE person_id=$1', [id])
      expect(evidence.rows[0].count).toBe('0')
    } finally {
      await app.close()
      await pool.end()
    }
  })

  it.each(Array.from({ length: 20 }, (_, index) => index + 1))('isolates all private API routes and equal media hashes in user pair %s', async group => {
    const pool = new pg.Pool({ connectionString: url })
    const root = await mkdtemp(join(tmpdir(), 'ordinary-friend-pg-isolation-'))
    const app = createApp(pool, root)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const session = async () => (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const alice = await session()
      const bob = await session()
      const person = async (cookie: string) => (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId as string
      const alicePerson = await person(alice)
      const bobPerson = await person(bob)
      const evidenceId = (await app.inject({ method: 'POST', url: `/v1/persons/${alicePerson}/memories`, headers: { cookie: alice }, payload: { text: `合成隔离组 ${group}：回头等我` } })).json().evidenceId as string
      const episodeId = (await app.inject({ method: 'POST', url: `/v1/persons/${alicePerson}/episodes`, headers: { cookie: alice, 'idempotency-key': `isolation-group-${group}` } })).json().episodeId as string
      const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#779977' } }).jpeg().toBuffer()
      const upload = async (personId: string, cookie: string) => {
        const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: 'image/jpeg', sizeBytes: image.length } })
        expect(intent.statusCode).toBe(201)
        const assetId = intent.json().assetId as string
        expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image })).statusCode).toBe(202)
        expect((await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie } })).statusCode).toBe(200)
        return assetId
      }
      const aliceAsset = await upload(alicePerson, alice)
      const bobAsset = await upload(bobPerson, bob)
      const rows = (await pool.query('SELECT id,sha256,object_key FROM source_assets WHERE id=ANY($1::uuid[]) ORDER BY id', [[aliceAsset, bobAsset]])).rows
      expect(rows).toHaveLength(2)
      expect(rows[0].sha256).toBe(rows[1].sha256)
      expect(rows[0].object_key).not.toBe(rows[1].object_key)
      const attempts: Array<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: Record<string, unknown> | Buffer; headers?: Record<string, string> }> = [
        { method: 'GET', url: `/v1/persons/${alicePerson}/assets` },
        { method: 'GET', url: `/v1/persons/${alicePerson}/episodes` },
        { method: 'GET', url: `/v1/episodes/${episodeId}` },
        { method: 'GET', url: `/v1/episodes/${episodeId}/voice` },
        { method: 'GET', url: `/v1/episodes/${episodeId}/feedback` },
        { method: 'POST', url: `/v1/episodes/${episodeId}/feedback`, payload: { comment: '合成越权写入' } },
        { method: 'POST', url: `/v1/episodes/${episodeId}/hide` },
        { method: 'POST', url: `/v1/evidence/${evidenceId}/retract` },
        { method: 'POST', url: `/v1/persons/${alicePerson}/memories`, payload: { text: '合成越权记忆' } },
        { method: 'POST', url: `/v1/persons/${alicePerson}/episodes`, headers: { 'idempotency-key': 'foreign-isolation-attempt' } },
        { method: 'POST', url: '/v1/assets/upload-intents', payload: { personId: alicePerson, kind: 'photo', mediaType: 'image/jpeg', sizeBytes: image.length } },
        { method: 'PUT', url: `/v1/assets/${aliceAsset}/content`, headers: { 'content-type': 'application/octet-stream' }, payload: image },
        { method: 'POST', url: `/v1/assets/${aliceAsset}/complete` },
        { method: 'GET', url: `/v1/assets/${aliceAsset}/transcription` },
        { method: 'POST', url: `/v1/assets/${aliceAsset}/transcription` },
        { method: 'POST', url: `/v1/assets/${aliceAsset}/transcription/confirm`, payload: { text: '合成越权确认' } },
        { method: 'POST', url: `/v1/assets/${aliceAsset}/transcription/skip` },
        { method: 'DELETE', url: `/v1/persons/${alicePerson}` },
      ]
      for (const attempt of attempts) {
        const response = await app.inject({ ...attempt, headers: { cookie: bob, ...attempt.headers } })
        expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404)
        expect(response.json()).toEqual({ code: 'not_found' })
      }
      expect((await app.inject({ method: 'GET', url: `/v1/persons/${bobPerson}/assets`, headers: { cookie: bob } })).json().assets.map((asset: { assetId: string }) => asset.assetId)).toEqual([bobAsset])
      expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}/voice`, headers: { cookie: alice } })).statusCode).toBe(200)
      expect((await pool.query('SELECT usable FROM evidence WHERE id=$1', [evidenceId])).rows[0].usable).toBe(true)
      expect((await pool.query('SELECT revision FROM persons WHERE id=$1', [alicePerson])).rows[0].revision).toBe(2)
      expect((await pool.query('SELECT episode_id FROM episode_feedback WHERE episode_id=$1', [episodeId])).rowCount).toBe(0)
      const deleted = await app.inject({ method: 'DELETE', url: `/v1/persons/${alicePerson}`, headers: { cookie: alice } })
      expect(deleted.statusCode).toBe(202)
      const deletionJobId = deleted.json().deletionJobId
      expect((await app.inject({ method: 'GET', url: `/v1/deletions/${deletionJobId}`, headers: { cookie: bob } })).statusCode).toBe(404)
      expect((await app.inject({ method: 'GET', url: '/v1/deletions', headers: { cookie: bob } })).json().deletions).toEqual([])
      expect(await readdir(root)).toEqual([`${bobAsset}.jpg`])
      expect((await app.inject({ method: 'GET', url: `/v1/persons/${bobPerson}/assets`, headers: { cookie: bob } })).json().assets[0].state).toBe('ready')
      expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${bobPerson}`, headers: { cookie: bob } })).statusCode).toBe(202)
      expect(await readdir(root)).toEqual([])
    } finally { await app.close(); await pool.end(); await rm(root, { recursive: true, force: true }) }
  })

  it.each(['jpeg', 'heic'])('validates a private %s photo and cleans its file after deletion', async format => {
    const pool = new pg.Pool({ connectionString: url })
    const root = await mkdtemp(join(tmpdir(), 'ordinary-friend-pg-assets-'))
    const app = createApp(pool, root)
    try {
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId as string
      const image = format === 'heic' ? await readFile(new URL('./fixtures/synthetic.heic', import.meta.url)) : await sharp({ create: { width: 16, height: 16, channels: 3, background: '#779977' } }).jpeg().toBuffer()
      const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: `image/${format}`, sizeBytes: image.length } })
      expect(intent.statusCode).toBe(201)
      const assetId = intent.json().assetId as string
      expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image })).statusCode).toBe(202)
      expect((await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie } })).statusCode).toBe(200)
      expect(await readdir(root)).toEqual([`${assetId}.jpg`])
      expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).statusCode).toBe(202)
      expect(await readdir(root)).toEqual([])
    } finally {
      await app.close()
      await pool.end()
      await rm(root, { recursive: true, force: true })
    }
  })
})
