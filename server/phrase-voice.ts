import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Cue } from '../src/encounter'
import { phrasePacks } from './phrase-catalog'

export async function recordedPhrases(cue: Cue, voiceVersion: string) {
  const pack = phrasePacks[voiceVersion]
  if (!pack || !pack.hashes[cue]) throw new Error('unsupported_phrase_version')
  const audio: Buffer[] = []
  for (const [part, expected] of pack.hashes[cue].entries()) {
    const bytes = await readFile(join(process.cwd(), 'public/assets/voices', voiceVersion, 'phrases-v1', `${cue}-${part}.wav`))
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('recorded_phrase_changed')
    audio.push(bytes)
  }
  return { audio, version: pack.version, hashes: pack.hashes[cue] }
}

export function voicePcm(audio: Buffer) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('unsupported_voice_audio')
  let sampleRate = 0
  const chunks: Buffer[] = []
  for (let at = 12; at + 8 <= audio.length;) {
    const size = audio.readUInt32LE(at + 4)
    const start = at + 8
    if (start + size > audio.length) throw new Error('unsupported_voice_audio')
    const kind = audio.toString('ascii', at, at + 4)
    if (kind === 'fmt ') {
      if (size < 16 || audio.readUInt16LE(start) !== 1 || audio.readUInt16LE(start + 2) !== 1 || audio.readUInt16LE(start + 14) !== 16 || audio.readUInt16LE(start + 12) !== 2) throw new Error('unsupported_voice_audio')
      sampleRate = audio.readUInt32LE(start + 4)
      if (sampleRate < 8000 || sampleRate > 48000 || audio.readUInt32LE(start + 8) !== sampleRate * 2) throw new Error('unsupported_voice_audio')
    }
    if (kind === 'data') { if (size % 2) throw new Error('unsupported_voice_audio'); chunks.push(audio.subarray(start, start + size)) }
    at = start + size + size % 2
  }
  const pcm = Buffer.concat(chunks)
  const durationSec = pcm.length / (sampleRate * 2)
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 12) throw new Error('unsupported_voice_audio')
  return { pcm, sampleRate, durationSec }
}

export function joinVoicePhrases(parts: Buffer[], addedPauseSec: number) {
  if (parts.length !== 2 || !Number.isFinite(addedPauseSec) || addedPauseSec < .25 || addedPauseSec > .65) throw new Error('unsupported_pause_parameters')
  const waves = parts.map(voicePcm)
  const sampleRate = waves[0].sampleRate
  if (waves.some(wave => wave.sampleRate !== sampleRate)) throw new Error('phrase_sample_rate_mismatch')
  const gap = Buffer.alloc(Math.round(addedPauseSec * sampleRate) * 2)
  const pcm = Buffer.concat([waves[0].pcm, gap, waves[1].pcm])
  if (pcm.length / (sampleRate * 2) > 12) throw new Error('unsupported_voice_audio')
  const header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
