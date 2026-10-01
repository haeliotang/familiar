import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseCharacterClips } from './character-clips'

it.each(['male', 'female'])('retains seven published %s clips and adds the actual pickup with bound provenance', gender => {
  const library = JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-pickup-v3/animations.json`, 'utf8'))
  const inputs = library.inputs.map((input: { path: string; sha256: string }) => {
    const bytes = readFileSync(`public${input.path}`)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(input.sha256)
    return JSON.parse(bytes.toString())
  })
  expect(library.clips.slice(0, 7)).toEqual(inputs[0].clips)
  expect(library.clips[7]).toEqual(inputs[1].clips.find((clip: { name: string }) => clip.name === 'PickUp_Table'))
  const clips = parseCharacterClips(library)
  expect(clips).toHaveLength(8)
  expect(new Set(clips.map(clip => clip.name)).size).toBe(8)
  for (const clip of clips) {
    expect(clip.validate()).toBe(true)
    expect(clip.duration).toBeGreaterThan(0)
  }
  expect(clips[7].tracks.some(track => track.name === 'hand_l.quaternion')).toBe(true)
})
