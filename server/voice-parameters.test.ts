import { expect, it } from 'vitest'
import { generateVoiceSamples, generateVoicePhrase, voicePhrases } from './tts'

it('rejects unsupported voice controls before loading the model', async () => {
  for (const speed of [NaN, Infinity, .7, 1.3]) await expect(generateVoiceSamples('wait', 58, speed)).rejects.toThrow('unsupported_voice_parameters')
  for (const speaker of [-1, 103, .5]) await expect(generateVoiceSamples('wait', speaker, 1)).rejects.toThrow('unsupported_voice_parameters')
})

it('keeps phrase boundaries in the written line and rejects unsupported parts before synthesis', async () => {
  expect(voicePhrases('wait')).toEqual(['不用急。', '我走慢一点。'])
  expect(voicePhrases('repair')).toEqual(['再试试。', '这下应该好了。'])
  expect(voicePhrases('general')).toEqual(['今天的风很好。'])
  for (const part of [-1, 2, .5, NaN]) await expect(generateVoicePhrase('wait', part)).rejects.toThrow('unsupported_voice_parameters')
})

it('retains the original comma when testing source phrase boundaries', () => {
  expect(voicePhrases('repair', 'original')).toEqual(['再试试，', '这下应该好了。'])
  expect(voicePhrases('wait', 'original')).toEqual(['不用急，', '我走慢一点。'])
})
