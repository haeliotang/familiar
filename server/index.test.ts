import { createHash } from 'node:crypto'
import { manifestContent } from '../src/manifest'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './index'
import { processPreparationJobs } from './preparations'
import { localPool } from './local-pool'
import { candidateSceneIds, currentSceneVersion, sceneLayout } from '../src/scene-catalog'

const open: Array<{ close: () => Promise<void> }> = []
afterEach(async () => { await Promise.all(open.splice(0).map(item => item.close())) })

async function setup(withAssets = false) {
  const db = new PGlite()
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const pool = localPool(db)
  const assetRoot = withAssets ? await mkdtemp(join(tmpdir(), 'ordinary-friend-assets-')) : undefined
  const app = createApp(pool, assetRoot)
  open.push({ close: async () => { await app.close(); await db.close(); if (assetRoot) await rm(assetRoot, { recursive: true, force: true }) } })
  return { app, db, assetRoot, pool }
}

describe('anonymous encounter API', () => {
  it('publishes all six scenes through preparation jobs and preserves their history and retries', async () => {
    const { app, pool } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成六场景测试：回头等我' } })
    const published = []
    for (let count = 0; count < 7; count++) {
      const request = { method: 'POST' as const, url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': `six-scenes-${count}` } }
      const queued = await app.inject(request)
      expect(queued.statusCode).toBe(202)
      await processPreparationJobs(pool)
      const status = (await app.inject({ url: queued.json().statusUrl, headers: { cookie } })).json()
      expect(status.status).toBe('completed')
      const episode = (await app.inject({ url: `/v1/episodes/${status.episodeId}`, headers: { cookie } })).json()
      expect(episode.manifest.sceneId).toBe(candidateSceneIds[count % 6])
      expect(episode.manifest.sceneVersion).toBe(currentSceneVersion)
      expect(sceneLayout(episode.manifest.sceneVersion, episode.manifest.sceneId, episode.manifest.seed)).toHaveProperty('props')
      expect(episode.manifest.manifestHash).toBe(createHash('sha256').update(manifestContent(episode.manifest)).digest('hex'))
      const retried = await app.inject(request)
      expect(retried.json().statusUrl).toBe(queued.json().statusUrl)
      published.push(episode)
    }
    const history = (await app.inject({ url: `/v1/persons/${personId}/episodes`, headers: { cookie } })).json().episodes
    expect(history).toHaveLength(7)
    for (const episode of published) {
      expect(history.find((item: { manifest: { episodeId: string } }) => item.manifest.episodeId === episode.manifest.episodeId)?.manifest).toEqual(episode.manifest)
      expect((await app.inject({ url: `/v1/episodes/${episode.manifest.episodeId}`, headers: { cookie } })).json().manifest).toEqual(episode.manifest)
    }
  })

  it('preserves the avatar version in storage, history and idempotent replay', async () => {
    const { app, db } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成测试：回头等我' } })
    const request = { method: 'POST' as const, url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'pinned-avatar-version' } }
    const episodeId = (await app.inject(request)).json().episodeId
    const read = () => app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie } })
    expect((await read()).json().manifest).toMatchObject({ avatarVersion: 'adult-peasant-male-compact-v4', audioPlan: { voiceId: 'kokoro-zh-zm009', voiceVersion: 'kokoro-zh-zm009-v1', sha256: '41f0c45181d2e436e2fa41ce23cc815ac08e1f027df9bb9806a5f96b53fe92da' } })
    const saved = (await read()).json().manifest
    expect(saved.sceneVersion).toBe('procedural-places-v3')
    expect(saved.performanceVersion).toBe('character-timeline-v4')
    expect(Number.isInteger(saved.seed) && saved.seed >= 0 && saved.seed <= 0xffffffff).toBe(true)
    expect(saved.manifestHash).toBe(createHash('sha256').update(manifestContent(saved)).digest('hex'))
    expect((await app.inject(request)).json().episodeId).toBe(episodeId)
    expect((await read()).json().manifest).toEqual(saved)
    // An old recorded version must survive a retry; creation must not rewrite it.
    await db.query("UPDATE episodes SET manifest=jsonb_set(manifest,'{avatarVersion}','\"retained-historical-version\"'::jsonb) WHERE id=$1", [episodeId])
    expect((await app.inject(request)).json().episodeId).toBe(episodeId)
    expect((await read()).json().manifest.avatarVersion).toBe('retained-historical-version')
    const history = (await app.inject({ method: 'GET', url: `/v1/persons/${personId}/episodes`, headers: { cookie } })).json().episodes
    expect(history[0].manifest.avatarVersion).toBe('retained-historical-version')
  })

  it('binds episode retries to the requested active person and visible episode', async () => {
    const { app } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const firstPerson = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const secondPerson = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    for (const personId of [firstPerson, secondPerson]) await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成重试测试：回头等我' } })
    const headers = { cookie, 'idempotency-key': 'person-bound-retry' }
    const first = await app.inject({ method: 'POST', url: `/v1/persons/${firstPerson}/episodes`, headers })
    expect(first.statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${secondPerson}/episodes`, headers })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${firstPerson}/episodes`, headers })).json().episodeId).toBe(first.json().episodeId)
    await app.inject({ method: 'POST', url: `/v1/episodes/${first.json().episodeId}/hide`, headers: { cookie } })
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${firstPerson}/episodes`, headers })).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/v1/persons/${firstPerson}`, headers: { cookie } })
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${firstPerson}/episodes`, headers })).statusCode).toBe(404)
  })

  it('keeps a negated memory out of the generated behavior', async () => {
    const { app, db, pool } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const memory = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成否定测试：他从不修东西' } })
    expect(memory.json().cue).toBe('general')
    await db.query("UPDATE evidence SET cue='repair' WHERE id=$1", [memory.json().evidenceId])
    const created = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'negation-regression-test' } })
    const episode = await app.inject({ url: `/v1/episodes/${created.json().episodeId}`, headers: { cookie } })
    expect(episode.json().manifest).toMatchObject({ cue: 'general', personalizationLevel: 'generic', plannerVersion: 'memory-cue-template-v4' })
    const queued = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': 'negation-task-regression' } })
    await processPreparationJobs(pool)
    const status = await app.inject({ url: queued.json().statusUrl, headers: { cookie } })
    const prepared = await app.inject({ url: `/v1/episodes/${status.json().episodeId}`, headers: { cookie } })
    expect(prepared.json().manifest).toMatchObject({ cue: 'general', plannerVersion: 'memory-cue-template-v4' })
  })

  it('varies the candidate appearance and matching voice while keeping earlier episodes intact', async () => {
    const { app } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成角色轮换测试：回头等我' } })
    const episodes = []
    for (let count = 0; count < 4; count++) {
      const created = (await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': `appearance-test-${count}` } })).json()
      episodes.push({ id: created.episodeId, manifest: (await app.inject({ method: 'GET', url: `/v1/episodes/${created.episodeId}`, headers: { cookie } })).json().manifest })
    }
    expect(new Set(episodes.map(item => `${item.manifest.sceneId}:${item.manifest.avatarVersion}`)).size).toBe(4)
    expect(episodes.map(item => item.manifest.audioPlan.voiceVersion)).toEqual(['kokoro-zh-zm009-v1', 'kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1', 'kokoro-zh-zf001-v1'])
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodes[0].id}`, headers: { cookie } })).json().manifest).toEqual(episodes[0].manifest)
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/episodes`, headers: { cookie } })).json().episodes).toHaveLength(4)
  })

  it('keeps another local request outside an uncommitted transaction', async () => {
    const { pool } = await setup()
    const client = await pool.connect()
    await client.query('BEGIN')
    await client.query("INSERT INTO sessions(id,token_hash) VALUES('00000000-0000-4000-8000-000000000001','synthetic-uncommitted')")
    const outside = pool.query("SELECT id FROM sessions WHERE token_hash='synthetic-uncommitted'")
    await client.query('ROLLBACK')
    client.release()
    expect((await outside).rows).toEqual([])
  })

  it('deduplicates simultaneous episode requests in the local database', async () => {
    const { app, db } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成测试：回头等我' } })
    const request = { method: 'POST' as const, url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'local-simultaneous' } }
    const results = await Promise.all([app.inject(request), app.inject(request)])
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 201])
    expect(results[0].json().episodeId).toBe(results[1].json().episodeId)
    expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toHaveLength(1)
  })

  it('persists deletion progress and retries a failed file cleanup without restoring access', async () => {
    const { app, db, pool, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const assetId = (await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: 'image/jpeg', sizeBytes: 10 } })).json().assetId
    const blockedFile = join(assetRoot!, `${assetId}.upload`)
    await mkdir(blockedFile)
    const deletion = await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
    expect(deletion.statusCode).toBe(202)
    const jobId = deletion.json().deletionJobId
    expect(jobId).toBeTruthy()
    const statusUrl = `/v1/deletions/${jobId}`
    expect((await app.inject({ method: 'GET', url: statusUrl, headers: { cookie } })).json()).toMatchObject({ status: 'pending', retryable: true })
    expect((await app.inject({ method: 'GET', url: statusUrl, headers: { cookie: foreign } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })).json().deletionJobId).toBe(jobId)
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: 'late' } })).statusCode).toBe(404)
    await rm(blockedFile, { recursive: true })
    await app.close()
    const restarted = createApp(pool, assetRoot)
    try {
      expect((await restarted.inject({ method: 'GET', url: statusUrl, headers: { cookie } })).json()).toMatchObject({ status: 'completed', retryable: false })
      expect((await restarted.inject({ method: 'GET', url: '/v1/deletions', headers: { cookie } })).json().deletions).toHaveLength(1)
    } finally { await restarted.close() }
    expect((await db.query('SELECT id FROM source_assets WHERE person_id=$1', [personId])).rows).toEqual([])
  })

  it('stores optional feedback once, isolates it and clears it on person deletion', async () => {
    const { app, db } = await setup()
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成测试：回头等我' } })
    const episodeId = (await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'feedback-episode' } })).json().episodeId
    const url = `/v1/episodes/${episodeId}/feedback`
    expect((await app.inject({ method: 'POST', url, payload: { comment: 'test' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url, headers: { cookie: foreign }, payload: { comment: 'test' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: {} })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: { comment: 'x'.repeat(501) } })).statusCode).toBe(400)
    const feedback = { experience: 'uncertain', issue: 'unnatural_voice', comment: '合成反馈：声音有些机械' }
    for (let index = 0; index < 2; index++) expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: feedback })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url, headers: { cookie: foreign } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).json().feedback).toMatchObject(feedback)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM episode_feedback')).rows[0].count).toBe(1)
    await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload: feedback })).statusCode).toBe(404)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM episode_feedback')).rows[0].count).toBe(0)
  })

  it('isolates sessions, deduplicates episodes and removes memory on deletion', async () => {
    const { app, db } = await setup()
    const sessionA = await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })
    const sessionB = await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })
    expect(sessionA.statusCode).toBe(201)
    const cookieA = sessionA.headers['set-cookie'] as string
    const cookieB = sessionB.headers['set-cookie'] as string
    expect((await app.inject({ method: 'GET', url: '/v1/sessions/current', headers: { cookie: cookieA } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/sessions/current' })).statusCode).toBe(401)
    const person = await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie: cookieA }, payload: {} })
    expect(person.statusCode).toBe(201)
    const personId = person.json().personId as string
    expect((await app.inject({ method: 'GET', url: '/v1/persons', headers: { cookie: cookieA } })).json().persons[0].personId).toBe(personId)
    expect((await app.inject({ method: 'GET', url: '/v1/persons', headers: { cookie: cookieB } })).json().persons).toEqual([])
    const foreignMemory = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie: cookieB }, payload: { text: '他总会等我' } })
    expect(foreignMemory.statusCode).toBe(404)
    const memory = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie: cookieA }, payload: { text: '他总会回头等我' } })
    expect(memory.statusCode).toBe(201)
    const request = { method: 'POST' as const, url: `/v1/persons/${personId}/episodes`, headers: { cookie: cookieA, 'idempotency-key': 'same-request-123' } }
    const first = await app.inject(request)
    const repeated = await app.inject(request)
    expect(first.statusCode).toBe(201)
    expect(first.json().status).toBe('prototype')
    expect(repeated.json().episodeId).toBe(first.json().episodeId)
    const episodeId = first.json().episodeId as string
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/episodes`, headers: { cookie: cookieA } })).json().episodes).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/episodes`, headers: { cookie: cookieB } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: cookieB } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: cookieA } })).json().manifest).toMatchObject({ cue: 'wait', audioPlan: { atSec: 43, lineText: '不用急，我走慢一点。' } })
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}/voice`, headers: { cookie: cookieB } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie: cookieB } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie: cookieA } })).statusCode).toBe(202)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie: cookieA } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}/voice`, headers: { cookie: cookieA } })).statusCode).toBe(404)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM evidence WHERE person_id=$1', [personId])).rows[0].count).toBe(0)
    expect((await db.query<{ manifest: object }>('SELECT manifest FROM episodes WHERE id=$1', [episodeId])).rows[0].manifest).toEqual({})
  })

  it('retracts a cue before future encounters and marks affected replay', async () => {
    const { app } = await setup()
    const session = await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })
    const cookie = session.headers['set-cookie'] as string
    const person = await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })
    const personId = person.json().personId as string
    const memory = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '他总会回头等我' } })
    const evidenceId = memory.json().evidenceId as string
    const episode = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'first-episode-key' } })
    const episodeId = episode.json().episodeId as string

    expect((await app.inject({ method: 'POST', url: `/v1/evidence/${evidenceId}/retract`, headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie } })).json().retracted).toBe(true)
    expect((await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'next-episode-key' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/v1/episodes/${episodeId}/hide`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${episodeId}`, headers: { cookie } })).statusCode).toBe(404)
  })

  it('stores a normalized private photo, isolates its metadata and removes files on deletion', async () => {
    const { app, assetRoot } = await setup(true)
    const alice = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const bob = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie: alice }, payload: {} })).json().personId as string
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#809e8b' } }).jpeg().toBuffer()
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie: alice }, payload: { personId, kind: 'photo', mediaType: 'image/jpeg', sizeBytes: photo.length } })
    expect(intent.statusCode).toBe(201)
    const assetId = intent.json().assetId as string
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie: bob, 'content-type': 'application/octet-stream' }, payload: photo })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie: alice, 'content-type': 'application/octet-stream' }, payload: photo })).statusCode).toBe(202)
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie: alice, 'content-type': 'application/octet-stream' }, payload: photo })).statusCode).toBe(202)
    const changedPhoto = Buffer.from(photo)
    changedPhoto[changedPhoto.length - 1] ^= 1
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${assetId}/content`, headers: { cookie: alice, 'content-type': 'application/octet-stream' }, payload: changedPhoto })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie: alice } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${assetId}/complete`, headers: { cookie: alice } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie: bob } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie: alice } })).json().assets[0]).toMatchObject({ assetId, kind: 'photo', speakerRole: 'none', state: 'ready' })
    expect(await readdir(assetRoot!)).toEqual([`${assetId}.jpg`])
    expect((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie: alice } })).statusCode).toBe(202)
    expect(await readdir(assetRoot!)).toEqual([])
  })

  it.each(['photo', 'user_memory_audio'])('preserves normalized %s when completion requests overlap', async kind => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const image = kind === 'photo'
      ? await sharp({ create: { width: 512, height: 512, channels: 3, background: '#809e8b' } }).jpeg().toBuffer()
      : await readFile(new URL('../public/assets/voices/kokoro-zh-zm009-v1/general.wav', import.meta.url))
    const extension = kind === 'photo' ? 'jpg' : 'wav'
    const id = (await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind, mediaType: kind === 'photo' ? 'image/jpeg' : 'audio/wav', sizeBytes: image.length } })).json().assetId
    await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image })
    const results = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })))
    expect(results.map(result => result.statusCode)).toEqual(Array(8).fill(200))
    expect(await readdir(assetRoot!)).toEqual([`${id}.${extension}`])
    if (kind === 'photo') expect((await sharp(join(assetRoot!, `${id}.jpg`)).metadata()).format).toBe('jpeg')
    else expect((await readFile(join(assetRoot!, `${id}.wav`))).subarray(0, 4).toString()).toBe('RIFF')
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie } })).json().assets[0].state).toBe('ready')
  })

  it('normalizes a synthetic HEIC photo and removes conversion intermediates', async () => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const image = await readFile(new URL('./fixtures/synthetic.heic', import.meta.url))
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: 'image/heic', sizeBytes: image.length } })
    expect(intent.statusCode).toBe(201)
    const id = intent.json().assetId
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })).statusCode).toBe(200)
    expect(await readdir(assetRoot!)).toEqual([`${id}.jpg`])
    const metadata = await sharp(join(assetRoot!, `${id}.jpg`)).metadata()
    expect(metadata).toMatchObject({ format: 'jpeg', width: 256, height: 192 })
    expect(metadata.exif).toBeUndefined()
  })

  it('retains an uploaded HEIC for retry when the decoder is unavailable', async () => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const image = await readFile(new URL('./fixtures/synthetic.heic', import.meta.url))
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'photo', mediaType: 'image/heic', sizeBytes: image.length } })
    const id = intent.json().assetId
    await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: image })
    const previousPath = process.env.PATH
    let response
    try {
      process.env.PATH = '/nonexistent-familiar-test-bin'
      response = await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })
    } finally { process.env.PATH = previousPath }
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'photo_decoder_unavailable' })
    expect(await readdir(assetRoot!)).toEqual([`${id}.upload`])
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie } })).json().assets[0].state).toBe('uploaded')
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })).statusCode).toBe(200)
    expect(await readdir(assetRoot!)).toEqual([`${id}.jpg`])
  })

  it.each(['ffprobe', 'ffmpeg'])('retains uploaded audio when %s is unavailable and allows retry', async tool => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const audio = await readFile(new URL('../public/assets/voices/kokoro-zh-zm009-v1/general.wav', import.meta.url))
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'user_memory_audio', mediaType: 'audio/wav', sizeBytes: audio.length } })
    const id = intent.json().assetId
    await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: audio })
    const bin = await mkdtemp(join(tmpdir(), 'ordinary-friend-audio-bin-'))
    const previousPath = process.env.PATH
    let response
    try {
      if (tool === 'ffmpeg') {
        const probe = previousPath!.split(':').map(directory => join(directory, 'ffprobe'))
        let available: string | undefined
        for (const path of probe) { try { await readFile(path); available = path; break } catch { /* try the next executable directory */ } }
        if (!available) throw new Error('test_requires_ffprobe')
        await symlink(available, join(bin, 'ffprobe'))
      }
      process.env.PATH = bin
      response = await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })
    } finally { process.env.PATH = previousPath; await rm(bin, { recursive: true, force: true }) }
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'audio_processor_unavailable' })
    expect(await readdir(assetRoot!)).toEqual([`${id}.upload`])
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie } })).json().assets[0]).toMatchObject({ state: 'uploaded', speakerRole: 'user' })
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })).statusCode).toBe(200)
    expect(await readdir(assetRoot!)).toEqual([`${id}.wav`])
  })

  it.each([['synthetic-stream.webm', 200], ['synthetic-stream-too-long.webm', 422]])('validates decoded duration for %s without container duration', async (filename, expectedStatus) => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
    const audio = await readFile(new URL(`./fixtures/${filename}`, import.meta.url))
    const intent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind: 'user_memory_audio', mediaType: 'audio/webm', sizeBytes: audio.length } })
    const id = intent.json().assetId
    await app.inject({ method: 'PUT', url: `/v1/assets/${id}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: audio })
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${id}/complete`, headers: { cookie } })).statusCode).toBe(expectedStatus)
    expect(await readdir(assetRoot!)).toEqual(expectedStatus === 200 ? [`${id}.wav`] : [])
  })

  it('keeps speaker roles separate and rejects corrupt media', async () => {
    const { app, assetRoot } = await setup(true)
    const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
    const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId as string
    const wav = Buffer.alloc(44 + 16_000 * 2)
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
    wav.writeUInt32LE(32_000, 40)
    const makeIntent = async (kind: string, mediaType: string, sizeBytes: number) => app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers: { cookie }, payload: { personId, kind, mediaType, sizeBytes } })
    const audioIntent = await makeIntent('user_memory_audio', 'audio/wav', wav.length)
    expect(audioIntent.statusCode).toBe(201)
    const audioId = audioIntent.json().assetId as string
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${audioId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: wav })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${audioId}/complete`, headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/persons/${personId}/assets`, headers: { cookie } })).json().assets[0]).toMatchObject({ kind: 'user_memory_audio', speakerRole: 'user', state: 'ready' })
    const audioOnly = await app.inject({ method: 'POST', url: `/v1/persons/${personId}/episodes`, headers: { cookie, 'idempotency-key': 'audio-only-prototype' } })
    expect(audioOnly.statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: `/v1/episodes/${audioOnly.json().episodeId}`, headers: { cookie } })).json().manifest).toMatchObject({ cue: 'general', evidenceId: null, personalizationLevel: 'generic' })
    const corrupt = Buffer.from('not an image')
    const imageIntent = await makeIntent('photo', 'image/jpeg', corrupt.length)
    const imageId = imageIntent.json().assetId as string
    expect((await app.inject({ method: 'PUT', url: `/v1/assets/${imageId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: corrupt })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: `/v1/assets/${imageId}/complete`, headers: { cookie } })).statusCode).toBe(422)
    expect(await readdir(assetRoot!)).toEqual([`${audioId}.wav`])
    expect((await makeIntent('deceased_audio', 'audio/wav', 30 * 1024 * 1024 + 1)).statusCode).toBe(415)
    expect((await makeIntent('photo', 'image/tiff', 100)).statusCode).toBe(415)
    for (let index = 0; index < 8; index++) expect((await makeIntent('deceased_audio', 'audio/wav', 30 * 1024 * 1024)).statusCode).toBe(201)
    expect((await makeIntent('deceased_audio', 'audio/wav', 30 * 1024 * 1024)).statusCode).toBe(409)
  })
})
