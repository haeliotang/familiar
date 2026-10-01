import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import type pg from 'pg'
import { describe, expect, it } from 'vitest'
import { createApp } from './index'
import { localPool } from './local-pool'
import { processPreparationJobs } from './preparations'
import { EpisodeAssetsUnavailable } from './validate-episode-assets'
import { preparationReport, preparationReportQuery, type PreparationReportRow } from './preparation-report'

async function setup() {
  const db = new PGlite()
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const pool = localPool(db)
  const app = createApp(pool)
  const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
  const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers: { cookie }, payload: {} })).json().personId
  const queue = (key = 'preparation-test-key') => app.inject({ method: 'POST', url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': key } })
  const memory = () => app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers: { cookie }, payload: { text: '合成任务：回头等我' } })
  return { db, pool, app, cookie, personId, queue, memory }
}

describe('persisted preparation jobs', () => {
  it('records persisted queue age across restart separately from worker execution', async () => {
    const { db, pool, app, queue, memory } = await setup()
    try {
      await memory()
      const request = await queue()
      await app.close()
      await pool.query("UPDATE preparation_jobs SET created_at=clock_timestamp()-interval '5 seconds' WHERE id=$1", [request.json().preparationId])
      await processPreparationJobs(pool)
      const job = (await pool.query('SELECT attempt_metrics FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0]
      expect(job.attempt_metrics[0].jobAgeAtClaimMs).toBeGreaterThanOrEqual(5000)
      expect(job.attempt_metrics[0].jobAgeAtFinishMs).toBeGreaterThanOrEqual(job.attempt_metrics[0].jobAgeAtClaimMs)
      expect(job.attempt_metrics[0].durationMs).toBeLessThan(job.attempt_metrics[0].jobAgeAtFinishMs)
      const report = preparationReport((await pool.query<PreparationReportRow>(preparationReportQuery)).rows)
      expect(report).toMatchObject({ jobs: 1, published: 1, currentlyPlayable: 1, recordedAttempts: 1, personalization: { memory_based: 1 }, quality: { local_placeholder: 1 }, providerCostUsd: 0, computeCostUsd: null })
      expect(report.jobAgeAtFinishMs.p95).toBeGreaterThanOrEqual(5000)
    } finally { await app.close(); await db.close() }
  })

  it('deduplicates submission, restores queued work on restart and isolates status', async () => {
    const { db, pool, app, cookie, personId, queue, memory } = await setup()
    let restarted: ReturnType<typeof createApp> | undefined
    try {
      await memory()
      const [first, second] = await Promise.all([queue(), queue()])
      expect(first.statusCode).toBe(202)
      expect(second.json().preparationId).toBe(first.json().preparationId)
      await app.close()
      restarted = createApp(pool)
      const status = await restarted.inject({ url: first.json().statusUrl, headers: { cookie } })
      expect(status.json()).toMatchObject({ status: 'completed', attempts: 1, qualityLevel: 'local_placeholder', providerCostUsd: 0, computeCostUsd: null })
      expect(status.json().durationMs).toBeGreaterThanOrEqual(0)
      expect(status.json().attemptMetrics).toHaveLength(1)
      expect(status.json().attemptMetrics[0].stages.map((item: { stage: string }) => item.stage)).toEqual(['source_validation', 'composing', 'asset_validation', 'publishing'])
      expect(status.json().attemptMetrics[0].stages.every((item: { durationMs: number }) => Number.isInteger(item.durationMs) && item.durationMs >= 0)).toBe(true)
      const episodeId = status.json().episodeId
      expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([{ id: episodeId }])
      await processPreparationJobs(pool)
      expect((await restarted.inject({ url: first.json().statusUrl, headers: { cookie } })).json().episodeId).toBe(episodeId)
      const foreign = (await restarted.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      expect((await restarted.inject({ url: first.json().statusUrl, headers: { cookie: foreign } })).statusCode).toBe(404)
      await restarted.inject({ method: 'POST', url: `/v1/episodes/${episodeId}/hide`, headers: { cookie } })
      expect((await restarted.inject({ url: first.json().statusUrl, headers: { cookie } })).json()).toMatchObject({ status: 'cancelled', episodeId: null })
    } finally { await restarted?.close(); await app.close(); await db.close() }
  })

  it('recovers queued work without client metadata while rejecting foreign and deleted persons', async () => {
    const { db, pool, app, cookie, personId, queue, memory } = await setup()
    try {
      await memory()
      const queued = await queue()
      const path = `/v1/persons/${personId}/preparations`
      const listing = await app.inject({ url: path, headers: { cookie } })
      expect(listing.statusCode).toBe(200)
      expect(listing.json().preparations).toHaveLength(1)
      expect(listing.json().preparations[0].preparationId).toBe(queued.json().preparationId)
      expect(listing.headers['cache-control']).toBe('private, no-store')
      const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
      expect((await app.inject({ url: path, headers: { cookie: foreign } })).statusCode).toBe(404)
      await processPreparationJobs(pool)
      expect((await app.inject({ url: path, headers: { cookie } })).json().preparations).toEqual([])
      await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      expect((await app.inject({ url: path, headers: { cookie } })).statusCode).toBe(404)
    } finally { await app.close(); await db.close() }
  })

  it('refuses publication when the selected assets fail validation', async () => {
    const { db, pool, app, queue, memory, personId } = await setup()
    try {
      await memory()
      const queued = await queue()
      await processPreparationJobs(pool, async () => { throw new EpisodeAssetsUnavailable('synthetic_missing_asset') })
      expect((await db.query('SELECT status,error_code FROM preparation_jobs WHERE id=$1', [queued.json().preparationId])).rows[0]).toEqual({ status: 'failed', error_code: 'candidate_assets_unavailable' })
      expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([])
    } finally { await app.close(); await db.close() }
  })

  it.each(['empty', 'changed', 'deleted'])('gives %s input a terminal state without publishing', async scenario => {
    const { db, pool, app, cookie, personId, queue, memory } = await setup()
    try {
      if (scenario !== 'empty') await memory()
      const request = await queue()
      if (scenario === 'changed') await memory()
      if (scenario === 'deleted') await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers: { cookie } })
      await processPreparationJobs(pool)
      const job = (await db.query('SELECT status,error_code,episode_id FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0]
      expect(job).toMatchObject({ status: scenario === 'deleted' ? 'cancelled' : 'failed', error_code: scenario === 'empty' ? 'no_usable_evidence' : scenario === 'changed' ? 'source_changed' : null, episode_id: null })
      expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([])
      if (scenario === 'deleted') expect((await app.inject({ url: request.json().statusUrl, headers: { cookie } })).statusCode).toBe(404)
    } finally { await app.close(); await db.close() }
  })

  it.each([false, true])('handles publication failure with exhausted retries=%s', async exhausted => {
    const { db, pool, app, personId, queue, memory } = await setup()
    try {
      await memory()
      const request = await queue()
      const failing = {
        query: pool.query.bind(pool),
        connect: async () => {
          const client = await pool.connect()
          return { release: () => client.release(), query: (text: string, values?: unknown[]) => {
            if (text.startsWith('INSERT INTO episodes')) throw new Error('synthetic_worker_failure')
            return client.query(text, values)
          } }
        },
      } as unknown as pg.Pool
      await expect(processPreparationJobs(failing)).rejects.toThrow('synthetic_worker_failure')
      expect((await db.query<{ status: string }>('SELECT status FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0].status).toBe('queued')
      expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([])
      if (exhausted) {
        await expect(processPreparationJobs(failing)).rejects.toThrow('synthetic_worker_failure')
        expect((await db.query('SELECT status,attempts FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0]).toEqual({ status: 'failed', attempts: 2 })
        expect((await db.query<{ attempt_metrics: Array<{ status: string }> }>('SELECT attempt_metrics FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0].attempt_metrics.map(item => item.status)).toEqual(['error', 'error'])
        await processPreparationJobs(pool)
        expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toEqual([])
        return
      }
      await processPreparationJobs(pool)
      const metrics = (await db.query<{ attempt_metrics: Array<{ status: string }> }>('SELECT attempt_metrics FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0].attempt_metrics
      expect(metrics.map(item => item.status)).toEqual(['error', 'completed'])
      expect((await db.query<{ status: string }>('SELECT status FROM preparation_jobs WHERE id=$1', [request.json().preparationId])).rows[0].status).toBe('completed')
      expect((await db.query('SELECT id FROM episodes WHERE person_id=$1', [personId])).rows).toHaveLength(1)
    } finally { await app.close(); await db.close() }
  })
})
