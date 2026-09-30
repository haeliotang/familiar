import { currentPerformanceVersion } from '../src/performance-catalog'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { parseCharacterClips } from '../src/character-clips'
import { characterTimeline } from '../src/character-timeline'
import { groundCharacter } from '../src/ground-character'

const reports = []
for (const gender of ['male', 'female']) {
  const directory = `public/assets/quaternius/peasant-${gender}-v1`
  const bytes = await readFile(`${directory}/outfit.glb`)
  const length = bytes.readUInt32LE(12)
  const document = JSON.parse(bytes.subarray(20, 20 + length).toString())
  delete document.images; delete document.textures; delete document.materials
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const json = Buffer.from(JSON.stringify(document))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + bytes.length - 20 - length, 8)
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
  const input = Buffer.concat([header, padded, bytes.subarray(20 + length)])
  const { scene } = await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '')
  const clips = parseCharacterClips(JSON.parse(await readFile(`${directory}/animations.json`, 'utf8')))
  const version = process.argv.includes('--v2') ? currentPerformanceVersion : 'character-timeline-v1'
  const timeline = characterTimeline(scene, clips, .9749999351799508, 12, version)
  const bounds = new THREE.Box3()
  const position = new THREE.Vector3()
  const samples = []
  for (const phase of [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5.2, 6, 10]) {
    timeline.pose(28 + phase, 'repair')
    groundCharacter(scene, bounds, .01)
    const joints = Object.fromEntries(['pelvis','hand_l','hand_r','foot_l','foot_r','middle_03_l','middle_03_r'].map(name => [name, scene.getObjectByName(name)!.getWorldPosition(position).toArray()]))
    samples.push({ phase, joints })
    if (phase === 3 && joints.pelvis[1] >= .6) throw new Error(`not_kneeling:${gender}`)
    if ((phase === 6 || phase === 10) && joints.pelvis[1] <= .8) throw new Error(`not_standing:${gender}`)
  }
  timeline.dispose()
  reports.push({ gender, version, samples })
}

console.log(JSON.stringify(reports, null, 2))
