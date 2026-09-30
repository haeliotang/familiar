import { currentVoiceVersion, femaleVoiceVersion } from '../src/voice-catalog'
import { expect, it } from 'vitest'
import { recordedVoice, verifyRecordedVoice } from './recorded-voice'

for (const version of [currentVoiceVersion, femaleVoiceVersion]) it.each(['general', 'wait', 'repair'] as const)(`loads the exact retained audio for %s in ${version}`, async cue => {
  const audio = await recordedVoice(cue, version)
  expect(audio.subarray(0, 4).toString()).toBe('RIFF')
  expect(verifyRecordedVoice(audio, cue, version)).toBe(audio)
  const changed = Buffer.from(audio)
  changed[changed.length - 1] ^= 1
  expect(() => verifyRecordedVoice(changed, cue, version)).toThrow('recorded_voice_changed')
})
