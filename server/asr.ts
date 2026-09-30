import { createRequire } from 'node:module'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const model = join(process.cwd(), '.models/sherpa-onnx-whisper-tiny')
let recognizer: Promise<any> | undefined
let recognitionQueue = Promise.resolve()
let admittedRecognitions = 0

export class LocalTranscriberBusy extends Error {
  constructor() { super('local_transcriber_busy') }
}

async function loadRecognizer() {
  await stat(join(model, 'tiny-encoder.int8.onnx'))
  const sherpa = require('sherpa-onnx-node')
  return sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: join(model, 'tiny-encoder.int8.onnx'), decoder: join(model, 'tiny-decoder.int8.onnx'), language: 'zh', task: 'transcribe' },
      tokens: join(model, 'tiny-tokens.txt'), numThreads: 2, provider: 'cpu', debug: false,
    },
  })
}

export async function transcribeLocal(path: string) {
  const sherpa = require('sherpa-onnx-node')
  const wave = sherpa.readWave(path) as { samples: Float32Array; sampleRate: number }
  return transcribeSamples(wave.samples, wave.sampleRate)
}

export async function transcribeSamples(audio: Float32Array, sampleRate: number) {
  if (sampleRate !== 16000 || !audio.length || audio.length > 16000 * 180 || audio.some(value => !Number.isFinite(value))) throw new Error('unsupported_audio')
  if (admittedRecognitions >= 4) throw new LocalTranscriberBusy()
  admittedRecognitions++
  const previous = recognitionQueue
  let release!: () => void
  recognitionQueue = new Promise<void>(resolve => { release = resolve })
  await previous
  try {
    recognizer ||= loadRecognizer().catch(error => { recognizer = undefined; throw error })
    const engine = await recognizer
    const segments: Array<{ startSec: number; endSec: number; text: string }> = []
    const chunkSize = 16000 * 25
    for (let offset = 0; offset < audio.length; offset += chunkSize) {
      const samples = audio.subarray(offset, offset + chunkSize)
      if (!samples.some(value => Math.abs(value) > 0.001)) continue
      const stream = engine.createStream()
      stream.acceptWaveform({ samples, sampleRate })
      const result = await engine.decodeAsync(stream)
      segments.push({ startSec: offset / sampleRate, endSec: (offset + samples.length) / sampleRate, text: result.text.trim() })
    }
    return { modelId: 'whisper-tiny-int8', segments, text: segments.map(segment => segment.text).join('') }
  } finally { admittedRecognitions--; release() }
}
