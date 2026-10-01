import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'
import sharp from 'sharp'
import { createApp } from '../server/index'
import { processPreparationJobs } from '../server/preparations'

// Only disposable synthetic data is created. Never point this at an existing DB.
const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'familiar-restore-'))
const container = `familiar-restore-${randomUUID().slice(0, 8)}`
const sourceRoot = join(root, 'source-assets')
const backupRoot = join(root, 'backup-assets')
const restoredRoot = join(root, 'restored-assets')
let started = false
let source: pg.Pool | undefined
let restored: pg.Pool | undefined
let app: ReturnType<typeof createApp> | undefined
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function fileHashes(directory: string) {
  return Promise.all((await readdir(directory)).sort().map(async name => [name, digest(await readFile(join(directory, name)))]))
}
try {
  await run('docker', ['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=synthetic_restore_only', '-e', 'POSTGRES_DB=familiar_source', '-p', '127.0.0.1:55438:5432', 'postgres:17'])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await run('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'familiar_source']); ready = true; break }
    catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  assert(ready, 'test_database_not_ready')
  source = new pg.Pool({ connectionString: 'postgres://postgres:synthetic_restore_only@127.0.0.1:55438/familiar_source' })
  await source.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'))
  await mkdir(sourceRoot)
  app = createApp(source, sourceRoot)
  const cookie = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
  const headers = { cookie }
  const personId = (await app.inject({ method: 'POST', url: '/v1/persons', headers, payload: {} })).json().personId
  await app.inject({ method: 'POST', url: `/v1/persons/${personId}/memories`, headers, payload: { text: '合成恢复演练：回头等我' } })
  const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#74816a' } }).jpeg().toBuffer()
  const intent = (await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers, payload: { personId, kind: 'photo', mediaType: 'image/jpeg', sizeBytes: photo.length } })).json()
  assert.equal((await app.inject({ method: 'PUT', url: intent.uploadUrl, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: photo })).statusCode, 202)
  assert.equal((await app.inject({ method: 'POST', url: `/v1/assets/${intent.assetId}/complete`, headers })).statusCode, 200)
  const request = { method: 'POST' as const, url: `/v1/persons/${personId}/preparations`, headers: { cookie, 'idempotency-key': 'synthetic-restore-preparation' } }
  const queued = (await app.inject(request)).json()
  await processPreparationJobs(source, undefined, sourceRoot)
  const job = (await app.inject({ url: queued.statusUrl, headers })).json()
  assert.equal(job.status, 'completed')
  const saved = (await app.inject({ url: `/v1/episodes/${job.episodeId}`, headers })).json().manifest
  const voice = await app.inject({ url: `/v1/episodes/${job.episodeId}/voice`, headers })
  assert.equal(voice.statusCode, 200)
  const reference = join(root, 'synthetic-reference.wav')
  const phrase = join(root, 'synthetic-phrase.wav')
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', join(process.cwd(), 'public/assets/voices/kokoro-zh-zm009-v1/wait.wav'), '-af', 'atempo=0.8,apad=pad_dur=0.7', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', phrase], { timeout: 10000 })
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-stream_loop', '2', '-i', phrase, '-c:a', 'pcm_s16le', reference], { timeout: 10000 })
  const audio = await readFile(reference)
  const audioIntent = await app.inject({ method: 'POST', url: '/v1/assets/upload-intents', headers, payload: { personId, kind: 'deceased_audio', mediaType: 'audio/wav', sizeBytes: audio.length } })
  assert.equal(audioIntent.statusCode, 201)
  const audioId = audioIntent.json().assetId
  assert.equal((await app.inject({ method: 'PUT', url: `/v1/assets/${audioId}/content`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: audio })).statusCode, 202)
  assert.equal((await app.inject({ method: 'POST', url: `/v1/assets/${audioId}/complete`, headers })).statusCode, 200)
  const measured = await app.inject({ method: 'POST', url: `/v1/assets/${audioId}/audio-observations`, headers })
  assert.equal(measured.statusCode, 200)
  const observations = measured.json().observations
  const reviewPath = `/v1/assets/${audioId}/audio-review`
  const observationFingerprint = (await app.inject({ url: reviewPath, headers })).json().observationFingerprint
  assert.equal((await app.inject({ method: 'POST', url: reviewPath, headers, payload: { observationFingerprint, normalizedAudioSha256: observations.normalizedAudioSha256, ...observations.selectedWindow, subject: 'single_person', text: '不用急，我走慢一点。'.repeat(3) } })).statusCode, 200)
  const cadenceRequest = { ...request, headers: { cookie, 'idempotency-key': 'synthetic-restore-cadence' } }
  const cadenceQueued = (await app.inject(cadenceRequest)).json()
  await processPreparationJobs(source, undefined, sourceRoot)
  const cadenceJob = (await app.inject({ url: cadenceQueued.statusUrl, headers })).json()
  assert.equal(cadenceJob.status, 'completed')
  const cadenceManifest = (await app.inject({ url: `/v1/episodes/${cadenceJob.episodeId}`, headers })).json().manifest
  assert.equal(cadenceManifest.audioPlan.voiceMode, 'confirmed_window_rate')
  assert.equal(cadenceManifest.audioPlan.cadence.pauseTransfer, true)
  const cadencePath = `/v1/episodes/${cadenceJob.episodeId}/voice`
  const cadenceVoice = await app.inject({ url: cadencePath, headers })
  assert.equal(cadenceVoice.statusCode, 200)
  assert.equal(digest(cadenceVoice.rawPayload), cadenceManifest.audioPlan.sha256)
  const files = await fileHashes(sourceRoot)
  assert(files.length > 0)
  await app.close(); app = undefined
  await source.end(); source = undefined
  const dump = await run('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '--no-owner', '--no-acl', 'familiar_source'], { maxBuffer: 20 * 1024 * 1024 })
  const dumpPath = join(root, 'database.sql')
  await writeFile(dumpPath, dump.stdout, { mode: 0o600 })
  await cp(sourceRoot, backupRoot, { recursive: true })
  await run('docker', ['exec', container, 'createdb', '-U', 'postgres', 'familiar_restored'])
  await run('docker', ['cp', dumpPath, `${container}:/tmp/familiar-restore.sql`])
  await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'familiar_restored', '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/familiar-restore.sql'])
  await cp(backupRoot, restoredRoot, { recursive: true })
  assert.deepEqual(await fileHashes(restoredRoot), files)
  restored = new pg.Pool({ connectionString: 'postgres://postgres:synthetic_restore_only@127.0.0.1:55438/familiar_restored' })
  app = createApp(restored, restoredRoot)
  assert.equal((await app.inject({ url: '/health/ready' })).statusCode, 200)
  assert.deepEqual((await app.inject({ url: `/v1/episodes/${job.episodeId}`, headers })).json().manifest, saved)
  const replay = await app.inject({ url: `/v1/episodes/${job.episodeId}/voice`, headers })
  assert.equal(replay.statusCode, 200)
  assert.equal(digest(replay.rawPayload), digest(voice.rawPayload))
  assert.equal((await app.inject(request)).json().preparationId, queued.preparationId)
  assert.equal((await restored.query('SELECT count(*)::integer AS count FROM episodes')).rows[0].count, 2)
  assert.deepEqual((await app.inject({ url: `/v1/episodes/${cadenceJob.episodeId}`, headers })).json().manifest, cadenceManifest)
  assert.equal((await app.inject(cadenceRequest)).json().preparationId, cadenceQueued.preparationId)
  const cadenceReplay = await app.inject({ url: cadencePath, headers })
  assert.equal(cadenceReplay.statusCode, 200)
  assert.equal(digest(cadenceReplay.rawPayload), digest(cadenceVoice.rawPayload))
  const foreign = (await app.inject({ method: 'POST', url: '/v1/sessions/anonymous' })).headers['set-cookie'] as string
  assert.equal((await app.inject({ url: `/v1/episodes/${job.episodeId}`, headers: { cookie: foreign } })).statusCode, 404)
  assert.equal((await app.inject({ url: cadencePath, headers: { cookie: foreign } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/persons/${personId}`, headers })).statusCode, 202)
  assert.equal((await app.inject({ url: `/v1/episodes/${job.episodeId}`, headers })).statusCode, 404)
  assert.equal((await app.inject({ url: `/v1/episodes/${job.episodeId}/voice`, headers })).statusCode, 404)
  assert.equal((await app.inject({ url: cadencePath, headers })).statusCode, 404)
  assert.equal((await restored.query('SELECT retained_voice_base64 FROM episodes WHERE id=$1', [cadenceJob.episodeId])).rows[0]?.retained_voice_base64 ?? null, null)
  assert.deepEqual(await readdir(restoredRoot), [])
  console.log(JSON.stringify({ status: 'synthetic_restore_passed', database: 'PostgreSQL 17 pg_dump/psql', privateFiles: files.length, checks: ['ready', 'file_hashes', 'manifest', 'voice_bytes', 'retained_cadence_bytes', 'idempotency', 'isolation', 'deletion'] }))
} finally {
  await app?.close()
  await source?.end()
  await restored?.end()
  if (started) await run('docker', ['stop', container])
  await rm(root, { recursive: true, force: true })
}
