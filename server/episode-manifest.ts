import { createHash, randomInt } from 'node:crypto'
import { currentPerformanceVersion } from '../src/performance-catalog'
import { currentSceneVersion, sceneForEncounter } from '../src/scene-catalog'
import { manifestContent } from '../src/manifest'
import { voiceVersionForAvatar, voicePackage } from '../src/voice-catalog'
import { avatarVersionForEncounter } from '../src/avatar-catalog'
import { spokenLine, type Cue } from '../src/encounter'
import type { renderCadenceVoice } from './cadence-voice'

export const plannerVersion = 'memory-cue-template-v4'

export interface AudioObservationRef {
  sourceAssetId: string
  analyzerVersion: 'signal-window-v1'
  status: 'measured' | 'unavailable'
  subjectAttribution: 'unverified'
  normalizedAudioSha256?: string
  selectedWindow?: { startSec: number; endSec: number }
  signalStatus?: string
}

export function episodeManifest(episodeId: string, revision: number, evidenceId: string | null, cue: Cue, previousCount: number, audioObservation?: AudioObservationRef) {
  const avatarVersion = avatarVersionForEncounter(previousCount)
  const voiceVersion = voiceVersionForAvatar(avatarVersion)
  const retainedVoice = voicePackage(voiceVersion)
  const manifest = { ...(audioObservation ? { audioObservation, degraded: audioObservation.status === 'unavailable', degradationReason: audioObservation.status === 'unavailable' ? 'audio_analysis_unavailable' : null } : {}), schemaVersion: audioObservation ? '1.3' : '1.2', performanceVersion: currentPerformanceVersion, episodeId, seed: randomInt(0x100000000), sceneVersion: currentSceneVersion, plannerVersion, avatarVersion, personRevision: revision, evidenceId, cue, sceneId: sceneForEncounter(previousCount), durationSec: 75, audioPlan: { ...(audioObservation ? { voiceMode: 'standard_voice_without_transfer', cadenceEvidenceIds: [] } : {}), atSec: 43, lineText: spokenLine(cue), voiceId: retainedVoice.voiceId, voiceVersion, sha256: retainedVoice.hashes[cue] }, personalizationLevel: cue === 'general' ? 'generic' : 'memory_based', qualityLevel: 'local_placeholder' }
  return { ...manifest, manifestHash: createHash('sha256').update(manifestContent(manifest)).digest('hex') }
}

export function withCadenceVoice(manifest: ReturnType<typeof episodeManifest>, cadence: NonNullable<Awaited<ReturnType<typeof renderCadenceVoice>>>['plan']) {
  const updated = { ...manifest, schemaVersion: '1.4', audioPlan: { ...manifest.audioPlan, voiceMode: 'confirmed_window_rate', sha256: cadence.sha256, cadence }, personalizationLevel: manifest.personalizationLevel === 'generic' ? 'audio_rate_based' : 'memory_and_audio_rate_based' }
  return { ...updated, manifestHash: createHash('sha256').update(manifestContent(updated)).digest('hex') }
}
