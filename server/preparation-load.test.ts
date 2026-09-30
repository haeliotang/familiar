import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { expect, it } from 'vitest'
import { createApp } from './index'
import { localPool } from './local-pool'
import { processPreparationJobs } from './preparations'

async function burst(pool: pg.Pool, backend: string, validCount: number) {
  const app = createApp(pool)
  try {
    await app.ready()
    const users = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
      if (index < validCount) await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成并发测试：回头等我' } })
      return { cookie, personId, index }
    }))
    const started = performance.now()
    const requests = users.map(user => ({ method: 'POST' as const, url: `/v1/persons/${user.personId}/preparations`, headers: { cookie: user.cookie, 'idempotency-key': `load-burst-${user.index}` } }))
    const queued = await Promise.all(requests.map(async request => {
      const pair = await Promise.all([app.inject(request), app.inject(request)])
      expect(pair.map(reply => reply.statusCode)).toEqual([202, 202])
      expect(pair[0].json().preparationId).toBe(pair[1].json().preparationId)
      return pair[0].json()
    }))
    expect((await pool.query('SELECT count(*)::integer AS count FROM preparation_jobs')).rows[0].count).toBe(20)
    const elapsed: number[] = []
    const completed = new Set<number>()
    for (let round = 0; round < 4 && completed.size < 20; round++) {
      await Promise.all(Array.from({ length: 4 }, () => processPreparationJobs(pool)))
      for (const [index, job] of queued.entries()) {
        const status = (await app.inject({ url: job.statusUrl, headers: { cookie: users[index].cookie } })).json()
        if (status.status === 'queued') continue
        expect(status.status).toBe(index < validCount ? 'completed' : 'failed')
        expect(status.errorCode).toBe(index < validCount ? null : 'no_usable_evidence')
        expect(status.attempts).toBe(1)
        expect(status.attemptMetrics).toHaveLength(1)
        expect(status.attemptMetrics[0].jobAgeAtClaimMs).toBeGreaterThanOrEqual(0)
        expect(status.attemptMetrics[0].jobAgeAtFinishMs).toBeGreaterThanOrEqual(status.attemptMetrics[0].jobAgeAtClaimMs)
        if (!completed.has(index)) { elapsed.push(Math.round(performance.now() - started)); completed.add(index) }
        expect((await app.inject({ url: job.statusUrl, headers: { cookie: users[(index + 1) % 20].cookie } })).statusCode).toBe(404)
        expect((await app.inject(requests[index])).json().preparationId).toBe(job.preparationId)
      }
    }
    expect(completed.size).toBe(20)
    expect((await pool.query('SELECT count(*)::integer AS count FROM episodes')).rows[0].count).toBe(validCount)
    expect((await pool.query('SELECT count(*)::integer AS count FROM preparation_jobs')).rows[0].count).toBe(20)
    await processPreparationJobs(pool)
    expect((await pool.query('SELECT count(*)::integer AS count FROM episodes')).rows[0].count).toBe(validCount)
    elapsed.sort((a, b) => a - b)
    console.log(JSON.stringify({ backend, scope: 'injected API; synthetic text; 20 clients; duplicate submission; four worker callers plus service timer; no device or audio inference', completed: validCount, failed: 20 - validCount, p50ObservedTerminalMs: elapsed[9], p95ObservedTerminalMs: elapsed[18], maxObservedTerminalMs: elapsed[19] }))
  } finally { await app.close() }
}

it.each([15, 20])('settles a twenty-client duplicate burst with %i valid inputs in the local database', async validCount => {
  const db = new PGlite()
  try { await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); await burst(localPool(db), 'PGlite', validCount) }
  finally { await db.close() }
}, 30000)

it.skipIf(!process.env.TEST_DATABASE_URL).each([15, 20])('settles a twenty-client duplicate burst with %i valid inputs and concurrent PostgreSQL workers', async validCount => {
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const schema = `load_${randomUUID().replaceAll('-', '')}`
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8, options: `-c search_path=${schema}` })
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
    await burst(pool, 'PostgreSQL', validCount)
  } finally { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end() }
}, 30000)
