import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Keep geometry, skin and bind pose; omit textures for offline animation baking.
async function loadRig(path: string) {
  const original = await readFile(path)
  const length = original.readUInt32LE(12)
  const document = JSON.parse(original.subarray(20, 20 + length).toString())
  delete document.images
  delete document.textures
  delete document.materials
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const json = Buffer.from(JSON.stringify(document))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const binary = original.subarray(20 + length)
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + padded.length + binary.length, 8)
  header.writeUInt32LE(padded.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const result = Buffer.concat([header, padded, binary])
  return new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength), '')
}

const outfit = process.argv.includes('--outfit')
const female = process.argv.includes('--female')
const extended = process.argv.includes('--extended-candidate')
const directory = outfit ? `public/assets/quaternius/peasant-${female ? 'female' : 'male'}-v1` : female ? 'public/assets/quaternius/base-female-v1' : 'public/assets/quaternius/base-character-v1'
const outputDirectory = extended ? `${directory}/interaction-candidate-v1` : directory
const targetPath = `${directory}/${outfit ? 'outfit' : female ? 'adult-female' : 'adult-male'}.glb`
const target = await loadRig(targetPath)
const source = await loadRig('public/assets/quaternius/animation-library-v3/standard.glb')
function body(scene: THREE.Object3D) {
  let mesh: THREE.SkinnedMesh | undefined
  scene.traverse(object => { if (object instanceof THREE.SkinnedMesh && (!mesh || object.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = object })
  if (!mesh) throw new Error('Missing skinned body')
  return mesh
}
const targetBody = body(target.scene)
const sourceBody = body(source.scene)
const selected = extended ? ['Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Interact', 'PickUp_Table'] : ['Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Fixing_Kneeling']
const clips = []
for (const name of selected) {
  targetBody.skeleton.pose()
  sourceBody.skeleton.pose()
  target.scene.updateMatrixWorld(true)
  source.scene.updateMatrixWorld(true)
  const clip = source.animations.find(clip => clip.name === name)
  if (!clip) throw new Error(`Missing animation ${name}`)
  const converted = retargetClip(targetBody, sourceBody, clip, {
    hip: 'pelvis', fps: 30, getBoneName: (bone: THREE.Bone) => bone.name,
    preserveBonePositions: true, preserveBoneMatrix: true,
  })
  converted.name = name
  // The runtime mixer binds to the whole character group, not a single mesh.
  for (const track of converted.tracks) {
    track.name = track.name.replace(/^\.bones\[([^\]]+)\]/, '$1')
    if (!Array.from(track.values).every(Number.isFinite)) throw new Error(`Invalid retargeted values: ${track.name}`)
  }
  clips.push(THREE.AnimationClip.toJSON(converted))
}
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
const contactSamples = []
const jointSamples = []
const contactJoints = ['pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r']
const jointPosition = new THREE.Vector3()
const bounds = new THREE.Box3()
for (const serialized of clips) {
  targetBody.skeleton.pose()
  const clip = THREE.AnimationClip.parse(serialized)
  const mixer = new THREE.AnimationMixer(target.scene)
  mixer.clipAction(clip).play()
  let lowest = Infinity
  let highestLowest = -Infinity
  const frames = Math.ceil(clip.duration * 30)
  const joints = []
  for (let frame = 0; frame < frames; frame++) {
    mixer.setTime(frame / 30)
    target.scene.updateMatrixWorld(true)
    bounds.setFromObject(target.scene, true)
    lowest = Math.min(lowest, bounds.min.y)
    highestLowest = Math.max(highestLowest, bounds.min.y)
    if (extended) {
      const groundOffset = -bounds.min.y
      const hand = targetBody.skeleton.bones.find(bone => bone.name === 'hand_l')!
      const index = targetBody.skeleton.bones.find(bone => bone.name === 'index_01_l')!
      const thumb = targetBody.skeleton.bones.find(bone => bone.name === 'thumb_01_l')!
      if (!hand || !index || !thumb) throw new Error('Missing grip joints')
      const gripPoint = index.getWorldPosition(new THREE.Vector3()).add(thumb.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5)
      gripPoint.y += groundOffset
      const handQuaternion = hand.getWorldQuaternion(new THREE.Quaternion()).toArray()
      joints.push({ timeSec: frame / 30, groundOffset, gripPoint: gripPoint.toArray(), handQuaternion, positions: Object.fromEntries(contactJoints.map(name => {
        const bone = targetBody.skeleton.bones.find(bone => bone.name === name)
        if (!bone) throw new Error(`Missing contact joint ${name}`)
        bone.getWorldPosition(jointPosition)
        jointPosition.y += groundOffset
        if (!jointPosition.toArray().every(Number.isFinite)) throw new Error(`Invalid contact joint ${name}`)
        return [name, jointPosition.toArray()]
      })) })
    }
  }
  contactSamples.push({ clip: clip.name, frames, lowestSurfaceY: lowest, highestLowestSurfaceY: highestLowest })
  if (extended) jointSamples.push({ clip: clip.name, frames: joints })
  mixer.stopAllAction()
  mixer.uncacheRoot(target.scene)
}
await mkdir(outputDirectory, { recursive: true })
if (extended) await writeFile(`${outputDirectory}/joint-samples.json`, JSON.stringify({ units: 'metres; world coordinates after per-frame mesh ground correction', frequencyHz: 30, targetGlbSha256: await digest(targetPath), status: 'diagnostic only; joint centres are not skin contact points; no seat or grasp verdict', samples: jointSamples }, null, 2) + '\n')
await writeFile(`${outputDirectory}/contact-samples.json`, JSON.stringify({ units: 'metres; original model origin; no ground correction', frequencyHz: 30, status: 'diagnostic only; no foot sliding or visual contact verdict', samples: contactSamples }, null, 2) + '\n')
await writeFile(`${outputDirectory}/animations.json`, JSON.stringify({ source: `${extended ? '../' : ''}../animation-library-v3/provenance.json`, target: `${extended ? '../' : ''}provenance.json`, sourceGlbSha256: await digest('public/assets/quaternius/animation-library-v3/standard.glb'), targetGlbSha256: await digest(targetPath), method: 'Three.js 0.180.0 SkeletonUtils.retargetClip; 30 fps; pelvis; preserved target bone positions', status: 'candidate; visual and contact review pending', clips }))
console.log(clips.map(clip => `${clip.name}: ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`).join('\n'))
