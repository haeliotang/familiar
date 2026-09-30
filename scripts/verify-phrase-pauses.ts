import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { transcribeLocal } from '../server/asr'
import { spokenLine, type Cue } from '../src/encounter'

const args = process.argv.slice(2)
if (args.length > 1 || args.some(arg => arg !== '--original-boundaries')) throw new Error('unsupported_experiment_arguments')
const boundary = args.length ? 'original' : 'sentence'
const version = boundary === 'original' ? 'v2-original' : 'v1'
const sourceRoot = `artifacts/acceptance/M0/phrase-candidates-${version}`
const root = `artifacts/acceptance/M0/phrase-pause-candidates-${version}`
await mkdir(root, { recursive: true })
const original = JSON.parse(await readFile(`${sourceRoot}/results.json`, 'utf8')) as { results: Array<{ speakerId: number; cue: string; part: number; sha256: string }> }
const temporary = await mkdtemp(join(tmpdir(), 'friend-phrase-pause-check-'))
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const variants: Record<string, string> = { 點: '点', 風: '风', 試: '试', 這: '这', 應: '应', 該: '该' }
const han = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).map(character => variants[character] ?? character).join('')
const results = []
try {
  for (const speakerId of [58, 3]) for (const cue of ['wait', 'repair'] as Cue[]) {
    const parts: Array<{ samples: Float32Array; sampleRate: number }> = []
    const sourceHashes = []
    for (const part of [0, 1]) {
      const path = `${sourceRoot}/speaker-${speakerId}-${cue}-${part}.wav`
      const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
      if (sha256 !== original.results.find(item => item.speakerId === speakerId && item.cue === cue && item.part === part)?.sha256) throw new Error('phrase_candidate_changed')
      parts.push(sherpa.readWave(path))
      sourceHashes.push(sha256)
    }
    if (parts[0].sampleRate !== parts[1].sampleRate) throw new Error('phrase_sample_rate_mismatch')
    for (const addedPauseSec of [.25, .65]) {
      const path = `${root}/speaker-${speakerId}-${cue}-pause-${addedPauseSec}.wav`
      try { await access(path); throw new Error(`candidate_already_exists:${path}`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const gap = Math.round(addedPauseSec * parts[0].sampleRate)
      const samples = new Float32Array(parts[0].samples.length + gap + parts[1].samples.length)
      samples.set(parts[0].samples)
      samples.set(parts[1].samples, parts[0].samples.length + gap)
      sherpa.writeWave(path, { samples, sampleRate: parts[0].sampleRate })
      const normalized = join(temporary, 'normalized.wav')
      await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', normalized], { timeout: 10000 })
      const recognized = await transcribeLocal(normalized)
      results.push({ speakerId, cue, addedPauseSec, sourceHashes, expectedText: spokenLine(cue), recognizedText: recognized.text, matchesHanWithListedVariants: han(spokenLine(cue)) === han(recognized.text), durationSec: samples.length / parts[0].sampleRate, path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
    }
  }
  const passed = results.every(item => item.matchesHanWithListedVariants && item.durationSec < 12)
  const report = { checkedAt: new Date().toISOString(), status: passed ? 'synthetic_joined_phrase_asr_gate_passed' : 'synthetic_joined_phrase_asr_gate_failed', boundary, hanVariantMap: variants, results, limitations: ['ASR matching does not prove spoken text correctness', 'Added silence is not total acoustic pause duration', 'No source pause transfer or human listening result', 'Not a published phrase version'] }
  await writeFile(`${root}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = passed ? 0 : 1
} finally { await rm(temporary, { recursive: true, force: true }) }
