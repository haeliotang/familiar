import Fastify from 'fastify'
import type pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { registerHealthRoutes } from './health'
import { localPool } from './local-pool'

describe('deployment health checks', () => {
  it('keeps liveness independent of database failure and hides internal errors', async () => {
    const app = Fastify()
    registerHealthRoutes(app, { query: async () => { throw new Error('private-connection-string') } } as unknown as pg.Pool)
    try {
      const live = await app.inject('/health/live')
      expect(live.statusCode).toBe(200)
      expect(live.json()).toEqual({ status: 'alive' })
      const ready = await app.inject('/health/ready')
      expect(ready.statusCode).toBe(503)
      expect(ready.json()).toEqual({ status: 'not_ready' })
      expect(ready.headers['cache-control']).toBe('no-store')
    } finally { await app.close() }
  })

  it('rejects an unmigrated database and becomes ready after migration', async () => {
    const db = new PGlite()
    const app = Fastify()
    registerHealthRoutes(app, localPool(db))
    try {
      expect((await app.inject('/health/ready')).statusCode).toBe(503)
      await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
      const ready = await app.inject('/health/ready')
      expect(ready.statusCode).toBe(200)
      expect(ready.json()).toEqual({ status: 'ready' })
      await db.exec('ALTER TABLE source_assets DROP COLUMN review_state')
      expect((await app.inject('/health/ready')).statusCode).toBe(503)
    } finally { await app.close(); await db.close() }
  })
})
