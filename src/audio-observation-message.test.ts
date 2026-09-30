import { expect, it } from 'vitest'
import { audioObservationMessage } from './audio-observation-message'

it('offers a useful recording decision without claiming speech identity or transfer', () => {
  expect(audioObservationMessage('insufficient_energy')).toContain('选择更清晰的录音')
  expect(audioObservationMessage('clipped')).toContain('可能有失真')
  expect(audioObservationMessage('measured')).toContain('尚未确认说话主体')
  expect(audioObservationMessage(undefined)).toContain('仍使用预设声音')
})
