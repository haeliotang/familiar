import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createEncounterSun } from './encounter-sun'
import { characterPlan } from './character-timeline'

it('covers the actor from the initial seated position through the end of the walking route', () => {
  const sun = createEncounterSun()
  sun.updateMatrixWorld(true)
  sun.target.updateMatrixWorld(true)
  sun.shadow.updateMatrices(sun)
  const frustum = sun.shadow.getFrustum()
  for (let seconds = 0; seconds <= 75; seconds++) {
    const z = characterPlan(seconds, 'general', .975, 12, 'character-timeline-v3').z
    for (const x of [-.4, .4]) for (const y of [0, 2]) expect(frustum.containsPoint(new THREE.Vector3(x, y, z)), `time ${seconds}, height ${y}`).toBe(true)
  }
})
