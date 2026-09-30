import * as THREE from 'three'
import type { Cue } from './encounter'

export function prototypePerson(color: number) {
  const person = new THREE.Group()
  const clothing = new THREE.MeshStandardMaterial({ color, roughness: 1 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xc59d7e, roughness: 1 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 10), clothing)
  body.position.y = 1.25
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), skin)
  head.position.y = 1.95
  person.add(body, head)

  function limb(length: number, radius: number, material: THREE.Material) {
    const joint = new THREE.Bone()
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material)
    mesh.position.y = -length / 2
    joint.add(mesh)
    return joint
  }
  const arms = [-1, 1].map(side => {
    const shoulder = limb(0.33, 0.075, clothing)
    shoulder.position.set(side * 0.34, 1.57, 0)
    const elbow = limb(0.33, 0.06, clothing)
    elbow.position.y = -0.33
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin)
    hand.position.y = -0.33
    elbow.add(hand)
    shoulder.add(elbow)
    person.add(shoulder)
    return { shoulder, elbow, side }
  })
  const legs = [-1, 1].map(side => {
    const hip = limb(0.4, 0.095, clothing)
    hip.position.set(side * 0.15, 0.89, 0)
    const knee = limb(0.4, 0.08, clothing)
    knee.position.y = -0.4
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.32), clothing)
    foot.position.set(0, -0.43, 0.07)
    knee.add(foot)
    hip.add(knee)
    person.add(hip)
    return { hip, knee, foot, side }
  })
  person.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true })
  const bounds = new THREE.Box3()
  function pose(seconds: number, cue: Cue) {
    const walking = (seconds >= 12 && seconds < 28) || (seconds >= 55 && seconds < 72)
    const gait = walking ? Math.sin(seconds * 3.5) : 0
    const repairing = cue === 'repair' && seconds >= 28 && seconds < 43
    for (const { shoulder, elbow, side } of arms) {
      shoulder.rotation.x = repairing ? -0.8 : -gait * side * 0.25
      shoulder.rotation.z = repairing ? -side * 0.2 : -side * 0.08
      elbow.rotation.x = repairing ? -0.85 + Math.sin(seconds * 2.5 + side) * 0.08 : -0.12
    }
    for (const { hip, knee, side } of legs) {
      hip.rotation.x = gait * side * 0.3
      knee.rotation.x = walking ? Math.max(0, -gait * side) * 0.35 : 0
    }
    body.rotation.x = repairing ? 0.08 : 0
    head.rotation.y = cue === 'wait' && seconds >= 28 && seconds < 43 ? 0.3 : 0
    person.position.y = 0
    person.updateMatrixWorld(true)
    let lowest = Infinity
    for (const { foot } of legs) lowest = Math.min(lowest, bounds.setFromObject(foot).min.y)
    person.position.y = -lowest
  }
  return { person, pose }
}
