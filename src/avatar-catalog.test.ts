import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { avatarAssets, candidateAvatarVersions, avatarVersionForEncounter, sittingMaleAvatarVersion, sittingFemaleAvatarVersion, pickupMaleAvatarVersion, pickupFemaleAvatarVersion, compactMaleAvatarVersion, compactFemaleAvatarVersion, retainedMaleAvatarVersion, retainedFemaleAvatarVersion } from './avatar-catalog'
import { parseCharacterClips } from './character-clips'
import { voiceVersionForAvatar, femaleVoiceVersion } from './voice-catalog'

it.each([...candidateAvatarVersions, pickupMaleAvatarVersion, pickupFemaleAvatarVersion, sittingMaleAvatarVersion, sittingFemaleAvatarVersion, retainedMaleAvatarVersion, retainedFemaleAvatarVersion])('pins every model and motion file in %s to its actual content', version => {
  const assets = avatarAssets(version)
  for (const name of ['head', 'body', 'animations', 'motion'] as const) {
    const bytes = readFileSync(`public${assets[name]}`)
    expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(assets.hashes[name])
  }
})

it.each([sittingMaleAvatarVersion, sittingFemaleAvatarVersion])('binds the seven-clip %s bundle to both original input libraries', version => {
  const library = JSON.parse(readFileSync(`public${avatarAssets(version).animations}`, 'utf8'))
  const inputs = library.inputs.map((input: { path: string; sha256: string }) => {
    const bytes = readFileSync(`public${input.path}`)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(input.sha256)
    return JSON.parse(bytes.toString())
  })
  expect(library.clips).toEqual([...inputs[0].clips, ...inputs[1].clips.filter((clip: { name: string }) => clip.name.startsWith('Sitting_'))])
  const clips = parseCharacterClips(library)
  expect(clips).toHaveLength(7)
  expect(clips.every(clip => clip.validate() && clip.duration > 0)).toBe(true)
})

it('retains the female voice for the expanded female body', () => {
  expect(voiceVersionForAvatar(sittingFemaleAvatarVersion)).toBe(femaleVoiceVersion)
  expect(voiceVersionForAvatar(retainedFemaleAvatarVersion)).toBe(femaleVoiceVersion)
  expect(voiceVersionForAvatar(pickupFemaleAvatarVersion)).toBe(femaleVoiceVersion)
  expect(voiceVersionForAvatar(compactFemaleAvatarVersion)).toBe(femaleVoiceVersion)
})


it('uses four scene/body combinations before repeating and rejects invalid counts', () => {
  const combinations = Array.from({ length: 4 }, (_, count) => `${count % 2}:${avatarVersionForEncounter(count)}`)
  expect(new Set(combinations).size).toBe(4)
  expect(avatarVersionForEncounter(4)).toBe(avatarVersionForEncounter(0))
  expect(() => avatarVersionForEncounter(-1)).toThrow('invalid_encounter_count')
})

it('selects the compact eight-clip bodies for new encounters while retaining sitting versions', () => {
  expect(avatarVersionForEncounter(0)).toBe(compactMaleAvatarVersion)
  expect(avatarVersionForEncounter(2)).toBe(compactFemaleAvatarVersion)
  expect(avatarAssets(sittingMaleAvatarVersion).pickup).toBeUndefined()
  expect(avatarAssets(sittingFemaleAvatarVersion).pickup).toBeUndefined()
})
