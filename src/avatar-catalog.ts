// Published IDs and their paths must remain immutable; new assets need a new ID.
export const retainedMaleAvatarVersion = 'adult-peasant-male-webp-v1'
export const retainedFemaleAvatarVersion = 'adult-peasant-female-webp-v1'
export const sittingMaleAvatarVersion = 'adult-peasant-male-sitting-v2'
export const sittingFemaleAvatarVersion = 'adult-peasant-female-sitting-v2'
export const pickupMaleAvatarVersion = 'adult-peasant-male-pickup-v3'
export const pickupFemaleAvatarVersion = 'adult-peasant-female-pickup-v3'
export const compactMaleAvatarVersion = 'adult-peasant-male-compact-v4'
export const compactFemaleAvatarVersion = 'adult-peasant-female-compact-v4'
export const currentAvatarVersion = compactMaleAvatarVersion
export const femaleAvatarVersion = compactFemaleAvatarVersion
export const candidateAvatarVersions = [currentAvatarVersion, femaleAvatarVersion] as const

const avatars: Record<string, { head: string; body: string; animations: string; motion: string; sitting?: boolean; pickup?: boolean; hashes: Record<'head' | 'body' | 'animations' | 'motion', string> }> = {
  [retainedMaleAvatarVersion]: {
    head: '/assets/quaternius/base-character-v1/adult-male-webp.glb',
    body: '/assets/quaternius/peasant-male-v1/outfit-webp.glb',
    animations: '/assets/quaternius/peasant-male-v1/animations.json',
    motion: '/assets/quaternius/animation-library-v3/walking-motion.json',
    hashes: {
      head: '062c445b973ef707f876a745be8fbd2f3f7c2000fadf279c4fdcab6089aef72b',
      body: 'e5ed6bada2861e7af6e8eeb2459843e72f612a6318032ac95d623c0a65199c3d',
      animations: 'ca16490cefaafd7d43f6f56fc160a797d6a4ac4b7b44db656cd0d00b9df1ef12',
      motion: 'b35070dcf3a70b600051651d73e8d82d1c7bf66014764893edc335f894fb28fd',
    },
  },

  [retainedFemaleAvatarVersion]: {
    head: '/assets/quaternius/base-female-v1/adult-female-webp.glb',
    body: '/assets/quaternius/peasant-female-v1/outfit-webp.glb',
    animations: '/assets/quaternius/peasant-female-v1/animations.json',
    motion: '/assets/quaternius/animation-library-v3/walking-motion.json',
    hashes: {
      head: 'b557eebb6aea2f930a2792c3dd89e8b3726eff1fdeb3bd0acaf62afefe9ebb62',
      body: '2d8d09484f9ba6f348aad71448cbb444ae8d273f14d3c91e7fe941425d859435',
      animations: '53586a8ba0b6b77b450587980cf6efb4824964f8bdb7aca4dec2aa81a2856ba1',
      motion: 'b35070dcf3a70b600051651d73e8d82d1c7bf66014764893edc335f894fb28fd',
    },
  },
}

avatars[sittingMaleAvatarVersion] = { ...avatars[retainedMaleAvatarVersion], sitting: true, animations: '/assets/quaternius/peasant-male-sitting-v2/animations.json', hashes: { ...avatars[retainedMaleAvatarVersion].hashes, animations: 'ab571fcd37e3da40309b377f0bd1215fc0822b17657aaecaf434ce2b62ec1cf4' } }
avatars[sittingFemaleAvatarVersion] = { ...avatars[retainedFemaleAvatarVersion], sitting: true, animations: '/assets/quaternius/peasant-female-sitting-v2/animations.json', hashes: { ...avatars[retainedFemaleAvatarVersion].hashes, animations: '10cecf93b0ebb8ae653b1f20910bd485fefa7263bb406bf20170b7ad9a91a47f' } }

avatars[pickupMaleAvatarVersion] = { ...avatars[sittingMaleAvatarVersion], pickup: true, animations: '/assets/quaternius/peasant-male-pickup-v3/animations.json', hashes: { ...avatars[sittingMaleAvatarVersion].hashes, animations: '0336a7155c813b8562e4c14d8ff841eb66cd72c772890b2018ba6b0e1f89b1b1' } }
avatars[pickupFemaleAvatarVersion] = { ...avatars[sittingFemaleAvatarVersion], pickup: true, animations: '/assets/quaternius/peasant-female-pickup-v3/animations.json', hashes: { ...avatars[sittingFemaleAvatarVersion].hashes, animations: 'df0b469b6893f625852dc318ce3ab5bc088e46d0c1165320a79caf6f5c2890f7' } }

avatars[compactMaleAvatarVersion] = { ...avatars[pickupMaleAvatarVersion], head: '/assets/quaternius/base-character-v1/adult-male-mobile-v2.glb', body: '/assets/quaternius/peasant-male-v1/outfit-mobile-v2.glb', hashes: { ...avatars[pickupMaleAvatarVersion].hashes, head: '04edf812ff4d8bae8ad93d68dc40bbe1251147dbd0e3a05bfc05ce7b5a5064a9', body: '9eb8041a41f1921f1079ae8015c877f2753dac62d6ad54c24d965bcc8058ec53' } }
avatars[compactFemaleAvatarVersion] = { ...avatars[pickupFemaleAvatarVersion], head: '/assets/quaternius/base-female-v1/adult-female-mobile-v2.glb', body: '/assets/quaternius/peasant-female-v1/outfit-mobile-v2.glb', hashes: { ...avatars[pickupFemaleAvatarVersion].hashes, head: '74b38cf254d262b32a5a8ba7068660c11049ef115826c9e02e954863ce21ee53', body: '411ba1c158b981b00e73d961e9c476a446723577e5a2d87950af43cd8206e21a' } }

export function avatarAssets(version: string | undefined) {
  if (!version) throw new Error('missing_character_version')
  if (!Object.hasOwn(avatars, version)) throw new Error('unsupported_character_version')
  return avatars[version]
}


// Keep the published two-episode identity cadence when expanding the scene list.
export function avatarVersionForEncounter(previousCount: number) {
  if (!Number.isSafeInteger(previousCount) || previousCount < 0) throw new Error('invalid_encounter_count')
  return candidateAvatarVersions[Math.floor(previousCount / 2) % candidateAvatarVersions.length]
}
