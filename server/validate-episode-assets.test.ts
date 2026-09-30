import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avatarAssets } from '../src/avatar-catalog'
import { episodeManifest } from './episode-manifest'
import { validateEpisodeAssets } from './validate-episode-assets'

describe('selected episode resource validation', () => {
  it.each([0, 2])('accepts the actual pinned candidate resources for count %s', async count => {
    for (const cue of ['general', 'wait', 'repair'] as const) await expect(validateEpisodeAssets(episodeManifest('synthetic', 1, null, cue, count))).resolves.toBeUndefined()
  })
  it('rejects absent resources and altered character or voice bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'friend-publish-check-'))
    const manifest = episodeManifest('synthetic', 1, null, 'general', 0)
    try {
      await expect(validateEpisodeAssets(manifest, root)).rejects.toThrow('candidate_assets_unavailable')
      const assets = avatarAssets(manifest.avatarVersion)
      const paths = [assets.head, assets.body, assets.animations, assets.motion, `/assets/voices/${manifest.audioPlan.voiceVersion}/general.wav`]
      for (const path of paths) {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await writeFile(join(root, path), await readFile(join('public', path)))
      }
      await expect(validateEpisodeAssets(manifest, root)).resolves.toBeUndefined()
      for (const path of [assets.head, paths[4]]) {
        const original = await readFile(join(root, path))
        await writeFile(join(root, path), Buffer.from('synthetic altered bytes'))
        await expect(validateEpisodeAssets(manifest, root)).rejects.toThrow('candidate_assets_unavailable')
        await writeFile(join(root, path), original)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
