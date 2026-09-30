import { beforeEach, expect, it, vi } from 'vitest'
import { samplePlayback } from './sample-playback'

const wind = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock('./ambient', () => ({ startWind: wind.start }))
beforeEach(() => { vi.clearAllMocks(); wind.start.mockReturnValue(wind.stop) })

function audio() {
  const nodes: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; buffer?: AudioBuffer }[] = []
  const context = {
    currentTime: 10, state: 'suspended',
    resume: vi.fn(async () => { context.state = 'running' }),
    suspend: vi.fn(async () => { context.state = 'suspended' }),
    createBufferSource: vi.fn(() => {
      const node = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn() }
      nodes.push(node)
      return node
    }),
  }
  return { context, nodes, player: samplePlayback(context as unknown as AudioContext, { duration: 2 } as AudioBuffer, {} as AudioNode) }
}

it('schedules speech on the same clock and resumes without creating a duplicate voice', async () => {
  const { context, nodes, player } = audio()
  await player.start()
  expect(nodes[0].start).toHaveBeenCalledWith(53)
  expect(wind.start).toHaveBeenCalledWith(context, 10, 75, 43, 2)
  context.currentTime = 30
  expect(player.time).toBe(20)
  await player.pause()
  expect(player.state).toBe('paused')
  expect(player.time).toBe(20)
  await player.resume()
  expect(nodes).toHaveLength(1)
  expect(player.state).toBe('playing')
})

it('stops previous audio on replay and releases wind when the timeline ends', async () => {
  const { context, nodes, player } = audio()
  await player.start()
  await player.start()
  expect(nodes[0].stop).toHaveBeenCalledOnce()
  expect(nodes[0].disconnect).toHaveBeenCalledOnce()
  context.currentTime = 100
  expect(player.time).toBe(75)
  expect(player.state).toBe('finished')
  expect(nodes[1].stop).toHaveBeenCalledOnce()
  expect(wind.stop).toHaveBeenCalledTimes(2)
  await player.stop()
  expect(player.time).toBe(0)
})

it('does not schedule sound if stopped while audio unlocking is pending', async () => {
  const { context, nodes, player } = audio()
  let unlock!: () => void
  context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = () => { context.state = 'running'; resolve() } }))
  const pending = player.start()
  await player.stop()
  unlock()
  await pending
  expect(nodes).toHaveLength(0)
  expect(player.state).toBe('idle')
})

it('disposes pending playback synchronously without suspending a closing context', async () => {
  const { context, nodes, player } = audio()
  let unlock!: () => void
  context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = resolve }))
  const pending = player.start()
  player.dispose()
  context.state = 'closed'
  unlock()
  await pending
  expect(nodes).toHaveLength(0)
  expect(context.suspend).not.toHaveBeenCalled()
  expect(player.state).toBe('idle')
})

it('keeps disposed playback idle when a pending resume finishes', async () => {
  const { context, nodes, player } = audio()
  await player.start()
  await player.pause()
  let unlock!: () => void
  context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = resolve }))
  const pending = player.resume()
  player.dispose()
  unlock()
  await pending
  expect(player.state).toBe('idle')
  expect(nodes).toHaveLength(1)
  expect(nodes[0].stop).toHaveBeenCalledOnce()
  expect(wind.stop).toHaveBeenCalledOnce()
})
