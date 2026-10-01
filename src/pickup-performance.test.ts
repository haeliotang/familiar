import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { characterPlan, characterTimeline } from './character-timeline'
import { pickupAttached, pickupContactPhase, pickupDuration, pickupEnd, pickupPhase, pickupStart } from './pickup-performance'
import { parseCharacterClips } from './character-clips'

it('takes once, holds, reverses to release and restores state on backward seeking', () => {
  expect(pickupPhase(28)).toBe(0)
  expect(pickupPhase(29)).toBe(pickupDuration)
  expect(pickupPhase(30)).toBe(pickupDuration)
  expect(pickupPhase(31)).toBe(pickupDuration)
  expect(pickupPhase(pickupEnd)).toBe(0)
  expect(pickupAttached(28)).toBe(false)
  expect(pickupAttached(pickupStart + pickupContactPhase)).toBe(true)
  expect(pickupAttached(31)).toBe(true)
  expect(pickupAttached(32)).toBe(false)
  expect(characterPlan(30, 'general', .975, 2, 'character-timeline-v4').motions[0].name).toBe('PickUp_Table')
  expect(characterPlan(32.5, 'general', .975, 2, 'character-timeline-v4').motions[0].name).toBe('Idle_Loop')
  for (const cue of ['wait', 'repair'] as const) expect(characterPlan(30, cue, .975, 2, 'character-timeline-v4').motions.some(motion => motion.name === 'PickUp_Table')).toBe(false)
  expect(characterPlan(30, 'general', .975, 2, 'character-timeline-v3').motions[0].name).toBe('Idle_Loop')
})

it.each(['male', 'female'])('keeps actual %s pickup poses continuous at contact, hold, reversal and idle blend', gender => {
  const clips = parseCharacterClips(JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-pickup-v3/animations.json`, 'utf8')))
  expect(clips.find(clip => clip.name === 'PickUp_Table')!.duration).toBe(pickupDuration)
  const character = new THREE.Group()
  const bones = [...new Set(clips.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])))].map(name => {
    const bone = new THREE.Bone(); bone.name = name; character.add(bone); return bone
  })
  const timeline = characterTimeline(character, clips, .975, 2, 'character-timeline-v4')
  const state = () => bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }))
  try {
    for (const boundary of [27.2, 27.6, 28, pickupStart + pickupContactPhase, 28 + pickupDuration, 31, pickupEnd - pickupContactPhase, pickupEnd, pickupEnd + .4]) {
      timeline.pose(boundary - .00001, 'general'); const before = state()
      timeline.pose(boundary + .00001, 'general'); const after = state()
      for (let index = 0; index < bones.length; index++) {
        expect(before[index].position.distanceTo(after[index].position), `${boundary}:${bones[index].name}`).toBeLessThan(.001)
        expect(before[index].quaternion.angleTo(after[index].quaternion), `${boundary}:${bones[index].name}`).toBeLessThan(.002)
      }
    }
    timeline.pose(30, 'general'); const held = state()
    timeline.pose(75, 'general'); timeline.pose(0, 'general'); timeline.pose(30, 'general')
    expect(state()).toEqual(held)
  } finally { timeline.dispose() }
})
