import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { generateVoicePhrase, voicePhrases } from '../server/tts'
import { transcribeLocal } from '../server/asr'
import type { Cue } from '../src/encounter'

const args = process.argv.slice(2)
if (args.length > 1 || args.some(arg => arg !== '--original-boundaries')) throw new Error('unsupported_experiment_arguments')
const boundary = args.length ? 'original' : 'sentence'
const root = `artifacts/acceptance/M0/phrase-candidates-${boundary === 'original' ? 'v2-original' : 'v1'}`
await mkdir(root, { recursive: true })
const temporary = await mkdtemp(join(tmpdir(), 'friend-phrase-check-'))
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const variants: Record<string, string> = { 點: '点', 風: '风', 試: '试', 這: '这', 應: '应', 該: '该' }
const han = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).map(character => variants[character] ?? character).join('')
const results = []
try {
  for (const speakerId of [58, 3]) for (const cue of ['general', 'wait', 'repair'] as Cue[]) {
    const phrases = voicePhrases(cue, boundary)
    for (let part = 0; part < phrases.length; part++) {
      const path = `${root}/speaker-${speakerId}-${cue}-${part}.wav`
      try { await access(path); throw new Error(`candidate_already_exists:${path}`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const generated = await generateVoicePhrase(cue, part, speakerId, boundary)
      sherpa.writeWave(path, generated)
      const normalized = join(temporary, 'normalized.wav')
      await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', normalized], { timeout: 10000 })
      const recognized = await transcribeLocal(normalized)
      results.push({ speakerId, cue, part, expectedText: phrases[part], recognizedText: recognized.text, matchesHanWithListedVariants: han(phrases[part]) === han(recognized.text), durationSec: generated.samples.length / generated.sampleRate, path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
    }
  }
  const passed = results.every(item => item.matchesHanWithListedVariants && item.durationSec > 0 && item.durationSec < 6)
  const report = { checkedAt: new Date().toISOString(), status: passed ? 'synthetic_phrase_asr_gate_passed' : 'synthetic_phrase_asr_gate_failed', boundary, model: 'kokoro-int8-multi-lang-v1_1', speed: 1, silenceScale: .2, hanVariantMap: variants, results, limitations: ['ASR matching does not prove spoken text correctness', 'No human listening or familiarity result', 'No pause insertion tested', 'Not a published phrase version'] }
  await writeFile(`${root}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = passed ? 0 : 1
} finally { await rm(temporary, { recursive: true, force: true }) }
