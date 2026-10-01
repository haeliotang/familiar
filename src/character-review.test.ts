import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { parseCharacterClips } from './character-clips'
import { characterTimeline } from './character-timeline'
import { currentPerformanceVersion, resolvePerformanceVersion } from './performance-catalog'

it.each(['male', 'female'])('can play the retained four-clip %s character review sample', gender => {
  const html = readFileSync('scripts/verify-character.html', 'utf8')
  const calls = [...html.matchAll(/characterTimeline\(character, clips, motion\.forwardMetresPerSec, (?:12|buffers\[sampleCue\]\.duration), ([^)]+)\)/g)]
  expect(calls).toHaveLength(2)
  const clips = parseCharacterClips(JSON.parse(readFileSync(`public/assets/quaternius/peasant-${gender}-v1/animations.json`, 'utf8')))
  for (const call of calls) {
    const version = call[1] === 'currentPerformanceVersion' ? currentPerformanceVersion : resolvePerformanceVersion(call[1].replace(/'/g, ''))
    const character = new THREE.Group()
    for (const name of new Set(clips.flatMap(clip => clip.tracks.map(track => track.name.split('.')[0])))) {
      const bone = new THREE.Bone()
      bone.name = name
      character.add(bone)
    }
    const timeline = characterTimeline(character, clips, .975, 2, version)
    try { for (const cue of ['general', 'wait', 'repair'] as const) for (const time of [0, 31, 44, 75]) timeline.pose(time, cue) }
    finally { timeline.dispose() }
  }
})
