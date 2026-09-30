import * as THREE from 'three'
import { expect, it } from 'vitest'
import { candidateAvatarVersions } from './avatar-catalog'
import { createRepairCrate } from './repair-prop'
import { disposeScene } from './dispose-scene'

it.each(candidateAvatarVersions)('keeps the crate beside the stop position and clear of the onward route for %s', version => {
  const crate = createRepairCrate(version, .975)
  const bounds = new THREE.Box3().setFromObject(crate)
  expect(bounds.min.y).toBeCloseTo(.01)
  expect(bounds.min.x).toBeGreaterThan(.32)
  expect(crate.position.z).toBeCloseTo(-2.4)
  expect(bounds.max.y).toBeLessThan(.23)
  const scene = new THREE.Scene()
  scene.add(crate)
  disposeScene(scene)
})
