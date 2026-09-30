import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { cleanupDeletedAssets } from './assets'

export async function processDeletionJobs(pool: pg.Pool, assetRoot?: string) {
  const jobs = await pool.query<{ id: string; person_id: string }>("SELECT id,person_id FROM deletion_jobs WHERE status='pending' ORDER BY created_at")
  for (const job of jobs.rows) {
    await pool.query('UPDATE deletion_jobs SET attempts=attempts+1 WHERE id=$1', [job.id])
    try {
      if (assetRoot) await cleanupDeletedAssets(pool, assetRoot, job.person_id)
      const remaining = await pool.query('SELECT id FROM source_assets WHERE person_id=$1 LIMIT 1', [job.person_id])
      if (remaining.rowCount) {
        await pool.query("UPDATE deletion_jobs SET last_error='storage_cleanup_pending' WHERE id=$1", [job.id])
      } else {
        await pool.query("UPDATE deletion_jobs SET status='completed',last_error=NULL,completed_at=now() WHERE id=$1", [job.id])
      }
    } catch {
      await pool.query("UPDATE deletion_jobs SET last_error='storage_cleanup_failed' WHERE id=$1", [job.id])
    }
  }
}

export function registerDeletionRoutes(app: FastifyInstance, pool: pg.Pool, owner: (cookie: string | undefined) => Promise<string | null>) {
  app.get('/v1/deletions', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const result = await pool.query('SELECT id,status FROM deletion_jobs WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId])
    reply.header('Cache-Control', 'private, no-store')
    return { deletions: result.rows.map(row => ({ deletionJobId: row.id, status: row.status })) }
  })
  app.get('/v1/deletions/:id', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const result = await pool.query('SELECT id,status FROM deletion_jobs WHERE id=$1 AND owner_id=$2', [params.data.id, ownerId])
    if (!result.rowCount) return reply.code(404).send({ code: 'not_found' })
    reply.header('Cache-Control', 'private, no-store')
    return { deletionJobId: result.rows[0].id, status: result.rows[0].status, retryable: result.rows[0].status === 'pending' }
  })
}
