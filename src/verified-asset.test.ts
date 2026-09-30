import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { verifiedAsset } from './verified-asset'

afterEach(() => vi.unstubAllGlobals())

it('returns exactly the bytes whose fingerprint matches', async () => {
  const bytes = new TextEncoder().encode('synthetic asset')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  expect(new Uint8Array(await verifiedAsset('/synthetic', sha256))).toEqual(bytes)
})

it('rejects replaced content before it can be decoded', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('replaced asset')))
  const sha256 = createHash('sha256').update('synthetic asset').digest('hex')
  await expect(verifiedAsset('/synthetic', sha256)).rejects.toThrow('character_asset_changed')
})

it('rejects failed responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 404 })))
  await expect(verifiedAsset('/synthetic', '0'.repeat(64))).rejects.toThrow('character_asset_unavailable')
})
