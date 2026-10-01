import { femaleAvatarVersion, retainedFemaleAvatarVersion, sittingFemaleAvatarVersion, pickupFemaleAvatarVersion, avatarAssets } from './avatar-catalog'
import type { Cue } from './encounter'

export const currentVoiceVersion = 'kokoro-zh-zm009-v1'
export const currentVoiceId = 'kokoro-zh-zm009'
export const voiceHashes: Record<Cue, string> = {
  general: '92f2aa65f63c8dcceed12b916f1528fe99db528b9c1e1899c067a3e534dea391',
  wait: '41f0c45181d2e436e2fa41ce23cc815ac08e1f027df9bb9806a5f96b53fe92da',
  repair: '0a24effa9d39f3b15a22668e955a2cafa60ccf24b0b70f4a7aa7633a112a1ab6',
}


export const femaleVoiceVersion = 'kokoro-zh-zf001-v1'
const packages: Record<string, { voiceId: string; hashes: Record<Cue, string> }> = {
  [currentVoiceVersion]: { voiceId: currentVoiceId, hashes: voiceHashes },
  [femaleVoiceVersion]: { voiceId: 'kokoro-zh-zf001', hashes: {
    general: 'aa4c188072c5ffa459f698f0ed828fb967047e95d8997f198a6eb107b7f67430',
    wait: 'c3b88a420b97cba161d908a79c2d5608da2714cb52971974e612afce5a1d90d5',
    repair: '989847fea9fe923eea341f5896061629375cd6738f848d6f36293cd716919464',
  } },
}

export function voicePackage(version: string | undefined) {
  if (!version || !Object.hasOwn(packages, version)) throw new Error('unsupported_voice_version')
  return packages[version]
}

export function voiceVersionForAvatar(avatarVersion: string) {
  avatarAssets(avatarVersion)
  return avatarVersion === femaleAvatarVersion || avatarVersion === retainedFemaleAvatarVersion || avatarVersion === sittingFemaleAvatarVersion || avatarVersion === pickupFemaleAvatarVersion ? femaleVoiceVersion : currentVoiceVersion
}
