import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { retainedMaleAvatarVersion, sittingMaleAvatarVersion } from './avatar-catalog'
import { loadCharacter } from './load-character'

const loader = vi.hoisted(() => ({ load: vi.fn(), asset: vi.fn() }))
vi.mock('./verified-asset', () => ({ verifiedAsset: loader.asset }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { parseAsync = loader.load } }))
vi.mock('./candidate-character', () => ({ composeCandidateCharacter: (_base: THREE.Group, outfit: THREE.Group) => ({ character: outfit }) }))
afterEach(() => { vi.unstubAllGlobals(); loader.load.mockReset(); loader.asset.mockReset() })

function fixture(speed: number) {
  const library = JSON.parse(readFileSync('public/assets/quaternius/peasant-male-v1/animations.json', 'utf8'))
  loader.asset.mockImplementation(async (url: string) => new TextEncoder().encode(JSON.stringify(url.endsWith('animations.json') ? library : { forwardMetresPerSec: speed })).buffer)
  const disposals = [0, 0]
  const roots = [0, 1].map(index => {
    const scene = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    geometry.addEventListener('dispose', () => disposals[index]++)
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
    return { scene }
  })
  loader.load.mockResolvedValueOnce(roots[0]).mockResolvedValueOnce(roots[1])
  return { roots, disposals }
}

it('cleans every loaded model when metadata validation fails', async () => {
  const { disposals } = fixture(0)
  await expect(loadCharacter(retainedMaleAvatarVersion)).rejects.toThrow('invalid_character_motion')
  expect(disposals).toEqual([1, 1])
})

it('returns a usable character and releases its resources once on exit', async () => {
  const { roots, disposals } = fixture(.975)
  const result = await loadCharacter(retainedMaleAvatarVersion)
  const scene = new THREE.Scene()
  scene.add(result.character)
  expect(result.character).toBe(roots[1].scene)
  expect(result.clips).toHaveLength(4)
  result.dispose()
  result.dispose()
  expect(disposals).toEqual([1, 1])
  expect(scene.children).toHaveLength(0)
})

it('rejects unknown or missing episode versions before loading assets', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(loadCharacter('future-avatar')).rejects.toThrow('unsupported_character_version')
  await expect(loadCharacter(undefined)).rejects.toThrow('missing_character_version')
  expect(loader.load).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(loader.asset).not.toHaveBeenCalled()
})

it('rejects a sitting performance paired with the retained four-clip avatar before loading', async () => {
  await expect(loadCharacter(retainedMaleAvatarVersion, 'character-timeline-v3')).rejects.toThrow('unsupported_character_performance')
  expect(loader.asset).not.toHaveBeenCalled()
})

it('rejects an eight-clip performance paired with a seven-clip avatar before loading', async () => {
  await expect(loadCharacter(sittingMaleAvatarVersion, 'character-timeline-v4')).rejects.toThrow('unsupported_character_performance')
  expect(loader.asset).not.toHaveBeenCalled()
})

it('cleans models that finished loading when another asset fails integrity verification', async () => {
  const { disposals } = fixture(.975)
  loader.asset.mockImplementation(async (url: string) => {
    if (url.endsWith('animations.json')) throw new Error('character_asset_changed')
    return new TextEncoder().encode(JSON.stringify({ forwardMetresPerSec: .975 })).buffer
  })
  await expect(loadCharacter(retainedMaleAvatarVersion)).rejects.toThrow('character_asset_changed')
  expect(disposals).toEqual([1, 1])
})
