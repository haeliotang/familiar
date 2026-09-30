import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { observeAudioFile } from './audio-observations'

it('preserves normalized recording and signal observations when speech detection fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'friend-vad-fallback-'))
  const path = join(root, 'synthetic-silence.wav')
  const audio = Buffer.alloc(44 + 16000 * 3 * 2)
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
  try {
    await writeFile(path, audio)
    const result = await observeAudioFile(path, async () => { throw new Error('synthetic_model_unavailable') })
    expect(result.speechActivity).toEqual({ status: 'unavailable', modelId: 'silero-vad-v4' })
    expect(result).toMatchObject({ signalStatus: 'insufficient_energy', durationSec: 3, speechRate: null, pitch: null, subjectAttribution: 'unverified' })
    expect(result.normalizedAudioSha256).toBe(createHash('sha256').update(audio).digest('hex'))
    expect(await readFile(path)).toEqual(audio)
  } finally { await rm(root, { recursive: true, force: true }) }
})
