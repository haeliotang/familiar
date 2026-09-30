import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { avatarAssets, candidateAvatarVersions } from '../src/avatar-catalog'
import { voicePackage, voiceVersionForAvatar } from '../src/voice-catalog'
import { phrasePacks } from '../server/phrase-catalog'

const run = promisify(execFile)
const checks: Array<{ component: string; ok: boolean; issue?: string }> = []
async function check(component: string, operation: () => Promise<void>) {
  try { await operation(); checks.push({ component, ok: true }) }
  catch (error) { checks.push({ component, ok: false, issue: error instanceof Error && error.message === 'hash_mismatch' ? 'hash_mismatch' : 'missing_or_unusable' }) }
}
async function fingerprint(path: string, expected: string) {
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('hash_mismatch')
}

for (const tool of ['ffmpeg', 'ffprobe', 'heif-convert']) {
  await check(tool, async () => { await run(tool, [tool === 'heif-convert' ? '--version' : '-version'], { timeout: 5000, maxBuffer: 1024 * 1024 }) })
}
for (const version of candidateAvatarVersions) {
  const assets = avatarAssets(version)
  for (const key of ['head', 'body', 'animations', 'motion'] as const) {
    await check(`${version}:${key}`, () => fingerprint(`public${assets[key]}`, assets.hashes[key]))
  }
  const voiceVersion = voiceVersionForAvatar(version)
  for (const [cue, expected] of Object.entries(voicePackage(voiceVersion).hashes)) {
    await check(`${voiceVersion}:${cue}`, () => fingerprint(`public/assets/voices/${voiceVersion}/${cue}.wav`, expected))
  }
}
for (const [voiceVersion, pack] of Object.entries(phrasePacks)) {
  for (const [cue, hashes] of Object.entries(pack.hashes)) {
    for (const [part, expected] of hashes.entries()) await check(`${voiceVersion}:phrase:${cue}:${part}`, () => fingerprint(`public/assets/voices/${voiceVersion}/phrases-v1/${cue}-${part}.wav`, expected))
  }
}
const models = [
  ['silero-vad-v4.onnx', 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'],
  ['kokoro-int8-multi-lang-v1_1/model.int8.onnx', 'bda15858163726a492d02a9a727bc263551b86ac77f90812c4b30ff41d380e26'],
  ['sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx', 'd24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434'],
  ['sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx', 'd2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925'],
]
for (const [path, expected] of models) await check(path, () => fingerprint(`.models/${path}`, expected))
for (const path of ['voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'espeak-ng-data', 'dict']) {
  await check(`kokoro:${path}`, async () => {
    const entry = await stat(`.models/kokoro-int8-multi-lang-v1_1/${path}`)
    if (['espeak-ng-data', 'dict'].includes(path) ? !entry.isDirectory() : !entry.isFile() || entry.size === 0) throw new Error('missing_or_unusable')
  })
}
await check('whisper:tokens', async () => {
  const entry = await stat('.models/sherpa-onnx-whisper-tiny/tiny-tokens.txt')
  if (!entry.isFile() || entry.size === 0) throw new Error('missing_or_unusable')
})
const ok = checks.every(check => check.ok)
process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), ok, scope: 'local_dependencies_and_candidate_assets', checks }, null, 2)}\n`)
process.exitCode = ok ? 0 : 1
