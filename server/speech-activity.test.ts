import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectSpeechActivity, selectSpeechWindow } from './speech-activity'

const require = createRequire(import.meta.url)
describe.skipIf(!existsSync('.models/silero-vad-v4.onnx'))('local Silero speech activity', () => {
  it('leaves silence without speech or an invented pause ratio', async () => {
    const result = await detectSpeechActivity(new Float32Array(16000 * 3), 16000, 10)
    expect(result).toMatchObject({ status: 'measured', speechIntervals: [], speechDurationSec: 0, pauses: [], internalPauseRatio: null, subjectAttribution: 'unverified' })
  })
  it('detects two synthetic utterances and their separating pause with absolute timestamps', async () => {
    const wave = require('sherpa-onnx-node').readWave('public/assets/voices/kokoro-zh-zm009-v1/general.wav') as { samples: Float32Array; sampleRate: number }
    const speech = new Float32Array(Math.floor(wave.samples.length * 16000 / wave.sampleRate))
    for (let i = 0; i < speech.length; i++) {
      const position = i * wave.sampleRate / 16000
      const left = Math.floor(position)
      speech[i] = wave.samples[left] + (position - left) * ((wave.samples[left + 1] ?? wave.samples[left]) - wave.samples[left])
    }
    const samples = new Float32Array(speech.length * 2 + 16000 * 3)
    samples.set(speech, 16000)
    samples.set(speech, 32000 + speech.length)
    const result = await detectSpeechActivity(samples, 16000, 10)
    expect(result.speechIntervals).toHaveLength(2)
    expect(result.speechDurationSec).toBeGreaterThan(1)
    expect(result.pauses).toHaveLength(1)
    expect(result.pauses[0].endSec - result.pauses[0].startSec).toBeGreaterThan(.5)
    expect(result.internalPauseRatio).toBeGreaterThan(0)
    expect(result.speechIntervals.every(item => item.startSec >= 10 && item.endSec <= 10 + samples.length / 16000)).toBe(true)
    const long = new Float32Array(16000 * 80)
    long.set(samples, 16000 * 50)
    const full = await detectSpeechActivity(long, 16000)
    expect(full.speechIntervals).toHaveLength(2)
    expect(full.speechIntervals[0].startSec).toBeGreaterThan(50)
    const selected = selectSpeechWindow(full.speechIntervals, 80)
    expect(selected.endSec - selected.startSec).toBeLessThanOrEqual(30)
    expect(full.speechIntervals.every(item => item.startSec >= selected.startSec && item.endSec <= selected.endSec)).toBe(true)

  })
  it('rejects inputs outside the bounded analysis contract', async () => {
    await expect(detectSpeechActivity(new Float32Array(48000), 48000)).rejects.toThrow('unsupported_audio')
    await expect(detectSpeechActivity(new Float32Array(16000 * 181), 16000)).rejects.toThrow('unsupported_audio')
    await expect(detectSpeechActivity(new Float32Array([NaN]), 16000)).rejects.toThrow('unsupported_audio')
    for (const offset of [NaN, Infinity, -1]) await expect(detectSpeechActivity(new Float32Array(16000), 16000, offset)).rejects.toThrow('unsupported_audio')
  })
})

it('selects the most speech within 30 seconds with deterministic ties', () => {
  expect(selectSpeechWindow([{ startSec: 40, endSec: 70 }], 100)).toEqual({ startSec: 40, endSec: 70 })
  expect(selectSpeechWindow([{ startSec: 0, endSec: 5 }, { startSec: 60, endSec: 70 }], 100)).toEqual({ startSec: 40, endSec: 70 })
  expect(selectSpeechWindow([], 3)).toEqual({ startSec: 0, endSec: 3 })
})
