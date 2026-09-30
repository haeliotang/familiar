import { expect, it } from 'vitest'
import { recordedPhrases, voicePcm, joinVoicePhrases } from './phrase-voice'

it.each(['kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1'])('loads retained phrase hashes and inserts exact PCM silence for %s', async version => {
  for (const cue of ['general', 'wait', 'repair'] as const) {
    const pack = await recordedPhrases(cue, version)
    expect(pack.audio).toHaveLength(cue === 'general' ? 1 : 2)
    if (cue === 'general') continue
    const before = pack.audio.map(audio => Buffer.from(audio))
    const [first, second] = pack.audio.map(voicePcm)
    for (const pause of [.25, .65]) {
      const output = voicePcm(joinVoicePhrases(pack.audio, pause))
      const gapBytes = Math.round(pause * first.sampleRate) * 2
      expect(output.pcm.subarray(0, first.pcm.length)).toEqual(first.pcm)
      expect(output.pcm.subarray(first.pcm.length, first.pcm.length + gapBytes)).toEqual(Buffer.alloc(gapBytes))
      expect(output.pcm.subarray(first.pcm.length + gapBytes)).toEqual(second.pcm)
      expect(output.durationSec).toBeCloseTo(first.durationSec + second.durationSec + pause, 4)
    }
    expect(pack.audio).toEqual(before)
  }
})

it('rejects malformed PCM, mismatched rates and unsupported pauses', async () => {
  const pack = await recordedPhrases('wait', 'kokoro-zh-zm009-v1')
  for (const pause of [NaN, .2, .7]) expect(() => joinVoicePhrases(pack.audio, pause)).toThrow('unsupported_pause_parameters')
  expect(() => voicePcm(pack.audio[0].subarray(0, 42))).toThrow('unsupported_voice_audio')
  const mismatched = Buffer.from(pack.audio[1])
  mismatched.writeUInt32LE(16000, 24); mismatched.writeUInt32LE(32000, 28)
  expect(() => joinVoicePhrases([pack.audio[0], mismatched], .25)).toThrow('phrase_sample_rate_mismatch')
})
