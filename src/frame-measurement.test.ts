import { expect, it } from 'vitest'
import { frameMeasurement } from './frame-measurement'

it('requires ninety seconds and retains every original interval', () => {
  const measured = frameMeasurement()
  for (let time = 0; time <= 75000; time += 20) measured.record(time, true, 'playing')
  expect(measured.report().meetsFrameThreshold).toBe(false)
  for (let time = 75020; time <= 90000; time += 20) measured.record(time, true, 'finished')
  expect(measured.report()).toMatchObject({ meetsFrameThreshold: true, durationMs: 90000, withinBudgetRatio: 1, freezesOver500Ms: 0 })
  expect(measured.report().intervalsMs).toHaveLength(4500)
})

it.each(['hidden', 'freeze'])('keeps %s evidence and rejects a passing verdict', scenario => {
  const measured = frameMeasurement()
  measured.record(0, true, 'playing')
  measured.record(90000, scenario !== 'hidden', 'paused')
  expect(measured.report().meetsFrameThreshold).toBe(false)
  expect(measured.report().frames[1].playback).toBe('paused')
  expect(measured.report().freezesOver500Ms).toBe(1)
})
