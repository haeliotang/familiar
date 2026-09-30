import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ active: 0, peak: 0, calls: 0, failNext: false }))
vi.mock('node:fs/promises', () => ({ stat: async () => ({}) }))
vi.mock('node:module', () => ({ createRequire: () => () => ({
  readWave: () => ({ samples: new Float32Array(16000).fill(.1), sampleRate: 16000 }),
  OfflineRecognizer: { createAsync: async () => ({
    createStream: () => ({ acceptWaveform: () => {} }),
    decodeAsync: async () => {
      state.active++; state.peak = Math.max(state.peak, state.active); state.calls++
      try {
        await new Promise(resolve => setTimeout(resolve, 10))
        if (state.failNext) { state.failNext = false; throw new Error('synthetic_decode_failure') }
        return { text: '合成识别' }
      } finally { state.active-- }
    },
  }) },
}) }))

import { transcribeLocal, transcribeSamples } from './asr'

it('serializes file and sample recognition through the same local model', async () => {
  state.peak = 0
  const results = await Promise.all([transcribeLocal('/synthetic-only.wav'), transcribeSamples(new Float32Array(16000).fill(.1), 16000)])
  expect(results.map(result => result.text)).toEqual(['合成识别', '合成识别'])
  expect(state.peak).toBe(1)
})

it('releases queued recognition after a failed request', async () => {
  state.failNext = true
  const results = await Promise.allSettled([transcribeSamples(new Float32Array(16000).fill(.1), 16000), transcribeLocal('/synthetic-only.wav')])
  expect(results[0].status).toBe('rejected')
  expect(results[1].status).toBe('fulfilled')
  expect(state.active).toBe(0)
})

it('rejects excess requests without blocking admitted work or later recovery', async () => {
  const audio = new Float32Array(16000).fill(.1)
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => transcribeSamples(audio, 16000)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(4)
  expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual(['local_transcriber_busy', 'local_transcriber_busy'])
  expect((await transcribeSamples(audio, 16000)).text).toBe('合成识别')
})
