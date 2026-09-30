import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { encounterVoiceBytes } from './encounter-voice'
import { sittingMaleAvatarVersion, sittingFemaleAvatarVersion } from './avatar-catalog'
import { voiceVersionForAvatar } from './voice-catalog'

afterEach(() => vi.unstubAllGlobals())

it.each([sittingMaleAvatarVersion, sittingFemaleAvatarVersion].flatMap(avatarVersion => ['general', 'wait', 'repair'].map(cue => ({ avatarVersion, cue: cue as 'general' | 'wait' | 'repair' }))))('loads the pinned demo voice for $avatarVersion / $cue', async ({ avatarVersion, cue }) => {
  const url = `/assets/voices/${voiceVersionForAvatar(avatarVersion)}/${cue}.wav`
  const bytes = readFileSync(`public${url}`)
  const fetcher = vi.fn(async (_url: string) => new Response(new Uint8Array(bytes)))
  vi.stubGlobal('fetch', fetcher)
  expect(new Uint8Array(await encounterVoiceBytes({ id: 'demo', avatarVersion, cue }))).toEqual(new Uint8Array(bytes))
  expect(fetcher.mock.calls[0][0]).toBe(url)
})

it('keeps personal episode audio on the authenticated route and rejects unavailable audio', async () => {
  const fetcher = vi.fn(async () => new Response('not found', { status: 404 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(encounterVoiceBytes({ id: 'synthetic-episode', cue: 'general' })).rejects.toThrow('voice_unavailable')
  expect(fetcher).toHaveBeenCalledWith('/v1/episodes/synthetic-episode/voice', { credentials: 'same-origin' })
})

it('rejects modified demo voice bytes before decoding', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('synthetic replacement')))
  await expect(encounterVoiceBytes({ id: 'demo', avatarVersion: sittingFemaleAvatarVersion, cue: 'repair' })).rejects.toThrow('character_asset_changed')
})
