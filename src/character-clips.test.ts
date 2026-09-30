import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseCharacterClips } from './character-clips'

it.each(['base-character-v1', 'peasant-male-v1', 'peasant-female-v1'])('deserializes the actual baked clips in %s with quaternion and pelvis tracks', directory => {
  const library = JSON.parse(readFileSync(`public/assets/quaternius/${directory}/animations.json`, 'utf8'))
  const clips = parseCharacterClips(library)
  expect(clips.map(clip => clip.name)).toEqual(['Idle_Loop', 'Walk_Loop', 'Idle_Talking_Loop', 'Fixing_Kneeling'])
  for (const clip of clips) {
    expect(clip.validate()).toBe(true)
    expect(clip.tracks.some(track => track.name === 'pelvis.position')).toBe(true)
    expect(clip.tracks.some(track => track.name === 'Head.quaternion')).toBe(true)
  }
})
