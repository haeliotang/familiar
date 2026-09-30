import * as THREE from 'three'

export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const skeletons = new Set<THREE.Skeleton>()
  const bitmaps = new Set<{ close: () => void }>()
  scene.traverse(object => {
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) object.shadow.dispose()
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    material.dispose()
  }
  for (const texture of textures) {
    if (texture.image && typeof texture.image.close === 'function') bitmaps.add(texture.image)
    texture.dispose()
  }
  for (const bitmap of bitmaps) bitmap.close()
  for (const skeleton of skeletons) skeleton.dispose()
  scene.clear()
}
