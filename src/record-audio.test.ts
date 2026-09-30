import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recordAudio } from './record-audio'

let recorder: FakeRecorder
class FakeRecorder {
  static isTypeSupported(type: string) { return type === 'audio/mp4' }
  state = 'inactive'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  constructor() { recorder = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['last']) }); this.onstop?.() }
}
function stream() {
  const stop = vi.fn()
  return { stop, value: { getTracks: () => [{ stop }] } as unknown as MediaStream }
}
beforeEach(() => { vi.stubGlobal('MediaRecorder', FakeRecorder); vi.useFakeTimers() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('retains the final recording chunk and uses an accepted file type', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  recorder.ondataavailable?.({ data: new Blob(['first']) })
  recording.stop()
  const file = await recording.result
  expect(file?.type).toBe('audio/mp4')
  expect(file?.name.endsWith('.m4a')).toBe(true)
  expect(await file?.text()).toBe('firstlast')
  expect(input.stop).toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('discards cancelled audio and releases the microphone', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  recording.cancel()
  expect(await recording.result).toBeUndefined()
  expect(input.stop).toHaveBeenCalled()
})
it('automatically stops at 180 seconds', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  vi.advanceTimersByTime(180_000)
  expect((await recording.result)?.size).toBe(4)
  expect(recorder.state).toBe('inactive')
  expect(input.stop).toHaveBeenCalled()
})
it('rejects oversized audio and releases the microphone', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  const rejected = expect(recording.result).rejects.toThrow('recording_too_large')
  recorder.ondataavailable?.({ data: { size: 30 * 1024 * 1024 + 1 } as Blob })
  await rejected
  expect(input.stop).toHaveBeenCalled()
})
it('releases the microphone if no supported recording format exists', () => {
  vi.spyOn(FakeRecorder, 'isTypeSupported').mockReturnValue(false)
  const input = stream()
  expect(() => recordAudio(input.value)).toThrow('recording_unsupported')
  expect(input.stop).toHaveBeenCalled()
})

it('releases the microphone if the encoder cannot start', () => {
  vi.spyOn(FakeRecorder.prototype, 'start').mockImplementation(() => { throw new Error('encoder_start_failed') })
  const input = stream()
  expect(() => recordAudio(input.value)).toThrow('encoder_start_failed')
  expect(input.stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects encoder failures instead of publishing a partial recording', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  const rejected = expect(recording.result).rejects.toThrow('recording_failed')
  recorder.ondataavailable?.({ data: new Blob(['partial']) })
  recorder.onerror?.()
  await rejected
  expect(input.stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for the final asynchronous chunk even when stop is clicked twice', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  recorder.ondataavailable?.({ data: new Blob(['first']) })
  const stop = vi.spyOn(recorder, 'stop').mockImplementation(() => { recorder.state = 'inactive' })
  recording.stop()
  recording.stop()
  expect(stop).toHaveBeenCalledOnce()
  expect(input.stop).not.toHaveBeenCalled()
  recorder.ondataavailable?.({ data: new Blob(['tail']) })
  recorder.onstop?.()
  expect(await (await recording.result)?.text()).toBe('firsttail')
  expect(input.stop).toHaveBeenCalledOnce()
})

it('allows cancelling a pending stop without keeping the microphone open', async () => {
  const input = stream()
  const recording = recordAudio(input.value)
  vi.spyOn(recorder, 'stop').mockImplementation(() => { recorder.state = 'inactive' })
  recording.stop()
  recording.cancel()
  expect(input.stop).toHaveBeenCalledOnce()
  recorder.ondataavailable?.({ data: new Blob(['discard']) })
  recorder.onstop?.()
  expect(await recording.result).toBeUndefined()
})
