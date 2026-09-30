import * as THREE from 'three'

export function createEncounterSun() {
  const sun = new THREE.DirectionalLight(0xffe5bd, 2.3)
  sun.position.set(-4, 9, 5)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: .1, far: 60 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.bias = -.0002
  return sun
}
