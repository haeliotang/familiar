import * as THREE from 'three'
import { expect, it } from 'vitest'
import { composeCandidateCharacter } from './candidate-character'

it('keeps only the head region and follows the outfit head joint in its local coordinates', () => {
  const base = new THREE.Group()
  const sourceHead = new THREE.Bone()
  sourceHead.name = 'Head'
  sourceHead.position.y = 1.5
  base.add(sourceHead)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.1,1.7,0, .1,1.7,0, 0,1.8,0, -.2,1,0, .2,1,0, 0,1.2,0], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(24).fill(0), 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], 4))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(.8), 3))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
  base.add(mesh)
  base.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([sourceHead]))
  const outfit = new THREE.Group()
  const targetHead = new THREE.Bone()
  targetHead.name = 'Head'
  targetHead.position.y = 2
  outfit.add(targetHead)
  const result = composeCandidateCharacter(base, outfit)
  expect(result.headTriangles).toBe(1)
  const headMesh = targetHead.children[0] as THREE.Mesh
  expect(headMesh.geometry.attributes.position.count).toBe(3)
  expect(headMesh.geometry.attributes.color?.getX(0)).toBeCloseTo(.8)
  outfit.updateMatrixWorld(true)
  expect(new THREE.Box3().setFromObject(headMesh).min.y).toBeCloseTo(2.2)
  targetHead.position.y += .5
  outfit.updateMatrixWorld(true)
  expect(new THREE.Box3().setFromObject(headMesh).min.y).toBeCloseTo(2.7)
})

it('rejects a rig without a head joint', () => {
  expect(() => composeCandidateCharacter(new THREE.Group(), new THREE.Group())).toThrow('missing_head_joint')
})
