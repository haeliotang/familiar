import * as THREE from 'three'

export type ViewingPosition = 'original' | 'near' | 'seated'

export function viewingPose(original: readonly [number, number, number], target: readonly [number, number, number], position: ViewingPosition, turn: number) {
  const eye = new THREE.Vector3(...original)
  if (position !== 'original') eye.set(3.2, position === 'seated' ? 1.15 : 1.7, 4.5)
  const direction = new THREE.Vector3(...target).sub(eye)
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.clamp(turn, -Math.PI / 3, Math.PI / 3))
  return { eye, target: eye.clone().add(direction) }
}
