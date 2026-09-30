import { expect, it } from 'vitest'
import { viewingPose } from './viewing-position'

it('preserves the recorded camera and moves the viewer beside the lane at standing or seated height', () => {
  const original = [3.2, 2.3, 8] as const
  const target = [0, 1, 0] as const
  expect(viewingPose(original, target, 'original', 0).eye.toArray()).toEqual(original)
  expect(viewingPose(original, target, 'original', 0).target.toArray()).toEqual(target)
  const near = viewingPose(original, target, 'near', 0)
  const seated = viewingPose(original, target, 'seated', 0)
  expect(near.eye.z).toBeLessThan(original[2])
  expect(near.eye.x).toBeGreaterThan(2.2)
  expect(seated.eye.y).toBeLessThan(near.eye.y)
  expect(seated.eye.x).toBe(near.eye.x)
  expect(seated.eye.z).toBe(near.eye.z)
})

it('limits turning and preserves viewing distance while allowing both directions', () => {
  const pose = (turn: number) => viewingPose([3.2, 2.3, 8], [0, 1, 0], 'near', turn)
  expect(pose(100).target.toArray()).toEqual(pose(Math.PI / 3).target.toArray())
  expect(pose(-100).target.toArray()).toEqual(pose(-Math.PI / 3).target.toArray())
  expect(pose(.3).target.toArray()).not.toEqual(pose(-.3).target.toArray())
  expect(pose(.3).target.distanceTo(pose(.3).eye)).toBeCloseTo(pose(0).target.distanceTo(pose(0).eye))
})
