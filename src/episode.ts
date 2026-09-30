import type { Encounter } from './encounter'
import { manifestContent } from './manifest'

export type ApiEpisode = {
  episodeId: string
  status: string
  createdAt: string
  retracted?: boolean
  manifest: {
    cue: Encounter['cue']; sceneId: Encounter['scene']; durationSec: 75; evidenceId?: string
    avatarVersion?: string; performanceVersion?: string; sceneVersion?: string; seed?: number; manifestHash?: string
    degraded?: boolean; degradationReason?: string | null; audioObservation?: { signalStatus?: string }
    personalizationLevel?: Encounter['personalizationLevel']
    [key: string]: unknown
  }
}

export async function fromApi(item: ApiEpisode): Promise<Encounter> {
  let manifestVerified = false
  if (item.manifest.manifestHash) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestContent(item.manifest)))
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    manifestVerified = actual === item.manifest.manifestHash
  }
  return { id: item.episodeId, seed: item.manifest.seed ?? NaN, memory: '', cue: item.manifest.cue,
    scene: item.manifest.sceneId, durationSec: item.manifest.durationSec, createdAt: item.createdAt,
    sceneVersion: item.manifest.sceneVersion, manifestHash: item.manifest.manifestHash, manifestVerified, personalizationLevel: item.manifest.personalizationLevel,
    performanceVersion: item.manifest.performanceVersion, avatarVersion: item.manifest.avatarVersion, evidenceId: item.manifest.evidenceId, retracted: item.retracted, degraded: item.manifest.degraded, degradationReason: item.manifest.degradationReason || undefined, audioSignalStatus: item.manifest.audioObservation?.signalStatus }
}
