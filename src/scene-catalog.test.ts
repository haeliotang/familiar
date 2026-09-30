import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { sceneLayout, currentSceneVersion, candidateSceneIds, sceneForEncounter } from './scene-catalog'

it('keeps near-camera trees out of the revised prop view for every scene and sampled seed', () => {
  for (const scene of candidateSceneIds) for (const seed of [0, 1, 12345, 0xffffffff]) {
    const layout = sceneLayout('procedural-places-v3', scene, seed)
    expect(layout.trees.every(tree => tree.z < -8)).toBe(true)
    expect(layout.trees.length).toBeGreaterThan(0)
  }
})

it('retains every recorded v2 scene layout at seed 1', () => {
  const hashes = ['8927a455bd07d335237e47d0e985d6e6c1213bad6148242b087554d6ca1df2f0', '119a0b3958e059470d209675be9ecb438e042e44057ef6140886b895972e1402', 'cebee36abbe2d50fa59690ddce6429548e7223c273d75f93aba16ee94d19fb34', '28a9b317101e73d3c52dd4506c10ecb8e52b22b9d5a94ab7744638f94dd64e9b', 'b10bc77bb7f6a965f4a6764583a137ded17f17b164890227522ce89e915b07fc', '892818a07ac422381a8b3e615101ada9f27cbba529f90d717aff708a2184ba33']
  expect(candidateSceneIds.map(scene => createHash('sha256').update(JSON.stringify(sceneLayout('procedural-places-v2', scene, 1))).digest('hex'))).toEqual(hashes)
})

it('restores the same scene layout from its saved version and seed', () => {
  const first = sceneLayout(currentSceneVersion, 'riverside', 12345)
  expect(sceneLayout(currentSceneVersion, 'riverside', 12345)).toEqual(first)
  expect(sceneLayout(currentSceneVersion, 'riverside', 54321).trees).not.toEqual(first.trees)
  expect(first.trees.every(tree => Math.abs(tree.x) > 3.7)).toBe(true)
})

it('preserves the recorded v1 layout and rejects newer scenes under the old version', () => {
  expect(createHash('sha256').update(JSON.stringify(sceneLayout('procedural-path-v1', 'courtyard', 12345))).digest('hex')).toBe('b6a775a277a81555545eb00d698c7a813f3fb2064b1e4ba08cdcd23b3d690352')
  expect(() => sceneLayout('procedural-path-v1', 'farm', 1)).toThrow('unsupported_scene')
})

it('cycles through six distinct deterministic places without exposing mutable catalog arrays', () => {
  expect(Array.from({ length: 6 }, (_, count) => sceneForEncounter(count))).toEqual(candidateSceneIds)
  expect(sceneForEncounter(6)).toBe('riverside')
  const layouts = candidateSceneIds.map(scene => sceneLayout(currentSceneVersion, scene, 1))
  expect(new Set(layouts.map(layout => JSON.stringify(layout))).size).toBe(6)
  const first = layouts[0]
  if (!first.props) throw new Error('missing_props')
  first.props[0].position[0] = 0
  expect(sceneLayout(currentSceneVersion, 'riverside', 1)).not.toEqual(first)
})

it('rejects unknown versions and invalid seeds instead of choosing current defaults', () => {
  expect(() => sceneLayout('future', 'riverside', 1)).toThrow('unsupported_scene_version')
  expect(() => sceneLayout(undefined, 'riverside', 1)).toThrow('missing_scene_version')
  expect(() => sceneLayout(currentSceneVersion, 'riverside', NaN)).toThrow('invalid_scene_seed')
  expect(() => sceneLayout(currentSceneVersion, 'riverside', -1)).toThrow('invalid_scene_seed')
})
