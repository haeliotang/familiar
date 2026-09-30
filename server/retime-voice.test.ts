import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { retimeVoice } from './retime-voice'

it('adjusts synthetic tone duration while retaining frequency and the source bytes', async () => {
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
  const root = await mkdtemp(join(tmpdir(), 'friend-tempo-test-'))
  try {
    const path = join(root, 'tone.wav')
    const samples = Float32Array.from({ length: 24000 * 3 }, (_, i) => .2 * Math.sin(2 * Math.PI * 110 * i / 24000))
    sherpa.writeWave(path, { samples, sampleRate: 24000 })
    const source = await readFile(path)
    for (const speed of [.8, 1.2]) {
      const output = await retimeVoice(source, speed)
      const target = join(root, `${speed}.wav`)
      await writeFile(target, output)
      const wave = sherpa.readWave(target) as { samples: Float32Array; sampleRate: number }
      expect(Math.abs(wave.samples.length / wave.sampleRate - 3 / speed)).toBeLessThan(.1)
      const from = Math.floor(.2 * wave.sampleRate)
      const to = wave.samples.length - from
      let crossings = 0
      for (let i = from + 1; i < to; i++) if (wave.samples[i - 1] <= 0 && wave.samples[i] > 0) crossings++
      expect(Math.abs(crossings / ((to - from) / wave.sampleRate) - 110)).toBeLessThan(1)
    }
    expect(await retimeVoice(source, 1)).toEqual(source)
    expect(await readFile(path)).toEqual(source)
    await expect(retimeVoice(source, 1.3)).rejects.toThrow('unsupported_voice_parameters')
  } finally { await rm(root, { recursive: true, force: true }) }
})
