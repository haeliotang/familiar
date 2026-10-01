import { resolvePerformanceVersion, type PerformanceVersion } from './performance-catalog'
import * as THREE from 'three'
import type { Cue } from './encounter'
import { pickupEnd, pickupPhase } from './pickup-performance'

const transitionSec = .4

function closeIdleLoop(clip: THREE.AnimationClip) {
  const closed = clip.clone()
  for (const track of closed.tracks) {
    const size = track.getValueSize()
    const start = new THREE.Quaternion()
    if (track instanceof THREE.QuaternionKeyframeTrack) start.fromArray(track.values).normalize()
    for (let index = 0; index < track.times.length; index++) {
      const weight = THREE.MathUtils.smoothstep(track.times[index], clip.duration - .2, clip.duration)
      if (!weight) continue
      const offset = index * size
      if (track instanceof THREE.QuaternionKeyframeTrack) {
        const rotation = new THREE.Quaternion().fromArray(track.values, offset).normalize().slerp(start, weight)
        track.values.set(rotation.toArray(), offset)
      } else for (let component = 0; component < size; component++) track.values[offset + component] = THREE.MathUtils.lerp(track.values[offset + component], track.values[component], weight)
    }
  }
  return closed
}

export function characterPlan(seconds: number, cue: Cue, walkingSpeed: number, speechDuration = 12, version: PerformanceVersion = 'character-timeline-v1') {
  const resolved = resolvePerformanceVersion(version)
  const repair = resolved !== 'character-timeline-v1' && cue === 'repair'
  const speechEnd = 43 + Math.min(12, Math.max(.01, speechDuration))
  const stages = repair ? [0, 12, 28, 33.2, 43, speechEnd, 55, 72] : [0, 12, 28, 43, speechEnd, 55, 72]
  const t = Math.max(0, Math.min(seconds, 75))
  const names = repair ? ['Idle_Loop', 'Walk_Loop', 'Fixing_Kneeling', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Loop', 'Walk_Loop', 'Idle_Loop'] : ['Idle_Loop', 'Walk_Loop', cue === 'repair' ? 'Fixing_Kneeling' : 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Loop', 'Walk_Loop', 'Idle_Loop']
  if (resolved === 'character-timeline-v3' || resolved === 'character-timeline-v4') {
    stages.splice(0, 1, 0, 1.3, 12 - 1.0333333015441895)
    names.splice(0, 1, 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit')
  }
  const pickup = resolved === 'character-timeline-v4' && cue === 'general'
  if (pickup) {
    const index = stages.indexOf(28)
    stages.splice(index, 1, 27.6, pickupEnd)
    names.splice(index, 1, 'PickUp_Table', 'Idle_Loop')
  }
  let stage = stages.length - 1
  while (stages[stage] > t) stage--
  const phase = t - stages[stage]
  const blend = stage ? Math.min(phase / transitionSec, 1) : 1
  const motions = [{ name: names[stage], phase, weight: blend }]
  if (blend < 1) motions.push({ name: names[stage - 1], phase: t - stages[stage - 1], weight: 1 - blend })
  for (const motion of motions) if (motion.name === 'PickUp_Table') motion.phase = pickupPhase(t)
  const walked = Math.max(0, Math.min(t - 12, 16)) + Math.max(0, Math.min(t - 55, 17))
  const turn = cue === 'wait' ? THREE.MathUtils.smoothstep(t, 28, 30) * (1 - THREE.MathUtils.smoothstep(t, 42, 44)) * .9 : 0
  const repairTurn = repair ? THREE.MathUtils.smoothstep(t, 28, 28.4) * (1 - THREE.MathUtils.smoothstep(t, 33.2, 33.6)) * Math.PI / 2 : 0
  const pickupTurn = pickup ? THREE.MathUtils.smoothstep(t, 27.2, 27.6) * (1 - THREE.MathUtils.smoothstep(t, pickupEnd, pickupEnd + .4)) * Math.PI / 2 : 0
  return { motions, z: -18 + walked * walkingSpeed, yaw: turn + repairTurn + pickupTurn }
}

export function characterTimeline(character: THREE.Group, clips: THREE.AnimationClip[], walkingSpeed: number, speechDuration = 12, version: PerformanceVersion = 'character-timeline-v1') {
  const mixer = new THREE.AnimationMixer(character)
  const actions = new Map(clips.map(clip => {
    const runtimeClip = (version === 'character-timeline-v3' || version === 'character-timeline-v4') && clip.name === 'Idle_Loop' ? closeIdleLoop(clip) : clip
    const action = mixer.clipAction(runtimeClip).play()
    action.paused = true
    return [clip.name, action] as const
  }))
  for (const name of ['Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Fixing_Kneeling']) if (!actions.has(name)) throw new Error(`missing_character_clip:${name}`)
  if (version === 'character-timeline-v3' || version === 'character-timeline-v4') for (const name of ['Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit']) if (!actions.has(name)) throw new Error(`missing_character_clip:${name}`)
  if (version === 'character-timeline-v4' && !actions.has('PickUp_Table')) throw new Error('missing_character_clip:PickUp_Table')
  return {
    pose(seconds: number, cue: Cue) {
      const plan = characterPlan(seconds, cue, walkingSpeed, speechDuration, version)
      for (const action of actions.values()) action.setEffectiveWeight(0)
      for (const motion of plan.motions) {
        const action = actions.get(motion.name)!
        const duration = action.getClip().duration
        action.time = ['Fixing_Kneeling', 'Sitting_Enter', 'Sitting_Exit', 'PickUp_Table'].includes(motion.name) ? Math.min(motion.phase, duration) : motion.phase % duration
        action.setEffectiveWeight(motion.weight)
      }
      mixer.update(0)
      character.position.z = plan.z
      character.rotation.y = plan.yaw
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(character)
    },
  }
}
