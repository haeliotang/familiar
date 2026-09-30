import { currentVoiceVersion, voicePackage } from '../src/voice-catalog'
import { recordedVoice } from './recorded-voice'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'
import { spokenLine, type Cue } from '../src/encounter'
import { phrasePacks } from './phrase-catalog'

const require = createRequire(import.meta.url)
const model = join(process.cwd(), '.models/kokoro-int8-multi-lang-v1_1')
let engine: Promise<any> | undefined

async function loadEngine() {
  await stat(join(model, 'model.int8.onnx'))
  const sherpa = require('sherpa-onnx-node')
  return sherpa.OfflineTts.createAsync({
    model: { kokoro: {
      model: join(model, 'model.int8.onnx'), voices: join(model, 'voices.bin'),
      tokens: join(model, 'tokens.txt'), dataDir: join(model, 'espeak-ng-data'),
      dictDir: join(model, 'dict'),
      lexicon: `${join(model, 'lexicon-us-en.txt')},${join(model, 'lexicon-zh.txt')}`,
    }, numThreads: 2, provider: 'cpu', debug: false }, maxNumSentences: 1,
  })
}

async function generateText(text: string, speakerId: number, speed: number) {
  if (!Number.isInteger(speakerId) || speakerId < 0 || speakerId > 102 || !Number.isFinite(speed) || speed < .8 || speed > 1.2) throw new Error('unsupported_voice_parameters')
  const sherpa = require('sherpa-onnx-node')
  engine ||= loadEngine().catch(error => { engine = undefined; throw error })
  const tts = await engine
  return await tts.generateAsync({
    text,
    generationConfig: new sherpa.GenerationConfig({ sid: speakerId, speed, silenceScale: 0.2 }),
  }) as { samples: Float32Array; sampleRate: number }
}

export function voicePhrases(cue: Cue, boundary: 'sentence' | 'original' = 'sentence') {
  if (!['wait', 'repair', 'general'].includes(cue)) throw new Error('unsupported_voice_parameters')
  if (boundary === 'original') return spokenLine(cue).match(/[^，。]+[，。]/gu) ?? []
  return spokenLine(cue).split('，').map(part => part.endsWith('。') ? part : `${part}。`)
}

export async function generateVoiceSamples(cue: Cue, speakerId = 58, speed = 1) {
  return generateText(spokenLine(cue), speakerId, speed)
}

export async function generateVoicePhrase(cue: Cue, part: number, speakerId = 58, boundary: 'sentence' | 'original' = 'sentence') {
  const phrases = voicePhrases(cue, boundary)
  if (!Number.isInteger(part) || part < 0 || part >= phrases.length) throw new Error('unsupported_voice_parameters')
  return generateText(phrases[part], speakerId, 1)
}

export async function synthesize(cue: Cue, speakerId = 58) {
  const sherpa = require('sherpa-onnx-node')
  const result = await generateVoiceSamples(cue, speakerId)
  const output = join(process.cwd(), `.models/kokoro-${speakerId === 58 ? '' : `${speakerId}-`}${cue}.wav`)
  sherpa.writeWave(output, { samples: result.samples, sampleRate: result.sampleRate })
  return readFile(output)
}

export function registerTtsRoutes(app: FastifyInstance, pool: pg.Pool, owner: (cookie: string | undefined) => Promise<string | null>, generate: (cue: Cue, version: string) => Promise<Buffer> = recordedVoice) {
  app.get('/v1/voices/demo', async (_request, reply) => {
    try {
      return reply.type('audio/wav').send(await generate('general', currentVoiceVersion))
    } catch (error) {
      app.log.error(error)
      return reply.code(503).send({ code: 'local_voice_unavailable' })
    }
  })

  app.get('/v1/episodes/:id/voice', async (request, reply) => {
    const ownerId = await owner(request.headers.cookie)
    if (!ownerId) return reply.code(401).send({ code: 'unauthorized' })
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ code: 'invalid_input' })
    const result = await pool.query<{ cue: Cue; lineText: string; voiceVersion: string; voiceId: string; sha256: string; cadence?: unknown; retainedVoice?: string }>("SELECT ep.manifest->>'cue' AS cue,ep.manifest->'audioPlan'->>'lineText' AS \"lineText\",ep.manifest->'audioPlan'->>'voiceVersion' AS \"voiceVersion\",ep.manifest->'audioPlan'->>'voiceId' AS \"voiceId\",ep.manifest->'audioPlan'->>'sha256' AS sha256,ep.manifest->'audioPlan'->'cadence' AS cadence,ep.retained_voice_base64 AS \"retainedVoice\" FROM episodes ep JOIN persons p ON p.id=ep.person_id LEFT JOIN evidence ev ON ev.id=ep.evidence_id WHERE ep.id=$1 AND ep.owner_id=$2 AND p.deleted_at IS NULL AND ep.status='prototype' AND (ev.id IS NULL OR ev.usable=true)", [params.data.id, ownerId])
    if (!result.rowCount) return reply.code(404).send({ code: 'not_found' })
    const plan = result.rows[0]
    let retained
    try { retained = voicePackage(plan.voiceVersion) } catch { return reply.code(409).send({ code: 'unsupported_voice_plan' }) }
    const cue = plan.cue
    if (!['wait', 'repair', 'general'].includes(cue) || result.rows[0].lineText !== spokenLine(cue) || plan.voiceId !== retained.voiceId) return reply.code(409).send({ code: 'unsupported_voice_plan' })
    const cadenceBase = z.object({ baselineVoiceVersion: z.literal(plan.voiceVersion), baselineSha256: z.literal(retained.hashes[cue]), sha256: z.literal(plan.sha256), speed: z.number().finite().min(.8).max(1.2), durationSec: z.number().finite().positive().max(12) })
    const pack = phrasePacks[plan.voiceVersion]
    const cadence = plan.cadence == null ? null : z.union([
      cadenceBase.extend({ method: z.literal('confirmed_window_rate_atempo_v1'), pauseTransfer: z.literal(false) }),
      cadenceBase.extend({ method: z.literal('confirmed_window_rate_phrase_pause_v1'), pauseTransfer: z.literal(true), pausePlan: z.object({ phrasePackVersion: z.string(), phraseHashes: z.array(z.string()), sourceMedianPauseSec: z.number().finite().positive(), addedPauseSec: z.number().finite().min(.25).max(.65) }).refine(value => !!pack && value.phrasePackVersion === pack.version && JSON.stringify(value.phraseHashes) === JSON.stringify(pack.hashes[cue]) && pack.hashes[cue].length === 2) }),
    ]).safeParse(plan.cadence)
    if (cadence ? !cadence.success || !plan.retainedVoice : plan.sha256 !== retained.hashes[cue]) return reply.code(409).send({ code: 'unsupported_voice_plan' })
    try {
      const audio = cadence ? Buffer.from(plan.retainedVoice!, 'base64') : await generate(cue, plan.voiceVersion)
      if (cadence && createHash('sha256').update(audio).digest('hex') !== plan.sha256) return reply.code(503).send({ code: 'local_voice_unavailable' })
      const available = await pool.query("SELECT ep.id FROM episodes ep JOIN persons p ON p.id=ep.person_id LEFT JOIN evidence ev ON ev.id=ep.evidence_id WHERE ep.id=$1 AND ep.owner_id=$2 AND p.deleted_at IS NULL AND ep.status='prototype' AND (ev.id IS NULL OR ev.usable=true)", [params.data.id, ownerId])
      if (!available.rowCount) return reply.code(404).send({ code: 'not_found' })
      reply.header('Cache-Control', 'private, no-store')
      return reply.type('audio/wav').send(audio)
    } catch (error) {
      app.log.error(error)
      return reply.code(503).send({ code: 'local_voice_unavailable' })
    }
  })
}
