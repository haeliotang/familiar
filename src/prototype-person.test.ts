import * as THREE from 'three'
import { expect, it } from 'vitest'
import { prototypePerson } from './prototype-person'
import { disposeScene } from './dispose-scene'
import type { Cue } from './encounter'

it.each<Cue>(['general', 'wait', 'repair'])('keeps prototype feet on or above the floor throughout %s', cue => {
  const { person, pose } = prototypePerson(0x685f62)
  const scene = new THREE.Scene()
  scene.add(person)
  const feet: THREE.Mesh[] = []
  person.traverse(object => { if (object instanceof THREE.Mesh && object.geometry instanceof THREE.BoxGeometry) feet.push(object) })
  try {
    expect(feet).toHaveLength(2)
    for (let tick = 0; tick <= 750; tick++) {
      person.position.set(0.4, 0, -1)
      person.rotation.y = 0.9
      pose(tick / 10, cue)
      person.updateMatrixWorld(true)
      const heights = feet.map(foot => new THREE.Box3().setFromObject(foot).min.y)
      expect(Math.min(...heights)).toBeCloseTo(0, 6)
      expect(heights.every(height => height >= -0.000001)).toBe(true)
    }
  } finally { disposeScene(scene) }
})
