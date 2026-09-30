import { PGlite } from '@electric-sql/pglite'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import Fastify from 'fastify'
import { manifestContent } from '../src/manifest'
import { createApp } from './index'
import { localPool } from './local-pool'
import { observeAudio } from './audio-observations'
import { processPreparationJobs } from './preparations'
import { registerTtsRoutes } from './tts'

const scenarios = ['hide', 'delete', 'stale', 'rollback', 'delete_during_voice_read'] as const
type Scenario = typeof scenarios[number]
const cases = [false, true].flatMap(withPause => scenarios.map(scenario => [withPause, scenario] as const))

async function verifyPublication(pool: pg.Pool, scenario: Scenario, withPause: boolean) {
  let app = createApp(pool, tmpdir())
  try {
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const ownerId = (await pool.query<{ owner_id: string }>('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
    const assetId = randomUUID()
    await pool.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'deceased_audio','deceased','audio/wav',100,'ready')", [assetId, ownerId, personId])
    // Controlled analysis fixture; rendering below uses the actual retained Kokoro WAV and ffmpeg.
    const observations = { ...observeAudio(new Float32Array(6 * 16000), 16000), selectionMethod: 'max_speech_coverage_v1', normalizedAudioSha256: 'a'.repeat(64), speechActivity: { status: 'measured' as const, modelId: 'silero-vad-v4', modelSha256: 'b'.repeat(64), speechDurationSec: 4, speechIntervals: withPause ? [{ startSec: 0, endSec: 1 }, { startSec: 1.5, endSec: 4.5 }] : [{ startSec: 0, endSec: 4 }], pauses: withPause ? [{ startSec: 1, endSec: 1.5 }] : [], internalPauseRatio: withPause ? .5 / 4.5 : 0, subjectAttribution: 'unverified' as const }, rateObservation: { status: 'unconfirmed' } }
    await pool.query('INSERT INTO asset_audio_observations(asset_id,observations) VALUES($1,$2)', [assetId, observations])
    const reviewPath = `/v1/assets/${assetId}/audio-review`
    const observationFingerprint = (await app.inject({ url: reviewPath, headers: { cookie } })).json().observationFingerprint
    expect((await app.inject({ method: 'POST', url: reviewPath, headers: { cookie }, payload: { observationFingerprint, normalizedAudioSha256: observations.normalizedAudioSha256, startSec: 0, endSec: 6, subject: 'single_person', text: '今天的风很好。' } })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '回头等我' } })
    const queued = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': randomUUID() } })
    await app.close()
    const analyze = async () => scenario === 'stale' ? { ...observations, selectionMethod: 'changed-test-analysis' } : observations
    if (scenario === 'rollback') {
      const failing = {
        query: pool.query.bind(pool),
        connect: async () => {
          const client = await pool.connect()
          return { release: () => client.release(), query: (text: string, values?: unknown[]) => {
            if (text.startsWith("UPDATE preparation_jobs SET status='completed'")) throw new Error('synthetic_failure_after_audio_write')
            return client.query(text, values)
          } }
        },
      } as unknown as pg.Pool
      await expect(processPreparationJobs(failing, undefined, tmpdir(), analyze)).rejects.toThrow('synthetic_failure_after_audio_write')
      expect((await pool.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([])
      expect((await pool.query('SELECT status,attempts FROM preparation_jobs WHERE id=$1', [queued.json().preparationId])).rows[0]).toEqual({ status: 'queued', attempts: 1 })
    }
    await processPreparationJobs(pool, undefined, tmpdir(), analyze)
    const job = (await pool.query<{ status: string; episode_id: string }>('SELECT status,episode_id FROM preparation_jobs WHERE id=$1', [queued.json().preparationId])).rows[0]
    expect(job.status).toBe('completed')
    app = createApp(pool, tmpdir())
    const episode = (await app.inject({ url: `/v1/episodes/${job.episode_id}`, headers: { cookie } })).json()
    expect(episode.manifest.manifestHash).toBe(createHash('sha256').update(manifestContent(episode.manifest)).digest('hex'))
    const stored = (await pool.query<{ retained_voice_base64: string | null }>('SELECT retained_voice_base64 FROM episodes WHERE id=$1', [job.episode_id])).rows[0].retained_voice_base64
    if (scenario === 'stale') {
      expect(episode.manifest.audioPlan.voiceMode).toBe('standard_voice_without_transfer')
      expect(stored).toBeNull()
      return
    }
    expect(episode.manifest).toMatchObject({ schemaVersion: '1.4', audioPlan: { voiceMode: 'confirmed_window_rate', cadence: { sourceAssetId: assetId, observationFingerprint, speed: .8, pauseTransfer: withPause, method: withPause ? 'confirmed_window_rate_phrase_pause_v1' : 'confirmed_window_rate_atempo_v1' } } })
    if (withPause) expect(episode.manifest.audioPlan.cadence.pausePlan).toMatchObject({ addedPauseSec: .5, phrasePackVersion: 'original-boundary-phrases-v1' })
    const path = `/v1/episodes/${job.episode_id}/voice`
    const audio = await app.inject({ url: path, headers: { cookie } })
    expect(audio.statusCode).toBe(200)
    expect(audio.headers['cache-control']).toBe('private, no-store')
    expect(audio.rawPayload).toEqual(Buffer.from(stored!, 'base64'))
    expect(createHash('sha256').update(audio.rawPayload).digest('hex')).toBe(episode.manifest.audioPlan.sha256)
    await pool.query('UPDATE asset_audio_observations SET observations=$2,review=NULL WHERE asset_id=$1', [assetId, { ...observations, selectionMethod: 'later-analysis' }])
    await app.close()
    app = createApp(pool, tmpdir())
    expect((await app.inject({ url: path, headers: { cookie } })).rawPayload).toEqual(audio.rawPayload)
    const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    expect((await app.inject({ url: path, headers: { cookie: foreign } })).statusCode).toBe(404)
    if (withPause) {
      await pool.query("UPDATE episodes SET manifest=jsonb_set(manifest,'{audioPlan,cadence,pausePlan,phraseHashes}','[]'::jsonb) WHERE id=$1", [job.episode_id])
      expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(409)
      await pool.query('UPDATE episodes SET manifest=$2 WHERE id=$1', [job.episode_id, episode.manifest])
    }
    if (scenario === 'delete_during_voice_read') {
      let started!: () => void
      let release!: () => void
      const reached = new Promise<void>(resolve => { started = resolve })
      const released = new Promise<void>(resolve => { release = resolve })
      const delayed = { query: async (text: string, values?: unknown[]) => {
        const result = await pool.query(text, values)
        if (text.includes('AS "retainedVoice"')) { started(); await released }
        return result
      } } as unknown as pg.Pool
      const voice = Fastify()
      registerTtsRoutes(voice, delayed, async () => ownerId)
      try {
        const pending = voice.inject({ url: path })
        await reached
        expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).statusCode).toBe(202)
        release()
        expect((await pending).statusCode).toBe(404)
        expect((await pool.query<{ retained_voice_base64: string | null }>('SELECT retained_voice_base64 FROM episodes WHERE id=$1', [job.episode_id])).rows[0].retained_voice_base64).toBeNull()
      } finally { release(); await voice.close() }
      return
    }
    await pool.query('UPDATE episodes SET retained_voice_base64=$2 WHERE id=$1', [job.episode_id, Buffer.from('damaged').toString('base64')])
    expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(503)
    await pool.query('UPDATE episodes SET retained_voice_base64=$2 WHERE id=$1', [job.episode_id, stored])
    if (scenario === 'hide') await app.inject({ method: 'POST', url: `/v1/episodes/${job.episode_id}/hide`, headers: { cookie } })
    else await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
    expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(404)
    expect((await pool.query<{ retained_voice_base64: string | null }>('SELECT retained_voice_base64 FROM episodes WHERE id=$1', [job.episode_id])).rows[0].retained_voice_base64).toBeNull()
  } finally { await app.close() }
}

it.each(cases)('publishes and retains source-bound synthetic tempo audio (pause: %s, %s)', async (withPause, scenario) => {
  const db = new PGlite()
  try {
    await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    await verifyPublication(localPool(db), scenario, withPause)
  } finally { await db.close() }
})

describe.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL retained cadence publication', () => {
  it.each(cases)('verifies transactional audio publication (pause: %s, %s)', async (withPause, scenario) => {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const schema = `cadence_${randomUUID().replaceAll('-', '')}`
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    try {
      await admin.query(`CREATE SCHEMA ${schema}`)
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      await verifyPublication(pool, scenario, withPause)
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.end()
    }
  })
})
