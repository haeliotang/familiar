import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseCharacterClips } from './character-clips'

it.each(['male', 'female'])('binds %s interaction candidates to their actual source and body', gender => {
  const directory = `public/assets/quaternius/peasant-${gender}-v1/interaction-candidate-v1`
  const library = JSON.parse(readFileSync(`${directory}/animations.json`, 'utf8'))
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  expect(library.sourceGlbSha256).toBe(hash('public/assets/quaternius/animation-library-v3/standard.glb'))
  expect(library.targetGlbSha256).toBe(hash(`${directory}/../outfit.glb`))
  expect(JSON.parse(readFileSync(resolve(directory, library.source), 'utf8')).license).toBe('CC0-1.0')
  expect(JSON.parse(readFileSync(resolve(directory, library.target), 'utf8'))).toBeTruthy()
  const clips = parseCharacterClips(library)
  expect(clips.map(clip => clip.name)).toEqual(['Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Interact', 'PickUp_Table'])
  const samples = JSON.parse(readFileSync(`${directory}/contact-samples.json`, 'utf8')).samples
  const joints = JSON.parse(readFileSync(`${directory}/joint-samples.json`, 'utf8'))
  expect(joints.targetGlbSha256).toBe(library.targetGlbSha256)
  for (const clip of clips) {
    expect(clip.validate()).toBe(true)
    expect(clip.duration).toBeGreaterThan(.5)
    expect(clip.tracks.some(track => track.name === 'pelvis.position')).toBe(true)
    expect(clip.tracks.some(track => track.name === 'Head.quaternion')).toBe(true)
    const contact = samples.find((sample: { clip: string }) => sample.clip === clip.name)
    expect(contact.frames).toBe(Math.ceil(clip.duration * 30))
    expect(Number.isFinite(contact.lowestSurfaceY)).toBe(true)
    expect(Number.isFinite(contact.highestLowestSurfaceY)).toBe(true)
    expect(contact.highestLowestSurfaceY).toBeGreaterThanOrEqual(contact.lowestSurfaceY)
    const jointClip = joints.samples.find((sample: { clip: string }) => sample.clip === clip.name)
    expect(jointClip.frames).toHaveLength(contact.frames)
    for (const [index, frame] of jointClip.frames.entries()) {
      expect(frame.timeSec).toBeCloseTo(index / 30)
      expect(Number.isFinite(frame.groundOffset)).toBe(true)
      expect(Object.keys(frame.positions)).toEqual(['pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r'])
      for (const position of Object.values(frame.positions) as number[][]) {
        expect(position).toHaveLength(3)
        expect(position.every(Number.isFinite)).toBe(true)
      }
    }
  }
  const pelvisHeight = (name: string, last = false) => {
    const frames = joints.samples.find((sample: { clip: string }) => sample.clip === name).frames
    return frames[last ? frames.length - 1 : 0].positions.pelvis[1]
  }
  expect(pelvisHeight('Sitting_Enter', true)).toBeLessThan(pelvisHeight('Sitting_Enter') - .25)
  expect(pelvisHeight('Sitting_Exit', true)).toBeGreaterThan(pelvisHeight('Sitting_Exit') + .25)
  for (const [before, after] of [['Sitting_Enter', 'Sitting_Idle_Loop'], ['Sitting_Idle_Loop', 'Sitting_Exit']]) {
    const previous = joints.samples.find((sample: { clip: string }) => sample.clip === before).frames.at(-1).positions
    const next = joints.samples.find((sample: { clip: string }) => sample.clip === after).frames[0].positions
    for (const name of Object.keys(previous)) {
      const distance = Math.hypot(...previous[name].map((value: number, axis: number) => value - next[name][axis]))
      expect(distance).toBeLessThan(.01)
    }
  }
})
