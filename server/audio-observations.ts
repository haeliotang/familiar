import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { detectSpeechActivity, selectSpeechWindow } from './speech-activity'
import { LocalTranscriberBusy, transcribeSamples } from './asr'
import { estimateChineseSpeechRate } from './speech-rate'
import { registerAudioReviewRoutes } from './audio-review'
import { registerAudioClipRoutes } from './audio-clip'

const require = createRequire(import.meta.url)
export function observeAudio(samples: Float32Array, sampleRate: number, selectedStartSec?: number) {
  if (sampleRate !== 16000 || !samples.length || samples.length > sampleRate * 180 || samples.some(value => !Number.isFinite(value))) throw new Error('unsupported_audio')
  const frameSize = 320
  const energy: number[] = []
  for (let start = 0; start < samples.length; start += frameSize) {
    let sum = 0
    const end = Math.min(start + frameSize, samples.length)
    for (let i = start; i < end; i++) sum += samples[i] ** 2
    energy.push(Math.sqrt(sum / (end - start)))
  }
  const windowFrames = Math.min(1500, energy.length)
  let score = 0
  for (let i = 0; i < windowFrames; i++) score += Math.min(energy[i], .1)
  let best = score
  let first = 0
  for (let i = windowFrames; i < energy.length; i++) {
    score += Math.min(energy[i], .1) - Math.min(energy[i - windowFrames], .1)
    if (score > best + 1e-9) { best = score; first = i - windowFrames + 1 }
  }
  if (selectedStartSec !== undefined) first = Math.round(selectedStartSec * sampleRate / frameSize)
  const startSample = first * frameSize
  const endSample = Math.min(samples.length, startSample + 30 * sampleRate)
  const quietIntervals: Array<{ startSec: number; endSec: number }> = []
  let quietStart: number | undefined
  let activeSamples = 0
  let clippedSamples = 0
  for (let frame = first; frame < first + windowFrames; frame++) {
    const from = frame * frameSize
    const to = Math.min(from + frameSize, endSample)
    if (energy[frame] >= .01) {
      activeSamples += to - from
      if (quietStart !== undefined && from - quietStart >= .12 * sampleRate) quietIntervals.push({ startSec: quietStart / sampleRate, endSec: from / sampleRate })
      quietStart = undefined
    } else quietStart ??= from
    for (let i = from; i < to; i++) if (Math.abs(samples[i]) >= .99) clippedSamples++
  }
  if (quietStart !== undefined && endSample - quietStart >= .12 * sampleRate) quietIntervals.push({ startSec: quietStart / sampleRate, endSec: endSample / sampleRate })
  const activeSec = activeSamples / sampleRate
  return { analyzerVersion: 'signal-window-v1', durationSec: samples.length / sampleRate, selectedWindow: { startSec: startSample / sampleRate, endSec: endSample / sampleRate }, activeEnergySec: activeSec, quietIntervals, clippedFraction: clippedSamples / (endSample - startSample), signalStatus: activeSec < 2 ? 'insufficient_energy' : clippedSamples / (endSample - startSample) > .01 ? 'clipped' : 'measured', subjectAttribution: 'unverified', speechRate: null, pitch: null }
}

export async function observeAudioFile(path: string, detect = detectSpeechActivity) {
  const bytes = await readFile(path)
  const wave = require('sherpa-onnx-node').readWave(path) as { samples: Float32Array; sampleRate: number }
  let observation = observeAudio(wave.samples, wave.sampleRate)
  let speechActivity
  let selectionMethod = 'bounded_energy_v1'
  try {
    const full = await detect(wave.samples, wave.sampleRate)
    const selected = selectSpeechWindow(full.speechIntervals, observation.durationSec)
    if (full.speechIntervals.length) {
      observation = observeAudio(wave.samples, wave.sampleRate, selected.startSec)
      selectionMethod = 'max_speech_coverage_v1'
    }
    const { startSec, endSec } = observation.selectedWindow
    speechActivity = await detect(wave.samples.subarray(Math.round(startSec * wave.sampleRate), Math.round(endSec * wave.sampleRate)), wave.sampleRate, startSec)
  } catch { speechActivity = { status: 'unavailable' as const, modelId: 'silero-vad-v4' } }
  let rateObservation: { status: string; modelId?: string; text?: string; estimate?: ReturnType<typeof estimateChineseSpeechRate> } = { status: 'insufficient_speech' }
  if (speechActivity.status === 'unavailable') rateObservation = { status: 'unavailable' }
  else if (speechActivity.speechDurationSec >= 2) {
    try {
      const { startSec, endSec } = observation.selectedWindow
      const transcript = await transcribeSamples(wave.samples.subarray(Math.round(startSec * wave.sampleRate), Math.round(endSec * wave.sampleRate)), wave.sampleRate)
      const estimate = estimateChineseSpeechRate(transcript.text, speechActivity.speechDurationSec, endSec - startSec)
      rateObservation = { status: estimate ? 'unconfirmed' : 'not_estimable', modelId: transcript.modelId, text: transcript.text, estimate }
    } catch (error) { rateObservation = { status: error instanceof LocalTranscriberBusy ? 'busy' : 'unavailable' } }
  }
  return { ...observation, selectionMethod, speechActivity, rateObservation, normalizedAudioSha256: createHash('sha256').update(bytes).digest('hex') }
}

export function registerAudioObservationRoutes(app: FastifyInstance, pool: pg.Pool, root: string, owner: (cookie: string | undefined) => Promise<string | null>, analyze = observeAudioFile) {
  registerAudioReviewRoutes(app, pool, owner)
  registerAudioClipRoutes(app, pool, root, owner)
  for (const method of ['GET', 'POST'] as const) app.route({ method, url: '/v1/assets/:id/audio-observations', handler: async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const asset = await pool.query('SELECT a.kind,a.speaker_role,a.state,a.person_id FROM source_assets a JOIN persons p ON p.id=a.person_id WHERE a.id=$1 AND a.owner_id=$2 AND p.deleted_at IS NULL', [params.data.id, ownerId])
    if (!asset.rowCount) return reply.code(404).send({ code: 'not_found' })
    if (asset.rows[0].kind !== 'deceased_audio' || asset.rows[0].speaker_role !== 'deceased') return reply.code(409).send({ code: 'not_person_audio' })
    if (asset.rows[0].state !== 'ready') return reply.code(409).send({ code: 'audio_not_ready' })
    reply.header('Cache-Control', 'private, no-store')
    if (method === 'GET') {
      const saved = await pool.query('SELECT o.observations FROM source_assets a JOIN persons p ON p.id=a.person_id LEFT JOIN asset_audio_observations o ON o.asset_id=a.id WHERE a.id=$1 AND a.owner_id=$2 AND p.deleted_at IS NULL', [params.data.id, ownerId])
      if (!saved.rowCount) return reply.code(404).send({ code: 'not_found' })
      return { sourceAssetId: params.data.id, observations: saved.rows[0]?.observations || null }
    }
    let observations
    try { observations = await analyze(join(root, `${params.data.id}.wav`)) }
    catch { return reply.code(503).send({ code: 'audio_analysis_unavailable' }) }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const person = await client.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [asset.rows[0].person_id, ownerId])
      if (!person.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'not_found' }) }
      await client.query('INSERT INTO asset_audio_observations(asset_id,observations) VALUES($1,$2) ON CONFLICT(asset_id) DO UPDATE SET observations=excluded.observations', [params.data.id, observations])
      await client.query('COMMIT')
      return { sourceAssetId: params.data.id, observations }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  } })
}
