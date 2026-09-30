import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { parseCharacterClips } from './character-clips'
import { sittingReview } from './sitting-review'

it.each(['male', 'female'])('seeks the actual %s sitting clips deterministically and holds the exit pose', gender => {
  const clips = parseCharacterClips(JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-v1/interaction-candidate-v1/animations.json`, 'utf8')))
  const character = new THREE.Group()
  for (const name of new Set(clips.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])))) {
    const bone = new THREE.Bone()
    bone.name = name
    character.add(bone)
  }
  const review = sittingReview(character, clips)
  const state = () => character.children.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()])
  try {
    expect(review.pose(0)).toBe('Sitting_Enter')
    expect(review.pose(2)).toBe('Sitting_Idle_Loop')
    const seated = state()
    expect(review.pose(review.duration)).toBe('Sitting_Exit')
    const standing = state()
    expect(standing).not.toEqual(seated)
    review.pose(review.duration + 100)
    expect(state()).toEqual(standing)
    review.pose(2)
    expect(state()).toEqual(seated)
    expect(() => review.pose(NaN)).toThrow('invalid_sitting_time')
  } finally { review.dispose() }
})
