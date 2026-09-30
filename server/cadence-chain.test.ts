import { PGlite } from '@electric-sql/pglite'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createApp } from './index'
import { localPool } from './local-pool'
import { processPreparationJobs } from './preparations'

it('uses actual uploaded synthetic speech through normalization, analysis, confirmation and retained voice playback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'friend-cadence-chain-'))
  const db = new PGlite()
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const pool = localPool(db)
  let app = createApp(pool, root)
  try {
    const source = join(root, 'synthetic-reference.wav')
    const piece = join(root, 'synthetic-phrase-with-gap.wav')
    // Known three repetitions with actual tempo and silence; no microphone or private recording.
    await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-i', join(process.cwd(), 'public/assets/voices/kokoro-zh-zm009-v1/wait.wav'), '-af', 'atempo=0.8,apad=pad_dur=0.7', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', piece], { timeout: 10000 })
    await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-stream_loop', '2', '-i', piece, '-c:a', 'pcm_s16le', source], { timeout: 10000 })
    const bytes = await readFile(source)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'deceased_audio', mediaType: 'audio/wav', sizeBytes: bytes.length } })
    expect(intent.statusCode).toBe(201)
    const assetId = intent.json().assetId
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: bytes })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie } })).statusCode).toBe(200)
    const measured = await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/audio-observations`, headers: { cookie } })
    expect(measured.statusCode).toBe(200)
    const observations = measured.json().observations
    expect(observations.speechActivity.status).toBe('measured')
    expect(observations.speechActivity.speechDurationSec).toBeGreaterThan(2)
    expect(observations.speechActivity.pauses.length).toBeGreaterThan(0)
    expect(observations.rateObservation.status).toBe('unconfirmed')
    expect(observations.rateObservation.text).toBeTruthy()
    expect(observations.normalizedAudioSha256).toBe(createHash('sha256').update(await readFile(join(root, `${assetId}.wav`))).digest('hex'))
    const reviewPath = `/v1/assets/${assetId}/audio-review`
    const observationFingerprint = (await app.inject({ url: reviewPath, headers: { cookie } })).json().observationFingerprint
    const confirmed = await app.inject({ method: 'POST', url: reviewPath, headers: { cookie }, payload: { observationFingerprint, normalizedAudioSha256: observations.normalizedAudioSha256, ...observations.selectedWindow, subject: 'single_person', text: '不用急，我走慢一点。'.repeat(3) } })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().review.rateEstimate.reviewStatus).toBe('user_confirmed_text')
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '他会回头等我' } })
    const voicePaths: string[] = []
    for (const voiceVersion of ['kokoro-zh-zm009-v1', 'kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1']) {
      const queued = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': randomUUID() } })
      await app.close()
      await processPreparationJobs(pool, undefined, root)
      app = createApp(pool, root)
      const job = (await app.inject({ url: queued.json().statusUrl, headers: { cookie } })).json()
      expect(job.status).toBe('completed')
      const episode = (await app.inject({ url: `/v1/episodes/${job.episodeId}`, headers: { cookie } })).json()
      expect(episode.manifest.audioPlan).toMatchObject({ voiceVersion, voiceMode: 'confirmed_window_rate', cadence: { sourceAssetId: assetId, observationFingerprint, normalizedAudioSha256: observations.normalizedAudioSha256, pauseTransfer: true, pausePlan: { phrasePackVersion: 'original-boundary-phrases-v1' } } })
      expect(episode.manifest.audioPlan.cadence.speed).toBeLessThan(1)
      const path = `/v1/episodes/${job.episodeId}/voice`
      voicePaths.push(path)
      const audio = await app.inject({ url: path, headers: { cookie } })
      expect(audio.statusCode).toBe(200)
      expect(createHash('sha256').update(audio.rawPayload).digest('hex')).toBe(episode.manifest.audioPlan.sha256)
    }
    await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
    for (const path of voicePaths) expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(404)
  } finally { await app.close(); await db.close(); await rm(root, { recursive: true, force: true }) }
}, 30000)
