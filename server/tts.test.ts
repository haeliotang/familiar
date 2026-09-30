import { currentVoiceId, currentVoiceVersion, voiceHashes, femaleVoiceVersion, voicePackage } from '../src/voice-catalog'
import Fastify from 'fastify'
import type pg from 'pg'
import { expect, it, vi } from 'vitest'
import { registerTtsRoutes } from './tts'

it.each([true, false])('checks access after generation (revoked: %s)', async revoked => {
  let accessible = true
  let started!: () => void
  let finish!: (audio: Buffer) => void
  const generating = new Promise<void>(resolve => { started = resolve })
  const audio = new Promise<Buffer>(resolve => { finish = resolve })
  const pool = { query: async () => accessible ? { rowCount: 1, rows: [{ cue: 'general', lineText: '今天的风很好。', voiceVersion: currentVoiceVersion, voiceId: currentVoiceId, sha256: voiceHashes.general }] } : { rowCount: 0, rows: [] } } as unknown as pg.Pool
  const app = Fastify()
  registerTtsRoutes(app, pool, async () => 'owner', async () => { started(); return audio })
  try {
    const response = app.inject({ method: 'GET', url: '/v1/episodes/00000000-0000-4000-8000-000000000001/voice' })
    await generating
    accessible = !revoked
    finish(Buffer.from('synthetic-audio'))
    const result = await response
    expect(result.statusCode).toBe(revoked ? 404 : 200)
    if (!revoked) expect(result.body).toBe('synthetic-audio')
  } finally { await app.close() }
})


it.each(['future-version', undefined])('rejects an unsupported or unrecorded voice version (%s)', async voiceVersion => {
  const pool = { query: async () => ({ rowCount: 1, rows: [{ cue: 'general', lineText: '今天的风很好。', voiceVersion, voiceId: currentVoiceId, sha256: voiceHashes.general }] }) } as unknown as pg.Pool
  const generate = vi.fn(async () => Buffer.from('synthetic-audio'))
  const app = Fastify()
  registerTtsRoutes(app, pool, async () => 'owner', generate)
  try {
    const result = await app.inject({ method: 'GET', url: '/v1/episodes/00000000-0000-4000-8000-000000000001/voice' })
    expect(result.statusCode).toBe(409)
    expect(result.json().code).toBe('unsupported_voice_plan')
    expect(generate).not.toHaveBeenCalled()
  } finally { await app.close() }
})


it.each([currentVoiceVersion, femaleVoiceVersion])('serves retained bytes through the authenticated route for %s', async voiceVersion => {
  const retained = voicePackage(voiceVersion)
  const pool = { query: async () => ({ rowCount: 1, rows: [{ cue: 'general', lineText: '今天的风很好。', voiceVersion, voiceId: retained.voiceId, sha256: retained.hashes.general }] }) } as unknown as pg.Pool
  const app = Fastify()
  registerTtsRoutes(app, pool, async () => 'owner')
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/episodes/00000000-0000-4000-8000-000000000001/voice' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('audio/wav')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.rawPayload.subarray(0, 4).toString()).toBe('RIFF')
  } finally { await app.close() }
})
