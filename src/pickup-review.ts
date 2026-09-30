import * as THREE from 'three'

export function createPickupReviewTarget(frames: Array<{ timeSec: number; gripPoint: number[]; handQuaternion: number[]; positions: { hand_l: number[] } }>) {
  if (!frames.length || frames.some(frame => !Number.isFinite(frame.timeSec) || frame.positions.hand_l.length !== 3 || !frame.positions.hand_l.every(Number.isFinite) || frame.gripPoint.length !== 3 || !frame.gripPoint.every(Number.isFinite) || frame.handQuaternion.length !== 4 || !frame.handQuaternion.every(Number.isFinite))) throw new Error('invalid_pickup_samples')
  const reach = frames.reduce((best, frame) => frame.positions.hand_l[2] > best.positions.hand_l[2] ? frame : best)
  const [x, y, z] = reach.gripPoint
  const localGrip = new THREE.Vector3().fromArray(reach.gripPoint).sub(new THREE.Vector3().fromArray(reach.positions.hand_l)).applyQuaternion(new THREE.Quaternion().fromArray(reach.handQuaternion).invert())
  const target = new THREE.Group()
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 8), new THREE.MeshStandardMaterial({ color: 0xdfa349, wireframe: true }))
  marker.position.set(x, y, z)
  target.add(marker)
  const wood = new THREE.MeshStandardMaterial({ color: 0x967554, roughness: .9 })
  const surfaceHeight = y - .07
  const surface = new THREE.Mesh(new THREE.BoxGeometry(.5, .06, .3), wood)
  surface.position.set(x, surfaceHeight - .03, z + .06)
  target.add(surface)
  for (const dx of [-.2, .2]) for (const dz of [-.1, .1]) {
    const height = surfaceHeight - .06
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.05, height, .05), wood)
    leg.position.set(x + dx, height / 2, z + .06 + dz)
    target.add(leg)
  }
  const updateGrip = (hand: THREE.Object3D | undefined, time: number) => {
    const attached = !!hand && time >= reach.timeSec
    if (attached) {
      hand.add(marker)
      marker.position.copy(localGrip)
    } else {
      target.add(marker)
      marker.position.set(x, y, z)
    }
    return attached
  }
  return { target, reachTime: reach.timeSec, jointPosition: reach.positions.hand_l, targetPosition: [x, y, z], updateGrip }
}
