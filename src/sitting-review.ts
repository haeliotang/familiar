import * as THREE from 'three'

export function sittingReview(character: THREE.Group, clips: THREE.AnimationClip[]) {
  const names = ['Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit']
  const selected = names.map(name => {
    const clip = clips.find(clip => clip.name === name)
    if (!clip || !clip.validate() || clip.duration <= 0) throw new Error(`missing_sitting_clip:${name}`)
    return clip
  })
  const holdSec = 4
  const exitAt = selected[0].duration + holdSec
  const duration = exitAt + selected[2].duration
  const mixer = new THREE.AnimationMixer(character)
  const actions = selected.map(clip => {
    const action = mixer.clipAction(clip).play()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.paused = true
    return action
  })
  return {
    duration,
    pose(seconds: number) {
      if (!Number.isFinite(seconds)) throw new Error('invalid_sitting_time')
      const time = Math.max(0, Math.min(seconds, duration))
      const index = time < selected[0].duration ? 0 : time < exitAt ? 1 : 2
      for (const action of actions) { action.enabled = true; action.setEffectiveWeight(0) }
      actions[index].time = index === 0 ? time : index === 1 ? (time - selected[0].duration) % selected[1].duration : time - exitAt
      actions[index].setEffectiveWeight(1)
      mixer.update(0)
      return names[index]
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(character) },
  }
}
