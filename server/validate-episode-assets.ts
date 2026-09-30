import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { avatarAssets } from '../src/avatar-catalog'
import { voicePackage } from '../src/voice-catalog'
import type { episodeManifest } from './episode-manifest'

export class EpisodeAssetsUnavailable extends Error {}

export async function validateEpisodeAssets(manifest: ReturnType<typeof episodeManifest>, publicRoot = join(process.cwd(), 'public')) {
  try {
    const avatar = avatarAssets(manifest.avatarVersion)
    for (const key of ['head', 'body', 'animations', 'motion'] as const) {
      const bytes = await readFile(join(publicRoot, avatar[key]))
      if (createHash('sha256').update(bytes).digest('hex') !== avatar.hashes[key]) throw new Error('asset_changed')
    }
    const expected = voicePackage(manifest.audioPlan.voiceVersion).hashes[manifest.cue]
    if (expected !== manifest.audioPlan.sha256) throw new Error('voice_plan_changed')
    const audio = await readFile(join(publicRoot, 'assets/voices', manifest.audioPlan.voiceVersion, `${manifest.cue}.wav`))
    if (createHash('sha256').update(audio).digest('hex') !== expected) throw new Error('voice_changed')
  } catch {
    throw new EpisodeAssetsUnavailable('candidate_assets_unavailable')
  }
}
