import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createPickupProp } from './pickup-prop'
import { pickupContactPhase, pickupEnd, pickupStart } from './pickup-performance'
import { disposeScene } from './dispose-scene'

it('places a solid object on a grounded table and restores it after release, rewind and exit', () => {
  const scene = new THREE.Scene()
  const character = new THREE.Group()
  const hand = new THREE.Bone(); hand.name = 'hand_l'; hand.position.set(.6, 1, -2.4)
  const index = new THREE.Bone(); index.name = 'index_01_l'; index.position.set(.03, 0, .03)
  const thumb = new THREE.Bone(); thumb.name = 'thumb_01_l'; thumb.position.set(.03, 0, -.03)
  character.add(hand); hand.add(index, thumb); scene.add(character)
  const prop = createPickupProp(character, .01)
  scene.add(prop.group)
  const world = () => { scene.updateMatrixWorld(true); return prop.object.getWorldPosition(new THREE.Vector3()) }
  try {
    const resting = world()
    expect(resting.distanceTo(prop.contact)).toBeLessThan(.000001)
    const surface = new THREE.Box3().setFromObject(prop.group.children[0])
    const object = new THREE.Box3().setFromObject(prop.object)
    expect(object.min.y).toBeCloseTo(surface.max.y)
    for (const leg of prop.group.children.slice(1, 5)) {
      const bounds = new THREE.Box3().setFromObject(leg)
      expect(bounds.min.y).toBeCloseTo(.01)
      expect(bounds.max.y).toBeCloseTo(surface.min.y)
    }
    expect(prop.update(pickupStart + pickupContactPhase)).toBe(true)
    expect(world().distanceTo(resting)).toBeLessThan(.000001)
    hand.position.y += .2
    expect(world().y).toBeCloseTo(resting.y + .2)
    expect(prop.update(pickupEnd)).toBe(false)
    expect(world()).toEqual(resting)
    expect(prop.update(30)).toBe(true)
    prop.detach(); expect(prop.object.parent).toBe(prop.group)
    expect(world()).toEqual(resting)
    expect(prop.update(0)).toBe(false)
  } finally { prop.detach(); disposeScene(scene) }
})

it('rejects a rig missing the actual palm joints', () => {
  expect(() => createPickupProp(new THREE.Group(), .01)).toThrow('missing_pickup_joint')
})
