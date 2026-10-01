import * as THREE from 'three'
import { pickupAttached } from './pickup-performance'

// Call at the fully weighted contact pose, after grounding the combined character.
export function createPickupProp(character: THREE.Object3D, floorHeight: number) {
  const hand = character.getObjectByName('hand_l')
  const index = character.getObjectByName('index_01_l')
  const thumb = character.getObjectByName('thumb_01_l')
  if (!hand || !index || !thumb) throw new Error('missing_pickup_joint')
  character.updateMatrixWorld(true)
  const contact = index.getWorldPosition(new THREE.Vector3()).add(thumb.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5)
  const localGrip = hand.worldToLocal(contact.clone())
  const height = contact.y - floorHeight - .035
  if (!Number.isFinite(height) || height <= .08) throw new Error('invalid_pickup_table_height')
  const group = new THREE.Group()
  group.position.set(contact.x, floorHeight, contact.z)
  const wood = new THREE.MeshStandardMaterial({ color: 0x967554, roughness: .9 })
  const top = new THREE.Mesh(new THREE.BoxGeometry(.24, .06, .22), wood)
  top.position.set(.08, height - .03, 0)
  group.add(top)
  for (const x of [-.01, .17]) for (const z of [-.07, .07]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.05, height - .06, .05), wood)
    leg.position.set(x, (height - .06) / 2, z)
    group.add(leg)
  }
  const object = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb27a43, roughness: .8 }))
  const resting = new THREE.Vector3(0, height + .035, 0)
  group.add(object)
  object.position.copy(resting)
  group.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true } })
  return {
    group, object, contact,
    update(seconds: number) {
      const attached = pickupAttached(seconds)
      if (attached) { hand.add(object); object.position.copy(localGrip) }
      else { group.add(object); object.position.copy(resting) }
      object.quaternion.identity()
      return attached
    },
    // Keep prop geometry outside the rig's bounds/disposal traversal.
    detach() { group.add(object); object.position.copy(resting) },
  }
}
