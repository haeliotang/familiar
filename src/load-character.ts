import { verifiedAsset } from './verified-asset'
import { avatarAssets } from './avatar-catalog'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { composeCandidateCharacter } from './candidate-character'
import { parseCharacterClips } from './character-clips'
import { disposeScene } from './dispose-scene'

export async function loadCharacter(version: string | undefined, performanceVersion?: string) {
  const assets = avatarAssets(version)
  if (performanceVersion === 'character-timeline-v3' && !assets.sitting) throw new Error('unsupported_character_performance')
  const loader = new GLTFLoader()
  const results = await Promise.allSettled([
    verifiedAsset(assets.head, assets.hashes.head).then(bytes => loader.parseAsync(bytes, '')),
    verifiedAsset(assets.body, assets.hashes.body).then(bytes => loader.parseAsync(bytes, '')),
    verifiedAsset(assets.animations, assets.hashes.animations).then(bytes => JSON.parse(new TextDecoder().decode(bytes))),
    verifiedAsset(assets.motion, assets.hashes.motion).then(bytes => JSON.parse(new TextDecoder().decode(bytes))),
  ])
  const resources = new THREE.Scene()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const result of results.slice(0, 2)) if (result.status === 'fulfilled') resources.add(result.value.scene)
    disposeScene(resources)
  }
  try {
    const values = results.map(result => { if (result.status === 'rejected') throw result.reason; return result.value })
    const { character } = composeCandidateCharacter(values[0].scene, values[1].scene)
    const clips = parseCharacterClips(values[2])
    for (const name of ['Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Fixing_Kneeling']) if (!clips.some(clip => clip.name === name && clip.duration > 0 && clip.validate())) throw new Error(`invalid_character_clip:${name}`)
    if (assets.sitting) for (const name of ['Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit']) if (!clips.some(clip => clip.name === name && clip.duration > 0 && clip.validate())) throw new Error(`invalid_character_clip:${name}`)
    const speed = values[3].forwardMetresPerSec
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('invalid_character_motion')
    return { character, clips, walkingSpeed: speed as number, dispose }
  } catch (error) { dispose(); throw error }
}
