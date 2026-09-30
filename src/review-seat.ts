import * as THREE from 'three'

export function createReviewSeat(height = .46) {
  const seat = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0x967554, roughness: .9 })
  const surface = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, .55), material)
  seat.add(surface)
  const legs: THREE.Mesh[] = []
  for (const x of [-.27, .27]) for (const z of [-.205, .205]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.07, 1, .07), material)
    leg.position.set(x, 0, z)
    legs.push(leg)
    seat.add(leg)
  }
  seat.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true } })
  const setHeight = (value: number) => {
    if (!Number.isFinite(value) || value < .3 || value > .65) throw new Error('invalid_review_seat_height')
    surface.position.y = value - .04
    for (const leg of legs) { leg.scale.y = value - .08; leg.position.y = (value - .08) / 2 }
    seat.updateMatrixWorld(true)
  }
  setHeight(height)
  return { seat, setHeight }
}
