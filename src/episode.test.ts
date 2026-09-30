import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { fromApi, type ApiEpisode } from './episode'
import { manifestContent } from './manifest'

it('retains saved versions and seed, verifies the complete server manifest, and rejects changed content', async () => {
  const manifest: ApiEpisode['manifest'] = { cue: 'wait', sceneId: 'riverside', durationSec: 75, seed: 12345, sceneVersion: 'procedural-path-v1', avatarVersion: 'adult-peasant-male-webp-v1', performanceVersion: 'character-timeline-v2', audioPlan: { voiceVersion: 'kokoro-zh-zm009-v1' } }
  manifest.manifestHash = createHash('sha256').update(manifestContent(manifest)).digest('hex')
  const episode = { episodeId: 'synthetic-episode', status: 'prototype', createdAt: '2026-09-30', manifest }
  expect(await fromApi(episode)).toMatchObject({ seed: 12345, sceneVersion: 'procedural-path-v1', performanceVersion: 'character-timeline-v2', manifestVerified: true })
  expect(await fromApi({ ...episode, manifest: { ...manifest, seed: 12346 } })).toMatchObject({ manifestVerified: false })
  expect(await fromApi({ ...episode, manifest: { ...manifest, audioPlan: { voiceVersion: 'changed' } } })).toMatchObject({ manifestVerified: false })
})

it('preserves a legacy record without inventing a seed, version or fingerprint', async () => {
  const result = await fromApi({ episodeId: 'legacy', status: 'prototype', createdAt: '2026-09-30', manifest: { cue: 'general', sceneId: 'courtyard', durationSec: 75 } })
  expect(result.seed).toBeNaN()
  expect(result.sceneVersion).toBeUndefined()
  expect(result.manifestVerified).toBe(false)
})

it.each(['generic', 'memory_based', 'audio_rate_based', 'memory_and_audio_rate_based'] as const)('retains %s personalization when opening or restoring an episode', async personalizationLevel => {
  const result = await fromApi({ episodeId: 'synthetic-photo', status: 'prototype', createdAt: '2026-10-01', manifest: { cue: 'general', sceneId: 'riverside', durationSec: 75, personalizationLevel } })
  expect(result).toHaveProperty('personalizationLevel', personalizationLevel)
})

it('retains the recorded audio degradation and signal status for user-facing explanation', async () => {
  const result = await fromApi({ episodeId: 'synthetic-audio', status: 'prototype', createdAt: '2026-09-30', manifest: { cue: 'general', sceneId: 'riverside', durationSec: 75, degraded: true, degradationReason: 'audio_analysis_unavailable', audioObservation: { signalStatus: 'clipped' } } })
  expect(result).toMatchObject({ degraded: true, degradationReason: 'audio_analysis_unavailable', audioSignalStatus: 'clipped' })
})
