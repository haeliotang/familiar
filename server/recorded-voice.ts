import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Cue } from '../src/encounter'
import { currentVoiceVersion, voicePackage } from '../src/voice-catalog'

export function verifyRecordedVoice(audio: Buffer, cue: Cue, version = currentVoiceVersion) {
  if (createHash('sha256').update(audio).digest('hex') !== voicePackage(version).hashes[cue]) throw new Error('recorded_voice_changed')
  return audio
}

export async function recordedVoice(cue: Cue, version = currentVoiceVersion) {
  voicePackage(version)
  const audio = await readFile(join(process.cwd(), 'public/assets/voices', version, `${cue}.wav`))
  return verifyRecordedVoice(audio, cue, version)
}
