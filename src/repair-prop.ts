import * as THREE from 'three'
import { avatarAssets, femaleAvatarVersion, retainedFemaleAvatarVersion, sittingFemaleAvatarVersion, pickupFemaleAvatarVersion } from './avatar-catalog'

export function createRepairCrate(avatarVersion: string, walkingSpeed: number) {
  avatarAssets(avatarVersion)
  const height = avatarVersion === femaleAvatarVersion || avatarVersion === retainedFemaleAvatarVersion || avatarVersion === sittingFemaleAvatarVersion || avatarVersion === pickupFemaleAvatarVersion ? .2 : .21
  const crate = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x89623e, roughness: 1 })
  const lid = new THREE.MeshStandardMaterial({ color: 0xa47b4d, roughness: 1 })
  const add = (size: [number, number, number], position: [number, number, number], material = wood) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    crate.add(mesh)
  }
  add([.5, .025, .85], [0, .0125, 0])
  add([.025, height, .85], [-.2375, height / 2, 0])
  add([.025, height, .85], [.2375, height / 2, 0])
  add([.45, height, .025], [0, height / 2, -.4125])
  add([.45, height, .025], [0, height / 2, .4125])
  for (const z of [-.28, 0, .28]) add([.5, .018, .26], [0, height - .009, z], lid)
  // The v2 actor turns towards +X; this leaves the forward walking route clear.
  crate.position.set(.58, .01, -18 + 16 * walkingSpeed)
  return crate
}
