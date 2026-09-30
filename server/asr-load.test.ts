import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { LocalTranscriberBusy, transcribeSamples } from './asr'

it('bounds twenty simultaneous real-model requests and recovers after the admitted queue drains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'familiar-asr-load-'))
  try {
    const path = join(root, 'synthetic.wav')
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', 'public/assets/voices/kokoro-zh-zm009-v1/wait.wav', '-ar', '16000', '-ac', '1', path])
    const wave = createRequire(import.meta.url)('sherpa-onnx-node').readWave(path) as { samples: Float32Array; sampleRate: number }
    const baseline = await transcribeSamples(wave.samples, wave.sampleRate)
    expect(baseline.text).toBeTruthy()
    const started = performance.now()
    const terminalMs: number[] = []
    const results = await Promise.allSettled(Array.from({ length: 20 }, async () => {
      try { return await transcribeSamples(wave.samples, wave.sampleRate) }
      finally { terminalMs.push(Math.round(performance.now() - started)) }
    }))
    const admitted = results.filter(result => result.status === 'fulfilled') as PromiseFulfilledResult<typeof baseline>[]
    const rejected = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[]
    expect(admitted).toHaveLength(4)
    expect(rejected).toHaveLength(16)
    for (const result of admitted) expect(result.value).toEqual(baseline)
    for (const result of rejected) expect(result.reason).toBeInstanceOf(LocalTranscriberBusy)
    expect(await transcribeSamples(wave.samples, wave.sampleRate)).toEqual(baseline)
    terminalMs.sort((a, b) => a - b)
    console.log(JSON.stringify({ scope: 'actual Whisper tiny int8 CPU; synthetic wait clip; warm model; single process; direct model admission', completed: 4, busy: 16, maxObservedTerminalMs: terminalMs.at(-1), recovery: 'passed' }))
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)
