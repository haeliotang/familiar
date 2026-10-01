import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { expect, it } from 'vitest'
import { composeCandidateCharacter } from './candidate-character'
import { characterTimeline } from './character-timeline'
import { parseCharacterClips } from './character-clips'
import { groundCharacter } from './ground-character'
import { createPickupProp } from './pickup-prop'
import { pickupStart, pickupContactPhase, pickupEnd } from './pickup-performance'
import { disposeScene } from './dispose-scene'
import { candidateSceneIds, currentSceneVersion, sceneLayout } from './scene-catalog'
import { createPlaceProps } from './place-props'

// Keep actual mesh, skin and rig while omitting browser-only texture decoding.
async function rig(path: string) {
  const bytes = readFileSync(path)
  const length = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString())
  delete document.images; delete document.textures; delete document.materials
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const json = Buffer.from(JSON.stringify(document))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const binary = bytes.subarray(20 + length)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + binary.length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  const result = Buffer.concat([header, padded, binary])
  return (await new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength), '')).scene
}

it.each(['male', 'female'])('keeps the combined %s rig contact continuous through taking and replacing the object', async gender => {
  const base = await rig(`public/assets/quaternius/${gender === 'male' ? 'base-character' : 'base-female'}-v1/adult-${gender}.glb`)
  const outfit = await rig(`public/assets/quaternius/peasant-${gender}-v1/outfit.glb`)
  const { character } = composeCandidateCharacter(base, outfit)
  const scene = new THREE.Scene(); scene.add(character)
  const clips = parseCharacterClips(JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-pickup-v3/animations.json`, 'utf8')))
  const motion = characterTimeline(character, clips, .975, 2, 'character-timeline-v4')
  const bounds = new THREE.Box3()
  motion.pose(pickupStart + pickupContactPhase, 'general')
  groundCharacter(character, bounds, .01)
  const prop = createPickupProp(character, .01)
  scene.add(prop.group)
  const pose = (seconds: number) => {
    prop.detach(); motion.pose(seconds, 'general'); groundCharacter(character, bounds, .01); prop.update(seconds)
    scene.updateMatrixWorld(true)
    return prop.object.getWorldPosition(new THREE.Vector3())
  }
  try {
    for (const contact of [pickupStart + pickupContactPhase, pickupEnd - pickupContactPhase]) {
      const before = pose(contact - .00001)
      const after = pose(contact + .00001)
      expect(before.distanceTo(after)).toBeLessThan(.001)
    }
    const held = pose(30)
    expect(held.distanceTo(prop.contact)).toBeGreaterThan(.1)
    pose(75); pose(0)
    expect(pose(30).distanceTo(held)).toBeLessThan(.000001)
    expect(pose(32).distanceTo(prop.contact)).toBeLessThan(.000001)
    expect(pose(0).distanceTo(prop.contact)).toBeLessThan(.000001)
    const table = new THREE.Box3().setFromObject(prop.group.children[0])
    expect(table.min.x).toBeGreaterThan(.3)
    const scenery = candidateSceneIds.map(id => {
      const layout = sceneLayout(currentSceneVersion, id, 1)
      const props = createPlaceProps(layout.props!)
      scene.add(props)
      return { id, boxes: props.children.map(object => new THREE.Box3().setFromObject(object)) }
    })
    const actorBounds = new THREE.Box3()
    for (const cue of ['general', 'wait', 'repair'] as const) for (let frame = 0; frame <= 750; frame++) {
      const seconds = frame / 10
      prop.detach(); motion.pose(seconds, cue); groundCharacter(character, bounds, .01)
      actorBounds.setFromObject(character, true)
      for (const place of scenery) for (const obstacle of place.boxes) expect(actorBounds.intersectsBox(obstacle), `${gender}/${place.id}/${cue} at ${seconds}`).toBe(false)
      // The table is selected only for general; hand contact during taking is intentional.
      if (cue === 'general' && ((seconds >= 12 && seconds < 27.2) || seconds >= 32.3)) expect(actorBounds.intersectsBox(table), `${gender} walking by pickup table at ${seconds}`).toBe(false)
    }
  } finally { prop.detach(); motion.dispose(); disposeScene(scene); const unused = new THREE.Scene(); unused.add(base); disposeScene(unused) }
}, 30000)
