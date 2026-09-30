import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Fastify from 'fastify'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { localPool } from './local-pool'
import { createApp } from './index'
import { registerTranscriptionRoutes } from './transcriptions'

async function fixture(transcribe: Parameters<typeof registerTranscriptionRoutes>[4]) {
  const db = new PGlite()
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const pool = localPool(db)
  const app = createApp(pool, `/private/tmp/familiar-transcription-${randomUUID()}`)
  const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
  const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
  const ownerId = (await pool.query('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
  const assetId = randomUUID()
  await pool.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'user_memory_audio','user','audio/wav',100,'ready')", [assetId, ownerId, personId])
  const speech = Fastify()
  registerTranscriptionRoutes(speech, pool, '/synthetic-test', async header => header === 'owner' ? ownerId : header === 'foreign' ? randomUUID() : null, transcribe)
  const url = `/v1/assets/${assetId}/transcription`
  return { pool, app, speech, cookie, personId, assetId, url, close: async () => { await speech.close(); await app.close(); await db.close() } }
}
const result = { modelId: 'synthetic-asr', text: '合成测试：回头等我', segments: [{ startSec: 0, endSec: 2, text: '合成测试：回头等我' }] }

it('confirms edited memory once, retains source and never revives a retracted confirmation', async () => {
  const f = await fixture(async () => result)
  const request = { method: 'POST' as const, url: `${f.url}/confirm`, headers: { cookie: 'owner' }, payload: { text: '合成测试：他会回头等我' } }
  try {
    expect((await f.speech.inject(request)).statusCode).toBe(409)
    await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })
    expect((await f.speech.inject({ ...request, headers: { cookie: 'foreign' } })).statusCode).toBe(404)
    expect((await f.speech.inject({ ...request, payload: { text: '' } })).statusCode).toBe(400)
    const first = await f.speech.inject(request)
    expect(first.statusCode).toBe(201)
    expect((await f.pool.query('SELECT review_state FROM source_assets WHERE id=$1', [f.assetId])).rows[0].review_state).toBe('confirmed')
    expect((await f.speech.inject(request)).json().evidenceId).toBe(first.json().evidenceId)
    expect((await f.pool.query('SELECT source_asset_id,origin,locator FROM evidence')).rows[0]).toMatchObject({ source_asset_id: f.assetId, origin: 'user_memory_audio', locator: { confirmed: true, segments: [{ startSec: 0, endSec: 2 }] } })
    expect((await f.pool.query('SELECT revision FROM persons WHERE id=$1', [f.personId])).rows[0].revision).toBe(2)
    const editedRequest = { ...request, payload: { text: '合成测试：他会修东西' } }
    const edited = await f.speech.inject(editedRequest)
    expect(edited.json().cue).toBe('repair')
    expect((await f.pool.query('SELECT id FROM evidence WHERE usable=true')).rows).toHaveLength(1)
    expect((await f.pool.query('SELECT revision FROM persons WHERE id=$1', [f.personId])).rows[0].revision).toBe(3)
    expect((await f.speech.inject(request)).statusCode).toBe(409)
    await f.app.inject({ method: 'POST', url: `/v1/evidence/${edited.json().evidenceId}/retract`, headers: { cookie: f.cookie } })
    expect((await f.speech.inject(editedRequest)).statusCode).toBe(409)
    await f.app.inject({ method: 'DELETE', url: `/v1/persons/${f.personId}`, headers: { cookie: f.cookie } })
    expect((await f.speech.inject(request)).statusCode).toBe(404)
  } finally { await f.close() }
})

it('persists skipping without creating evidence or changing confirmed memory', async () => {
  const f = await fixture(async () => result)
  const skip = { method: 'POST' as const, url: `${f.url}/skip`, headers: { cookie: 'owner' } }
  try {
    const assetsUrl = `/v1/persons/${f.personId}/assets`
    expect((await f.app.inject({ method: 'GET', url: assetsUrl, headers: { cookie: f.cookie } })).json().assets[0].reviewState).toBe('pending')
    expect((await f.speech.inject({ ...skip, headers: { cookie: 'foreign' } })).statusCode).toBe(404)
    expect((await f.speech.inject(skip)).statusCode).toBe(204)
    expect((await f.speech.inject(skip)).statusCode).toBe(204)
    expect((await f.pool.query('SELECT review_state FROM source_assets WHERE id=$1', [f.assetId])).rows[0].review_state).toBe('skipped')
    expect((await f.app.inject({ method: 'GET', url: assetsUrl, headers: { cookie: f.cookie } })).json().assets[0].reviewState).toBe('skipped')
    expect((await f.pool.query('SELECT id FROM evidence')).rows).toEqual([])
    await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })
    await f.speech.inject({ method: 'POST', url: `${f.url}/confirm`, headers: { cookie: 'owner' }, payload: { text: result.text } })
    await f.speech.inject(skip)
    expect((await f.pool.query('SELECT review_state FROM source_assets WHERE id=$1', [f.assetId])).rows[0].review_state).toBe('confirmed')
    await f.app.inject({ method: 'DELETE', url: `/v1/persons/${f.personId}`, headers: { cookie: f.cookie } })
    expect((await f.speech.inject(skip)).statusCode).toBe(404)
  } finally { await f.close() }
})

it('stores a source-bound transcript once and keeps it outside evidence until confirmation', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; return result })
  try {
    expect((await f.speech.inject({ method: 'POST', url: f.url })).statusCode).toBe(401)
    expect((await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'foreign' } })).statusCode).toBe(404)
    expect((await f.speech.inject({ method: 'GET', url: f.url, headers: { cookie: 'owner' } })).json().transcript).toBeNull()
    for (let index = 0; index < 2; index++) {
      const response = await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })
      expect(response.statusCode).toBe(200)
      expect(response.json().transcript).toMatchObject({ sourceAssetId: f.assetId, origin: 'user_memory_audio', ...result })
    }
    expect(calls).toBe(1)
    expect((await f.pool.query('SELECT id FROM evidence')).rows).toEqual([])
    await f.app.inject({ method: 'DELETE', url: `/v1/persons/${f.personId}`, headers: { cookie: f.cookie } })
    expect((await f.pool.query('SELECT asset_id FROM asset_transcripts')).rows).toEqual([])
    expect((await f.speech.inject({ method: 'GET', url: f.url, headers: { cookie: 'owner' } })).statusCode).toBe(404)
  } finally { await f.close() }
})

it('rejects deceased audio without invoking transcription', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; return result })
  try {
    await f.pool.query("UPDATE source_assets SET kind='deceased_audio',speaker_role='deceased' WHERE id=$1", [f.assetId])
    expect((await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })).statusCode).toBe(409)
    expect(calls).toBe(0)
  } finally { await f.close() }
})

it('discards late recognition after deletion and refuses overlapping local work', async () => {
  let started!: () => void
  let finish!: (value: typeof result) => void
  const generating = new Promise<void>(resolve => { started = resolve })
  const pending = new Promise<typeof result>(resolve => { finish = resolve })
  const f = await fixture(async () => { started(); return pending })
  try {
    const late = f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })
    await generating
    expect((await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })).statusCode).toBe(429)
    await f.app.inject({ method: 'DELETE', url: `/v1/persons/${f.personId}`, headers: { cookie: f.cookie } })
    finish(result)
    expect((await late).statusCode).toBe(404)
    expect((await f.pool.query('SELECT asset_id FROM asset_transcripts')).rows).toEqual([])
  } finally { finish(result); await f.close() }
})

it('accepts 500 Unicode characters for text memory and confirmed transcripts, rejecting 501', async () => {
  const f = await fixture(async () => result)
  const text = '🙂'.repeat(500)
  try {
    const memory = { method: 'POST' as const, url: `/v1/persons/${f.personId}/memories`, headers: { cookie: f.cookie }, payload: { text } }
    expect((await f.app.inject(memory)).statusCode).toBe(201)
    expect((await f.app.inject({ ...memory, payload: { text: text + '甲' } })).statusCode).toBe(400)
    await f.speech.inject({ method: 'POST', url: f.url, headers: { cookie: 'owner' } })
    const confirmation = { method: 'POST' as const, url: `${f.url}/confirm`, headers: { cookie: 'owner' }, payload: { text } }
    expect((await f.speech.inject(confirmation)).statusCode).toBe(201)
    expect((await f.speech.inject({ ...confirmation, payload: { text: text + '甲' } })).statusCode).toBe(400)
    expect((await f.pool.query('SELECT text FROM evidence WHERE person_id=$1', [f.personId])).rows.map(row => row.text)).toEqual([text, text])
  } finally { await f.close() }
})
