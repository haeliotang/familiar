import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const fingerprint = 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'

export async function detectSpeechActivity(samples: Float32Array, sampleRate: number, offsetSec = 0) {
  if (!Number.isFinite(offsetSec) || offsetSec < 0 || sampleRate !== 16000 || !samples.length || samples.length > 180 * sampleRate || samples.some(value => !Number.isFinite(value))) throw new Error('unsupported_audio')
  const model = join(process.cwd(), '.models/silero-vad-v4.onnx')
  if (createHash('sha256').update(await readFile(model)).digest('hex') !== fingerprint) throw new Error('vad_model_mismatch')
  const detector = new (require('sherpa-onnx-node').Vad)({ sileroVad: { model, threshold: .5, minSilenceDuration: .25, minSpeechDuration: .25, windowSize: 512, maxSpeechDuration: 30 }, sampleRate, numThreads: 1, provider: 'cpu', debug: false }, 32)
  const intervals: Array<{ startSec: number; endSec: number }> = []
  function drain() {
    while (!detector.isEmpty()) {
      const segment = detector.front(false) as { start: number; samples: Float32Array }
      const start = Math.max(0, segment.start)
      const end = Math.min(samples.length, segment.start + segment.samples.length)
      if (end > start) intervals.push({ startSec: offsetSec + start / sampleRate, endSec: offsetSec + end / sampleRate })
      detector.pop()
    }
  }
  try {
    for (let from = 0; from < samples.length; from += 512) {
      detector.acceptWaveform(samples.subarray(from, from + 512))
      drain()
    }
    detector.flush()
    drain()
    const speechDurationSec = intervals.reduce((total, item) => total + item.endSec - item.startSec, 0)
    const pauses = intervals.slice(1).map((item, index) => ({ startSec: intervals[index].endSec, endSec: item.startSec })).filter(item => item.endSec > item.startSec)
    const span = intervals.length ? intervals[intervals.length - 1].endSec - intervals[0].startSec : 0
    return { status: 'measured' as const, modelId: 'silero-vad-v4', modelSha256: fingerprint, speechIntervals: intervals, speechDurationSec, pauses, internalPauseRatio: span ? pauses.reduce((total, item) => total + item.endSec - item.startSec, 0) / span : null, subjectAttribution: 'unverified' as const }
  } finally { detector.clear() }
}

export function selectSpeechWindow(intervals: Array<{ startSec: number; endSec: number }>, durationSec: number) {
  const length = Math.min(30, durationSec)
  let best = -1
  let startSec = 0
  const lastFrame = Math.floor(Math.max(0, durationSec - length) / .02)
  for (let frame = 0; frame <= lastFrame; frame++) {
    const start = frame * .02
    const end = start + length
    const score = intervals.reduce((total, item) => total + Math.max(0, Math.min(end, item.endSec) - Math.max(start, item.startSec)), 0)
    if (score > best + 1e-9) { best = score; startSec = start }
  }
  return { startSec, endSec: Math.min(durationSec, startSec + length) }
}
