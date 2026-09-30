import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createApp } from './index'
import { localPool } from './local-pool'

it('binds user audio review to source and window, deduplicates changes and clears it on deletion', async () => {
  const db = new PGlite()
  const root = await mkdtemp(join(tmpdir(), 'friend-audio-review-'))
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const app = createApp(localPool(db), root)
  try {
    const session = async () => (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const cookie = await session()
    const foreign = await session()
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const ownerId = (await db.query<{ owner_id: string }>('SELECT owner_id FROM persons WHERE id=$1', [personId])).rows[0].owner_id
    const id = randomUUID()
    await db.query("INSERT INTO source_assets(id,owner_id,person_id,kind,speaker_role,media_type,expected_bytes,state) VALUES($1,$2,$3,'deceased_audio','deceased','audio/wav',100,'ready')", [id, ownerId, personId])
    const observation = { normalizedAudioSha256: 'a'.repeat(64), selectedWindow: { startSec: 0, endSec: 6 }, speechActivity: { status: 'measured', speechDurationSec: 4 } }
    await db.query('INSERT INTO asset_audio_observations(asset_id,observations) VALUES($1,$2)', [id, observation])
    const path = `/v1/assets/${id}/audio-review`
    const observationFingerprint = (await app.inject({ url: path, headers: { cookie } })).json().observationFingerprint
    const payload = { observationFingerprint, normalizedAudioSha256: observation.normalizedAudioSha256, startSec: 0, endSec: 6, subject: 'single_person', text: '今天的风很好。' }
    const post = (body = payload, token = cookie) => app.inject({ method: 'POST', url: path, headers: { cookie: token }, payload: body })
    for (const method of ['GET', 'POST'] as const) expect((await app.inject({ method, url: path, headers: { cookie: foreign }, ...(method === 'POST' ? { payload } : {}) })).statusCode).toBe(404)
    const confirmed = await post()
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().review.rateEstimate).toMatchObject({ reviewStatus: 'user_confirmed_text', charactersPerSpeechSec: 1.5 })
    expect((await post()).json()).toEqual(confirmed.json())
    expect((await db.query<{ revision: number }>('SELECT revision FROM persons WHERE id=$1', [personId])).rows[0].revision).toBe(2)
    expect((await app.inject({ url: path, headers: { cookie } })).json()).toEqual(confirmed.json())
    expect((await post({ ...payload, subject: 'mixed' })).json().review.rateEstimate).toBeNull()
    expect((await post({ ...payload, text: '字'.repeat(501) })).statusCode).toBe(400)
    await db.query('UPDATE asset_audio_observations SET observations=$2 WHERE asset_id=$1', [id, { ...observation, normalizedAudioSha256: 'b'.repeat(64) }])
    expect((await app.inject({ url: path, headers: { cookie } })).json().review).toBeNull()
    expect((await post()).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).statusCode).toBe(202)
    expect((await post()).statusCode).toBe(404)
    expect((await db.query('SELECT asset_id FROM asset_audio_observations WHERE asset_id=$1', [id])).rows).toEqual([])
  } finally { await app.close(); await db.close(); await rm(root, { recursive: true, force: true }) }
})
