import { join } from 'node:path'
import { observeAudioFile } from './audio-observations'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { cueFromMemory, type Cue } from '../src/encounter'
import { episodeManifest, withCadenceVoice, plannerVersion, type AudioObservationRef } from './episode-manifest'
import { renderCadenceVoice } from './cadence-voice'
import { EpisodeAssetsUnavailable, validateEpisodeAssets } from './validate-episode-assets'

// One transaction publishes the prototype and completes its job. A crash rolls
// both back, leaving the persisted queued request available to another worker.
export async function processPreparationJobs(pool: pg.Pool, validate = validateEpisodeAssets, assetRoot?: string, analyze = observeAudioFile) {
  const candidates = await pool.query<{ id: string; person_id: string }>("SELECT id,person_id FROM preparation_jobs WHERE status='queued' ORDER BY created_at LIMIT 10")
  for (const candidate of candidates.rows) {
    const client = await pool.connect()
    const started = performance.now()
    const stages: Array<{ stage: string; durationMs: number }> = []
    let stage = 'source_validation'
    let stageStarted = started
    const finishStage = () => { stages.push({ stage, durationMs: Math.round(performance.now() - stageStarted) }) }
    const nextStage = (name: string) => { finishStage(); stage = name; stageStarted = performance.now() }
    let jobAgeAtClaimMs: number | null = null
    const metrics = async (status: string) => {
      const age = await client.query('SELECT round(GREATEST(0,extract(epoch from (clock_timestamp()-created_at))*1000))::double precision AS age_ms FROM preparation_jobs WHERE id=$1', [candidate.id])
      return JSON.stringify([{ status, plannerVersion, durationMs: Math.round(performance.now() - started), jobAgeAtClaimMs, jobAgeAtFinishMs: age.rows[0]?.age_ms ?? null, stages, providerCostUsd: 0, computeCostUsd: null }])
    }
    try {
      await client.query('BEGIN')
      // Match deletion lock order: person first, job second.
      const person = await client.query('SELECT revision,deleted_at FROM persons WHERE id=$1 FOR UPDATE', [candidate.person_id])
      const job = await client.query("SELECT owner_id,requested_revision,round(GREATEST(0,extract(epoch from (clock_timestamp()-created_at))*1000))::double precision AS age_ms FROM preparation_jobs WHERE id=$1 AND status='queued' FOR UPDATE SKIP LOCKED", [candidate.id])
      if (!job.rowCount) { await client.query('ROLLBACK'); continue }
      jobAgeAtClaimMs = job.rows[0].age_ms
      await client.query('UPDATE preparation_jobs SET planner_version=$2 WHERE id=$1', [candidate.id, plannerVersion])
      const fail = async (status: string, code: string | null) => {
        finishStage()
        await client.query('UPDATE preparation_jobs SET status=$2,error_code=$3,attempts=attempts+1,duration_ms=$4,attempt_metrics=attempt_metrics || $5::jsonb,completed_at=now() WHERE id=$1', [candidate.id, status, code, Math.round(performance.now() - started), await metrics(status)])
        await client.query('COMMIT')
      }
      if (!person.rowCount || person.rows[0].deleted_at) { await fail('cancelled', null); continue }
      if (person.rows[0].revision !== job.rows[0].requested_revision) { await fail('failed', 'source_changed'); continue }
      const evidence = await client.query<{ id: string; cue: Cue; text: string }>('SELECT id,cue,text FROM evidence WHERE person_id=$1 AND usable=true ORDER BY created_at DESC LIMIT 1', [candidate.person_id])
      const assets = evidence.rowCount ? null : await client.query("SELECT id FROM source_assets WHERE person_id=$1 AND state='ready' LIMIT 1", [candidate.person_id])
      if (!evidence.rowCount && !assets?.rowCount) { await fail('failed', 'no_usable_evidence'); continue }
      let audioObservation: AudioObservationRef | undefined
      let cadenceInput: { sourceAssetId: string; observations: Record<string, unknown>; review: unknown } | undefined
      if (assetRoot) {
        const audio = await client.query<{ id: string }>("SELECT id FROM source_assets WHERE person_id=$1 AND owner_id=$2 AND kind='deceased_audio' AND speaker_role='deceased' AND state='ready' ORDER BY created_at DESC,id DESC LIMIT 1", [candidate.person_id, job.rows[0].owner_id])
        if (audio.rowCount) {
          nextStage('audio_signal_observation')
          const sourceAssetId = audio.rows[0].id
          audioObservation = { sourceAssetId, analyzerVersion: 'signal-window-v1', status: 'unavailable', subjectAttribution: 'unverified' }
          let observations: Awaited<ReturnType<typeof observeAudioFile>> | undefined
          try { observations = await analyze(join(assetRoot, `${sourceAssetId}.wav`)) }
          catch { /* Analysis failure keeps the standard voice path explicit. */ }
          if (observations) {
            const saved = await client.query('INSERT INTO asset_audio_observations(asset_id,observations) VALUES($1,$2) ON CONFLICT(asset_id) DO UPDATE SET observations=excluded.observations RETURNING review', [sourceAssetId, observations])
            if (saved.rows[0]?.review) cadenceInput = { sourceAssetId, observations, review: saved.rows[0].review }
            audioObservation = { sourceAssetId, analyzerVersion: 'signal-window-v1', status: 'measured', subjectAttribution: 'unverified', normalizedAudioSha256: observations.normalizedAudioSha256, selectedWindow: observations.selectedWindow, signalStatus: observations.signalStatus }
          }
        }
      }
      nextStage('composing')
      const previous = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM episodes WHERE person_id=$1', [candidate.person_id])
      const episodeId = randomUUID()
      const evidenceId = evidence.rows[0]?.id || null
      let manifest = episodeManifest(episodeId, person.rows[0].revision, evidenceId, evidence.rowCount ? cueFromMemory(evidence.rows[0].text) : 'general', previous.rows[0].count, audioObservation)
      nextStage('asset_validation')
      try { await validate(manifest) }
      catch (error) {
        if (!(error instanceof EpisodeAssetsUnavailable)) throw error
        await fail('failed', 'candidate_assets_unavailable')
        continue
      }
      let retainedVoice: string | undefined
      if (cadenceInput) {
        nextStage('cadence_voice_rendering')
        const rendered = await renderCadenceVoice(cadenceInput.sourceAssetId, cadenceInput.observations, cadenceInput.review, manifest.cue, manifest.audioPlan.voiceVersion)
        if (rendered) {
          manifest = withCadenceVoice(manifest, rendered.plan)
          retainedVoice = rendered.audio.toString('base64')
        }
      }
      nextStage('publishing')
      await client.query("INSERT INTO episodes(id,owner_id,person_id,person_revision,evidence_id,idempotency_key,manifest,status) VALUES($1,$2,$3,$4,$5,$6,$7,'prototype')", [episodeId, job.rows[0].owner_id, candidate.person_id, person.rows[0].revision, evidenceId, `preparation:${candidate.id}`, manifest])
      if (retainedVoice) await client.query('UPDATE episodes SET retained_voice_base64=$2 WHERE id=$1', [episodeId, retainedVoice])
      finishStage()
      await client.query("UPDATE preparation_jobs SET status='completed',error_code=NULL,episode_id=$2,attempts=attempts+1,duration_ms=$3,attempt_metrics=attempt_metrics || $4::jsonb,completed_at=now() WHERE id=$1", [candidate.id, episodeId, Math.round(performance.now() - started), await metrics('completed')])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      finishStage()
      await client.query("UPDATE preparation_jobs SET planner_version=$4,attempt_metrics=attempt_metrics || $3::jsonb,attempts=attempts+1,status=CASE WHEN attempts>=1 THEN 'failed' ELSE 'queued' END,error_code='preparation_failed',duration_ms=$2,completed_at=CASE WHEN attempts>=1 THEN now() ELSE NULL END WHERE id=$1 AND status='queued'", [candidate.id, Math.round(performance.now() - started), await metrics('error'), plannerVersion])
      throw error
    } finally { client.release() }
  }
}

export function registerPreparationRoutes(app: FastifyInstance, pool: pg.Pool, owner: (cookie: string | undefined) => Promise<string | null>, assetRoot?: string) {
  let timer: ReturnType<typeof setInterval> | undefined
  let running: Promise<void> | undefined
  const process = () => running ||= processPreparationJobs(pool, validateEpisodeAssets, assetRoot).catch(error => { app.log.error(error) }).finally(() => { running = undefined })
  app.addHook('onReady', async () => { await process(); timer = setInterval(() => { void process() }, 1000); timer.unref() })
  app.addHook('preClose', async () => { clearInterval(timer); await running })

  app.post('/v1/persons/:id/preparations', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    const key = request.headers['idempotency-key']
    if (!params.success || typeof key !== 'string' || key.length < 8 || key.length > 128) return reply.code(400).send({ code: 'invalid_input' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const person = await client.query('SELECT revision FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE', [params.data.id, ownerId])
      if (!person.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ code: 'not_found' }) }
      const result = await client.query('INSERT INTO preparation_jobs(id,owner_id,person_id,requested_revision,idempotency_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,person_id,status', [randomUUID(), ownerId, params.data.id, person.rows[0].revision, key])
      await client.query('COMMIT')
      if (result.rows[0].person_id !== params.data.id) return reply.code(409).send({ code: 'idempotency_conflict' })
      return reply.code(202).send({ preparationId: result.rows[0].id, status: result.rows[0].status, statusUrl: `/v1/preparations/${result.rows[0].id}` })
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  })

  app.get('/v1/persons/:id/preparations', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const person = await pool.query('SELECT id FROM persons WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [params.data.id, ownerId])
    if (!person.rowCount) return reply.code(404).send({ code: 'not_found' })
    const jobs = await pool.query("SELECT j.id,j.created_at FROM preparation_jobs j JOIN persons p ON p.id=j.person_id WHERE j.person_id=$1 AND j.owner_id=$2 AND j.status='queued' AND p.deleted_at IS NULL ORDER BY j.created_at DESC,j.id DESC LIMIT 1", [params.data.id, ownerId])
    reply.header('Cache-Control', 'private, no-store')
    return { preparations: jobs.rows.map(row => ({ preparationId: row.id, createdAt: row.created_at })) }
  })

  app.get('/v1/preparations/:id', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const result = await pool.query("SELECT j.status,j.episode_id,j.error_code,j.attempts,j.duration_ms,j.planner_version,j.provider_cost_usd,j.attempt_metrics,ep.status AS episode_status FROM preparation_jobs j JOIN persons p ON p.id=j.person_id LEFT JOIN episodes ep ON ep.id=j.episode_id WHERE j.id=$1 AND j.owner_id=$2 AND p.deleted_at IS NULL", [params.data.id, ownerId])
    if (!result.rowCount) return reply.code(404).send({ code: 'not_found' })
    reply.header('Cache-Control', 'private, no-store')
    const row = result.rows[0]
    return { status: row.episode_status === 'revoked' ? 'cancelled' : row.status, episodeId: row.episode_status === 'revoked' ? null : row.episode_id, errorCode: row.error_code, attempts: row.attempts, durationMs: row.duration_ms, attemptMetrics: row.attempt_metrics, plannerVersion: row.planner_version, providerCostUsd: Number(row.provider_cost_usd), computeCostUsd: null, qualityLevel: 'local_placeholder' }
  })
}
