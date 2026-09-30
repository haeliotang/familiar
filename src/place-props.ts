import * as THREE from 'three'
import type { SceneProp } from './scene-catalog'

export function createPlaceProps(props: SceneProp[]) {
  const group = new THREE.Group()
  for (const prop of props) {
    const geometry = prop.shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : prop.shape === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, 12) : new THREE.ConeGeometry(.5, 1, 4)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: prop.color, roughness: .9 }))
    mesh.scale.set(...prop.size)
    mesh.position.set(...prop.position)
    mesh.rotation.y = prop.rotationY ?? 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
