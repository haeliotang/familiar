import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import type pg from 'pg'
import { expect, it } from 'vitest'
import { clipStandardWav, registerAudioClipRoutes } from './audio-clip'
import { manifestContent } from '../src/manifest'

function syntheticWave() {
  const bytes = Buffer.alloc(44 + 3 * 32000)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  for (let i = 0; i < 48000; i++) bytes.writeInt16LE(i % 30000, 44 + i * 2)
  return bytes
}

it('returns only the selected PCM samples and rejects invalid windows', () => {
  const bytes = syntheticWave()
  const clip = clipStandardWav(bytes, 1, 2)
  expect(clip.length).toBe(32044)
  expect(clip.readInt16LE(44)).toBe(16000)
  expect(clip.readInt16LE(clip.length - 2)).toBe(1999)
  for (const [from, to] of [[NaN, 2], [-1, 1], [2, 2], [0, 31], [2, 4]]) expect(() => clipStandardWav(bytes, from, to)).toThrow()
  expect(() => clipStandardWav(bytes.subarray(0, 30), 0, 1)).toThrow()
})

it('rejects a clip finishing after access is revoked', async () => {
  const bytes = syntheticWave()
  const observations = { normalizedAudioSha256: createHash('sha256').update(bytes).digest('hex'), selectedWindow: { startSec: 1, endSec: 2 } }
  let deleted = false
  let reached!: () => void
  let finish!: () => void
  const started = new Promise<void>(resolve => { reached = resolve })
  const released = new Promise<void>(resolve => { finish = resolve })
  const pool = { query: async () => ({ rowCount: deleted ? 0 : 1, rows: deleted ? [] : [{ observations }] }) } as unknown as pg.Pool
  const app = Fastify()
  registerAudioClipRoutes(app, pool, '/synthetic-only', async () => 'synthetic-owner', async () => { reached(); await released; return bytes })
  try {
    const fingerprint = createHash('sha256').update(manifestContent(observations)).digest('hex')
    const response = app.inject({ url: `/v1/assets/00000000-0000-4000-8000-000000000001/audio-review/clip?fingerprint=${fingerprint}` })
    await started
    deleted = true; finish()
    expect((await response).statusCode).toBe(404)
  } finally { finish?.(); await app.close() }
})
