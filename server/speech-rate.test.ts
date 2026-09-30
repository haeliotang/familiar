import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observeAudioFile } from './audio-observations'
import { expect, it } from 'vitest'
import { estimateChineseSpeechRate } from './speech-rate'
import { transcribeSamples } from './asr'
import { detectSpeechActivity } from './speech-activity'

it('counts Chinese text without punctuation and distinguishes speech from window time', () => {
  expect(estimateChineseSpeechRate('今天的風很好。今天的风很好！', 4, 6)).toMatchObject({ recognizedHanCharacters: 12, charactersPerSpeechSec: 3, charactersPerWindowSec: 2, reviewStatus: 'unconfirmed' })
})
it('does not invent a rate for short, invalid or mixed-language recognition', () => {
  for (const text of ['', '……', 'hello', '今天有3个人', '今天hello']) expect(estimateChineseSpeechRate(text, 3, 5)).toBeNull()
  for (const time of [0, 1, NaN, Infinity]) expect(estimateChineseSpeechRate('今天很好', time, 5)).toBeNull()
  expect(estimateChineseSpeechRate('今天很好', 5, 3)).toBeNull()
})

it.skipIf(!existsSync('.models/sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx') || !existsSync('.models/silero-vad-v4.onnx'))('estimates an unconfirmed rate from actual local recognition of synthetic speech', async () => {
  const wave = createRequire(import.meta.url)('sherpa-onnx-node').readWave('public/assets/voices/kokoro-zh-zm009-v1/general.wav') as { samples: Float32Array; sampleRate: number }
  const phrase = new Float32Array(Math.floor(wave.samples.length * 16000 / wave.sampleRate))
  for (let i = 0; i < phrase.length; i++) {
    const position = i * wave.sampleRate / 16000
    const left = Math.floor(position)
    phrase[i] = wave.samples[left] + (position - left) * ((wave.samples[left + 1] ?? wave.samples[left]) - wave.samples[left])
  }
  const audio = new Float32Array(phrase.length * 3 + 16000 * 4)
  for (let i = 0; i < 3; i++) audio.set(phrase, 16000 + i * (phrase.length + 16000))
  const activity = await detectSpeechActivity(audio, 16000)
  const transcript = await transcribeSamples(audio, 16000)
  const estimate = estimateChineseSpeechRate(transcript.text, activity.speechDurationSec, audio.length / 16000)
  expect(transcript.modelId).toBe('whisper-tiny-int8')
  expect(estimate).not.toBeNull()
  expect(estimate?.reviewStatus).toBe('unconfirmed')
  expect(estimate?.charactersPerSpeechSec).toBeGreaterThan(0)
  const root = await mkdtemp(join(tmpdir(), 'friend-rate-'))
  try {
    const path = join(root, 'synthetic.wav')
    createRequire(import.meta.url)('sherpa-onnx-node').writeWave(path, { samples: audio, sampleRate: 16000 })
    const observed = await observeAudioFile(path)
    expect(observed.rateObservation.status).toBe('unconfirmed')
    expect(observed.rateObservation.estimate?.reviewStatus).toBe('unconfirmed')
    expect(observed.rateObservation.text).toBeTruthy()
    expect(observed.subjectAttribution).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }) }

}, 30000)
