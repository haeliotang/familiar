import * as THREE from 'three'
import { expect, it } from 'vitest'
import { disposeScene } from './dispose-scene'

it('releases every geometry and shared material once across nested scene objects', () => {
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  const geometry = new THREE.SphereGeometry()
  const otherGeometry = new THREE.CylinderGeometry()
  const material = new THREE.MeshStandardMaterial()
  const otherMaterial = new THREE.MeshStandardMaterial()
  const released = { geometry: 0, otherGeometry: 0, material: 0, otherMaterial: 0 }
  geometry.addEventListener('dispose', () => released.geometry++)
  otherGeometry.addEventListener('dispose', () => released.otherGeometry++)
  material.addEventListener('dispose', () => released.material++)
  otherMaterial.addEventListener('dispose', () => released.otherMaterial++)
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material, otherMaterial]))
  scene.add(group, new THREE.Mesh(otherGeometry, material), new THREE.HemisphereLight())
  const sun = new THREE.DirectionalLight()
  sun.shadow.map = new THREE.WebGLRenderTarget(16, 16)
  let shadowReleased = false
  sun.shadow.map.addEventListener('dispose', () => { shadowReleased = true })
  scene.add(sun)
  disposeScene(scene)
  expect(released).toEqual({ geometry: 1, otherGeometry: 1, material: 1, otherMaterial: 1 })
  expect(scene.children).toHaveLength(0)
  expect(shadowReleased).toBe(true)
})

it('releases shared imported textures, decoded bitmaps and skeleton buffers', () => {
  const scene = new THREE.Scene()
  const texture = new THREE.Texture()
  let textureDisposals = 0
  let bitmapCloses = 0
  texture.image = { close: () => bitmapCloses++ }
  texture.addEventListener('dispose', () => textureDisposals++)
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture })
  const skeleton = new THREE.Skeleton([new THREE.Bone()])
  skeleton.computeBoneTexture()
  let skeletonDisposals = 0
  skeleton.boneTexture!.addEventListener('dispose', () => skeletonDisposals++)
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material)
    mesh.skeleton = skeleton
    scene.add(mesh)
  }
  disposeScene(scene)
  expect(textureDisposals).toBe(1)
  expect(bitmapCloses).toBe(1)
  expect(skeletonDisposals).toBe(1)
})
