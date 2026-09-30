import * as THREE from 'three'
import { expect, it } from 'vitest'
import { characterPlan, characterTimeline } from './character-timeline'
import { readFileSync } from 'node:fs'
import { parseCharacterClips } from './character-clips'

it.each(['male', 'female'])('keeps actual %s v3 poses continuous at stage boundaries and stable when seeking backwards', gender => {
  const clips = parseCharacterClips(JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-sitting-v2/animations.json`, 'utf8')))
  const retained = clips.map(clip => THREE.AnimationClip.toJSON(clip))
  const character = new THREE.Group()
  const bones = [...new Set(clips.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])))].map(name => {
    const bone = new THREE.Bone()
    bone.name = name
    character.add(bone)
    return bone
  })
  const timeline = characterTimeline(character, clips, .975, 2, 'character-timeline-v3')
  const state = () => bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }))
  try {
    for (const cue of ['general', 'wait', 'repair'] as const) {
      for (const boundary of [1.3, 12 - 1.0333333015441895, 12, 28, 33.2, 43, 45, 55, 72]) {
        timeline.pose(boundary - .00001, cue)
        const before = state()
        timeline.pose(boundary + .00001, cue)
        const after = state()
        for (let index = 0; index < bones.length; index++) {
          expect(before[index].position.distanceTo(after[index].position), `${cue} at ${boundary}: ${bones[index].name}`).toBeLessThan(.001)
          expect(before[index].quaternion.angleTo(after[index].quaternion), `${cue} at ${boundary}: ${bones[index].name}`).toBeLessThan(.002)
        }
      }
      timeline.pose(5, cue)
      const seated = state()
      timeline.pose(75, cue)
      timeline.pose(0, cue)
      timeline.pose(5, cue)
      expect(state()).toEqual(seated)
    }
    expect(clips.map(clip => THREE.AnimationClip.toJSON(clip))).toEqual(retained)
  } finally { timeline.dispose() }
})

it('plays a complete sitting sequence before walking in the new performance revision', () => {
  expect(characterPlan(.5, 'general', .975, 12, 'character-timeline-v3').motions[0].name).toBe('Sitting_Enter')
  expect(characterPlan(5, 'general', .975, 12, 'character-timeline-v3').motions[0].name).toBe('Sitting_Idle_Loop')
  expect(characterPlan(11.5, 'general', .975, 12, 'character-timeline-v3').motions[0].name).toBe('Sitting_Exit')
  expect(characterPlan(13, 'general', .975, 12, 'character-timeline-v3').motions[0].name).toBe('Walk_Loop')
  for (let t = 0; t <= 75; t += .1) {
    const plan = characterPlan(t, 'repair', .975, 12, 'character-timeline-v3')
    expect(plan.motions.reduce((sum, motion) => sum + motion.weight, 0)).toBeCloseTo(1)
    if (t < 12) expect(plan.z).toBe(-18)
  }
  expect(characterPlan(34, 'repair', .975, 12, 'character-timeline-v3').motions[0].name).toBe('Idle_Loop')
})

it('keeps the path continuous, holds it while stopped and ends walking at 72 seconds', () => {
  for (const boundary of [12,28,43,55,72]) expect(Math.abs(characterPlan(boundary + .0001, 'wait', .975).z - characterPlan(boundary - .0001, 'wait', .975).z)).toBeLessThan(.001)
  expect(characterPlan(28, 'wait', .975).z).toBe(characterPlan(54, 'wait', .975).z)
  expect(characterPlan(72, 'wait', .975).z).toBe(characterPlan(75, 'wait', .975).z)
  expect(characterPlan(30, 'wait', .975).yaw).toBeCloseTo(.9)
  expect(characterPlan(44, 'wait', .975).yaw).toBe(0)
})

it.each(['character-timeline-v1', 'character-timeline-v2'] as const)('blends known clips with unit total weight and only chooses repair for its cue in %s', version => {
  for (let t = 0; t <= 75; t += .1) for (const cue of ['wait','repair','general'] as const) {
    const plan = characterPlan(t, cue, .975, 12, version)
    expect(plan.motions.reduce((sum, motion) => sum + motion.weight, 0)).toBeCloseTo(1)
    if (cue !== 'repair') expect(plan.motions.some(motion => motion.name === 'Fixing_Kneeling')).toBe(false)
  }
})

it('seeking and replay produce the same pose without dependence on earlier frames', () => {
  const character = new THREE.Group()
  const bone = new THREE.Bone()
  bone.name = 'Head'
  character.add(bone)
  const clips = ['Idle_Loop','Walk_Loop','Idle_Talking_Loop','Fixing_Kneeling'].map((name,index) => new THREE.AnimationClip(name, 2, [new THREE.NumberKeyframeTrack('Head.rotation[x]', [0,2], [index,index + .5])]))
  const timeline = characterTimeline(character, clips, .975)
  timeline.pose(43.2, 'repair')
  const first = bone.rotation.x
  timeline.pose(70, 'wait')
  timeline.pose(0, 'general')
  timeline.pose(43.2, 'repair')
  expect(bone.rotation.x).toBeCloseTo(first)
  expect(character.position.z).toBeCloseTo(-2.4)
  timeline.dispose()
})

it('stops the talking motion after the actual prepared voice finishes', () => {
  expect(characterPlan(44, 'general', .975, 2).motions[0].name).toBe('Idle_Talking_Loop')
  expect(characterPlan(46, 'general', .975, 2).motions[0].name).toBe('Idle_Loop')
})

it('ends the complete repair clip before waiting, while retaining the recorded v1 plan', () => {
  expect(characterPlan(31, 'repair', .975, 12, 'character-timeline-v2').motions[0].name).toBe('Fixing_Kneeling')
  expect(characterPlan(34, 'repair', .975, 12, 'character-timeline-v2').motions[0].name).toBe('Idle_Loop')
  expect(characterPlan(40, 'repair', .975, 12, 'character-timeline-v2').motions[0].name).toBe('Idle_Loop')
  expect(characterPlan(34, 'repair', .975).motions[0].name).toBe('Fixing_Kneeling')
})


it('turns towards the side work area, then faces the clear route before speaking', () => {
  expect(characterPlan(31, 'repair', .975, 12, 'character-timeline-v2').yaw).toBeCloseTo(Math.PI / 2)
  expect(characterPlan(34, 'repair', .975, 12, 'character-timeline-v2').yaw).toBe(0)
  for (const boundary of [28, 28.4, 33.2, 33.6]) expect(Math.abs(characterPlan(boundary + .0001, 'repair', .975, 12, 'character-timeline-v2').yaw - characterPlan(boundary - .0001, 'repair', .975, 12, 'character-timeline-v2').yaw)).toBeLessThan(.01)
})
