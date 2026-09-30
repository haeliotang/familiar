import { expect, it, vi } from 'vitest'
import { updateVoiceListener } from './spatial-voice'

it('updates the modern listener position and orientation when the viewing camera moves', () => {
  const listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(name => [name, { value: 0 }]))
  updateVoiceListener({ listener } as unknown as BaseAudioContext, [3.2, 1.15, 4.5], [0, 0, -1], [0, 1, 0])
  expect([listener.positionX.value, listener.positionY.value, listener.positionZ.value]).toEqual([3.2, 1.15, 4.5])
  expect([listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value]).toEqual([0, 0, -1])
  expect([listener.upX.value, listener.upY.value, listener.upZ.value]).toEqual([0, 1, 0])
})

it('updates legacy listeners through their position and orientation methods', () => {
  const listener = { setPosition: vi.fn(), setOrientation: vi.fn() }
  updateVoiceListener({ listener } as unknown as BaseAudioContext, [3, 1, 4], [1, 0, 0], [0, 1, 0])
  expect(listener.setPosition).toHaveBeenCalledWith(3, 1, 4)
  expect(listener.setOrientation).toHaveBeenCalledWith(1, 0, 0, 0, 1, 0)
})
