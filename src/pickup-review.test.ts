import { readFileSync } from 'node:fs'
import { Bone, Box3, Scene, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { createPickupReviewTarget } from './pickup-review'
import { disposeScene } from './dispose-scene'

it.each(['male', 'female'])('places the %s target at the actual maximum left hand reach with grounded table legs', gender => {
  const samples = JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-v1/interaction-candidate-v1/joint-samples.json`, 'utf8'))
  const frames = samples.samples.find((sample: { clip: string }) => sample.clip === 'PickUp_Table').frames
  const { target, reachTime, jointPosition, targetPosition } = createPickupReviewTarget(frames)
  const scene = new Scene()
  scene.add(target)
  try {
    expect(jointPosition[2]).toBe(Math.max(...frames.map((frame: { positions: { hand_l: number[] } }) => frame.positions.hand_l[2])))
    expect(reachTime).toBeGreaterThan(0)
    expect(reachTime).toBeLessThan(.83)
    expect(target.children[0].position.toArray()).toEqual(targetPosition)
    expect(targetPosition).not.toEqual(jointPosition)
    const surface = new Box3().setFromObject(target.children[1])
    for (const leg of target.children.slice(2)) {
      const bounds = new Box3().setFromObject(leg)
      expect(bounds.min.y).toBeCloseTo(0)
      expect(bounds.max.y).toBeCloseTo(surface.min.y)
    }
  } finally { disposeScene(scene) }
})

it('rejects missing or nonfinite contact samples', () => {
  expect(() => createPickupReviewTarget([])).toThrow('invalid_pickup_samples')
  expect(() => createPickupReviewTarget([{ timeSec: 0, gripPoint: [0, 1, 0], handQuaternion: [0, 0, 0, 1], positions: { hand_l: [0, NaN, 0] } }])).toThrow('invalid_pickup_samples')
})

it('moves the marker with the hand after contact and restores its tabletop position on backward seeking', () => {
  const { target, updateGrip } = createPickupReviewTarget([{ timeSec: .2, gripPoint: [.03, 1, .4], handQuaternion: [0, 0, 0, 1], positions: { hand_l: [0, 1, .4] } }])
  const scene = new Scene()
  const hand = new Bone()
  hand.position.set(0, 1, .4)
  scene.add(target, hand)
  const marker = target.children[0]
  const position = () => { scene.updateMatrixWorld(true); return marker.getWorldPosition(new Vector3()).toArray() }
  try {
    expect(updateGrip(hand, .19)).toBe(false)
    expect(position()).toEqual([.03, 1, .4])
    expect(updateGrip(hand, .2)).toBe(true)
    expect(position()).toEqual([.03, 1, .4])
    hand.position.set(.2, 1.2, 0)
    expect(position()).toEqual([.23, 1.2, 0])
    expect(updateGrip(hand, .1)).toBe(false)
    expect(position()).toEqual([.03, 1, .4])
    expect(updateGrip(undefined, 1)).toBe(false)
    expect(marker.parent).toBe(target)
  } finally { disposeScene(scene) }
})
