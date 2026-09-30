import type { Encounter } from './encounter'
import { voicePackage, voiceVersionForAvatar } from './voice-catalog'
import { verifiedAsset } from './verified-asset'

export async function encounterVoiceBytes(encounter: Pick<Encounter, 'id' | 'avatarVersion' | 'cue'>) {
  if (encounter.id === 'demo') {
    if (!encounter.avatarVersion) throw new Error('missing_character_version')
    const version = voiceVersionForAvatar(encounter.avatarVersion)
    return verifiedAsset(`/assets/voices/${version}/${encounter.cue}.wav`, voicePackage(version).hashes[encounter.cue])
  }
  const url = `/v1/episodes/${encounter.id}/voice`
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('voice_unavailable')
  return response.arrayBuffer()
}
