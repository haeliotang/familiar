import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateVoiceSamples } from '../server/tts'
import { spokenLine } from '../src/encounter'

const root = 'artifacts/acceptance/M0/cadence-candidates-v1'
await mkdir(root, { recursive: true })
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const samples = []
const conditions: Array<{ speakerId: number; speed: number; meanDurationSec: number }> = []
const initialSinglePass = []
for (const speakerId of [58, 3]) for (const speed of [.8, 1, 1.2]) {
  const path = `${root}/speaker-${speakerId}-speed-${speed}.wav`
  try {
    await readFile(path)
    const wave = sherpa.readWave(path)
    initialSinglePass.push({ speakerId, speed, path, durationSec: wave.samples.length / wave.sampleRate })
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
for (const speakerId of [58, 3]) {
  const durations: number[] = []
  for (const speed of [.8, 1, 1.2]) {
    const repetitions: number[] = []
    for (let repeat = 1; repeat <= 3; repeat++) {
      const started = performance.now()
      const generated = await generateVoiceSamples('wait', speakerId, speed)
      const path = `${root}/speaker-${speakerId}-speed-${speed}-repeat-${repeat}.wav`
      sherpa.writeWave(path, generated)
      const bytes = await readFile(path)
      const durationSec = generated.samples.length / generated.sampleRate
      repetitions.push(durationSec)
      samples.push({ speakerId, speed, repeat, path, durationSec, sampleRate: generated.sampleRate, generationMs: Math.round(performance.now() - started), sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    const meanDurationSec = repetitions.reduce((total, value) => total + value, 0) / repetitions.length
    durations.push(meanDurationSec)
    conditions.push({ speakerId, speed, meanDurationSec })
  }
  if (!(durations[0] > durations[1] && durations[1] > durations[2])) console.warn(`speed_control_not_monotonic:${speakerId}`)
}
const report = { checkedAt: new Date().toISOString(), status: conditions.every((item, index) => index % 3 === 0 || conditions[index - 1].meanDurationSec > item.meanDurationSec) ? 'synthetic_mean_speed_control_measured' : 'speed_control_not_monotonic', model: 'kokoro-int8-multi-lang-v1_1', cue: 'wait', text: spokenLine('wait'), silenceScale: .2, initialSinglePass, conditions, samples, limitations: ['No human listening or familiarity result', 'No source recording transfer', 'No pause control verified', 'Not a published episode voice version'] }
await writeFile(`${root}/results.json`, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))

process.exitCode = report.status === 'speed_control_not_monotonic' ? 1 : 0
