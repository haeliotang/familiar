import Fastify from 'fastify'
import type pg from 'pg'
import { expect, it, vi } from 'vitest'
import { LocalTranscriberBusy } from './asr'
import { registerTranscriptionRoutes } from './transcriptions'

it('returns a retryable busy response without saving a transcript when the shared model is full', async () => {
  const query = vi.fn(async (sql: string) => sql.startsWith('SELECT a.kind')
    ? { rowCount: 1, rows: [{ kind: 'user_memory_audio', speaker_role: 'user', state: 'ready' }] }
    : { rowCount: 0, rows: [] })
  const app = Fastify()
  registerTranscriptionRoutes(app, { query } as unknown as pg.Pool, '/synthetic-only', async () => 'synthetic-owner', async () => { throw new LocalTranscriberBusy() })
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/assets/00000000-0000-4000-8000-000000000001/transcription' })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toEqual({ code: 'local_transcriber_busy' })
    expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
  } finally { await app.close() }
})
