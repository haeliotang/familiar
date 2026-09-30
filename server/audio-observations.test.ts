import { PGlite } from '@electric-sql/pglite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { createApp } from './index'
import { processPreparationJobs } from './preparations'
import { localPool } from './local-pool'
import { describe, expect, it } from 'vitest'
import { observeAudio, registerAudioObservationRoutes } from './audio-observations'

describe('bounded audio signal observations', () => {
  it('keeps silence unclassified rather than inventing speech traits', () => {
    const result = observeAudio(new Float32Array(16000 * 3), 16000)
    expect(result).toMatchObject({ signalStatus: 'insufficient_energy', activeEnergySec: 0, subjectAttribution: 'unverified', speechRate: null, pitch: null, selectedWindow: { startSec: 0, endSec: 3 } })
    expect(result.quietIntervals).toEqual([{ startSec: 0, endSec: 3 }])
  })
  it('selects at most 30 seconds of measurable energy from a longer recording', () => {
    const audio = new Float32Array(16000 * 40)
    audio.fill(.2, 16000 * 10)
    const result = observeAudio(audio, 16000)
    expect(result.selectedWindow).toEqual({ startSec: 10, endSec: 40 })
    expect(result.activeEnergySec).toBe(30)
    expect(result.signalStatus).toBe('measured')
  })
  it('reports absolute quiet intervals and clipping without assigning personality', () => {
    const audio = new Float32Array(16000 * 4).fill(1)
    audio.fill(0, 16000, 16000 * 2)
    const result = observeAudio(audio, 16000)
    expect(result.quietIntervals).toEqual([{ startSec: 1, endSec: 2 }])
    expect(result.signalStatus).toBe('clipped')
    expect(result.clippedFraction).toBe(.75)
  })
  it('rejects nonstandard or invalid input', () => {
    expect(() => observeAudio(new Float32Array(1), 48000)).toThrow()
    expect(() => observeAudio(new Float32Array([NaN]), 16000)).toThrow()
    expect(() => observeAudio(new Float32Array(), 16000)).toThrow()
    expect(() => observeAudio(new Float32Array(16000 * 181), 16000)).toThrow()
  })
})


describe('private source-bound audio observation API', () => {
  it('measures normalized synthetic audio, isolates it and deletes observations', async () => {
    const db = new PGlite()
    const root = await mkdtemp(join(tmpdir(), 'friend-audio-observations-'))
    await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    const pool = localPool(db)
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
      const review = (await app.inject({ url: `/v1/assets/${id}/audio-review`, headers: { cookie } })).json()
      const clipPath = `/v1/assets/${id}/audio-review/clip?fingerprint=${review.observationFingerprint}`
      const clip = await app.inject({ url: clipPath, headers: { cookie } })
      expect(clip.statusCode).toBe(200)
      expect(clip.headers['cache-control']).toBe('private, no-store')
      expect(clip.rawPayload.readUInt32LE(24)).toBe(16000)
      expect((clip.rawPayload.length - 44) / 32000).toBeCloseTo(measured.json().observations.selectedWindow.endSec - measured.json().observations.selectedWindow.startSec, 4)
      expect((await app.inject({ url: clipPath, headers: { cookie: foreign } })).statusCode).toBe(404)
      expect((await app.inject({ url: clipPath.replace(review.observationFingerprint, '0'.repeat(64)), headers: { cookie } })).statusCode).toBe(409)

      expect((await app.inject({ method: 'POST', url: path, headers: { cookie } })).json()).toEqual(measured.json())
      expect((await app.inject({ url: path, headers: { cookie } })).json()).toEqual(measured.json())
      await db.query('DELETE FROM asset_audio_observations WHERE asset_id=$1', [id])
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
          expect((await db.query('SELECT asset_id FROM asset_audio_observations WHERE asset_id=$1', [id])).rows).toHaveLength(1)
        }
      }
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(404)
      expect((await app.inject({ url: clipPath, headers: { cookie } })).statusCode).toBe(404)
      expect((await db.query('SELECT asset_id FROM asset_audio_observations')).rows).toEqual([])
    } finally { await app.close(); await db.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('rejects analysis that finishes after the person is deleted', async () => {
    const db = new PGlite()
    await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    const pool = localPool(db)
    const app = createApp(pool)
    const analysis = Fastify()
    let started!: () => void
    let finish!: () => void
    const reached = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { finish = resolve })
    try {
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      const ownerId = (await db.query<{ owner_id: string }>('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
      const id = randomUUID()
      await db.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'deceased_audio','deceased','audio/wav',100,'ready')", [id, ownerId, personId])
      registerAudioObservationRoutes(analysis, pool, '/synthetic-test', async () => ownerId, async () => { started(); await released; return { ...observeAudio(new Float32Array(16000 * 3), 16000), normalizedAudioSha256: 'synthetic-only', selectionMethod: 'bounded_energy_v1', rateObservation: { status: 'unavailable' }, speechActivity: { status: 'unavailable' as const, modelId: 'silero-vad-v4' } } })
      const pending = analysis.inject({ method: 'POST', url: `/v1/assets/${id}/audio-observations` })
      await reached
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      finish()
      expect((await pending).statusCode).toBe(404)
      expect((await db.query('SELECT asset_id FROM asset_audio_observations')).rows).toEqual([])
    } finally { finish?.(); await analysis.close(); await app.close(); await db.close() }
  })
})
