import * as THREE from 'three'

// Candidate review only: prevents penetration, but does not solve foot sliding.
export function groundCharacter(character: THREE.Object3D, bounds: THREE.Box3, floorHeight = 0) {
  character.position.y = 0
  character.updateMatrixWorld(true)
  bounds.setFromObject(character, true)
  if (bounds.isEmpty()) throw new Error('empty_character_bounds')
  const offset = floorHeight - bounds.min.y
  character.position.y = offset
  character.updateMatrixWorld(true)
  return offset
}
