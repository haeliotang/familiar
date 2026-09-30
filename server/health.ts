import type { FastifyInstance } from 'fastify'
import type pg from 'pg'

export function registerHealthRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/health/live', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { status: 'alive' }
  })

  app.get('/health/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      // Resolve required relations and columns without reading private rows.
      await pool.query(`SELECT s.token_hash,p.owner_id,e.source_asset_id,a.review_state,
        ep.manifest,ep.retained_voice_base64,t.model_id,f.experience,d.status,j.requested_revision,j.attempt_metrics,o.review
        FROM sessions s,persons p,evidence e,source_assets a,episodes ep,
        asset_transcripts t,episode_feedback f,deletion_jobs d,preparation_jobs j,asset_audio_observations o LIMIT 0`)
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })
}
