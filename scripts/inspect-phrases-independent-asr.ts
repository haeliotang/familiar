import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { spokenLine, type Cue } from '../src/encounter'
import { voicePackage } from '../src/voice-catalog'
import { renderCadenceVoice } from '../server/cadence-voice'
import { manifestContent } from '../src/manifest'

const modelId = 'sherpa-onnx-paraformer-zh-2023-09-14'
const modelRoot = join(process.cwd(), '.models', modelId)
const modelHashes = { 'model.int8.onnx': 'f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945', 'tokens.txt': '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6' }
for (const [file, sha256] of Object.entries(modelHashes)) if (createHash('sha256').update(await readFile(join(modelRoot, file))).digest('hex') !== sha256) throw new Error('diagnostic_model_changed')
const args = process.argv.slice(2)
if (args.length > 1 || args.some(arg => arg !== '--rendered-pauses')) throw new Error('unsupported_experiment_arguments')
const renderedPauses = args.length > 0
const root = `artifacts/acceptance/M0/${renderedPauses ? 'rendered-pause-asr-v1' : 'independent-phrase-asr-v1'}`
await mkdir(root, { recursive: true })
const resultPath = `${root}/results.json`
try { await access(resultPath); throw new Error('diagnostic_report_already_exists') }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const recognizer = await sherpa.OfflineRecognizer.createAsync({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { paraformer: { model: join(modelRoot, 'model.int8.onnx') }, tokens: join(modelRoot, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: false } })
const temporary = await mkdtemp(join(tmpdir(), 'friend-independent-asr-'))
const variants: Record<string, string> = { 點: '点', 風: '风', 試: '试', 這: '这', 應: '应', 該: '该' }
const han = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).map(character => variants[character] ?? character).join('')
const results = []
const renderedPlans = []
async function inspect(path: string, expectedText: string, sha256: string, sourceReport: string | null, earlierRecognizedText: string | null) {
  if (createHash('sha256').update(await readFile(path)).digest('hex') !== sha256) throw new Error('diagnostic_audio_changed')
  const normalized = join(temporary, 'normalized.wav')
  await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', normalized], { timeout: 10000 })
  const wave = sherpa.readWave(normalized)
  const stream = recognizer.createStream()
  stream.acceptWaveform(wave)
  const recognized = await recognizer.decodeAsync(stream)
  results.push({ path, sourceReport, sha256, expectedText, earlierRecognizedText, recognizedText: recognized.text, tokens: recognized.tokens, timestamps: recognized.timestamps, matchesHanWithListedVariants: han(expectedText) === han(recognized.text) })
}
try {
  if (renderedPauses) {
    for (const version of ['kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1']) for (const cue of ['wait', 'repair'] as Cue[]) for (const pause of [.25, .65]) for (const fast of [false, true]) {
      const observations = { normalizedAudioSha256: 'a'.repeat(64), selectedWindow: { startSec: 0, endSec: 6 }, speechActivity: { status: 'measured', speechDurationSec: 4, pauses: [{ startSec: 1, endSec: 1 + pause }] } }
      const review = { observationFingerprint: createHash('sha256').update(manifestContent(observations)).digest('hex'), normalizedAudioSha256: observations.normalizedAudioSha256, selectedWindow: observations.selectedWindow, subject: 'single_person', text: '今天的风很好。'.repeat(fast ? 10 : 1), confirmationSource: 'user' }
      const rendered = await renderCadenceVoice('synthetic-analysis-fixture', observations, review, cue, version)
      if (!rendered || !rendered.plan.pauseTransfer) throw new Error('pause_rendering_unavailable')
      const path = `${root}/${version}-${cue}-pause-${pause}-speed-${rendered.plan.speed}.wav`
      await writeFile(path, rendered.audio, { flag: 'wx' })
      await inspect(path, spokenLine(cue), rendered.plan.sha256, null, null)
      renderedPlans.push({ path, plan: rendered.plan })
    }
  } else {
  for (const directory of ['phrase-candidates-v1', 'phrase-pause-candidates-v1', 'phrase-candidates-v2-original', 'phrase-pause-candidates-v2-original']) {
    const sourceReport = `artifacts/acceptance/M0/${directory}/results.json`
    const report = JSON.parse(await readFile(sourceReport, 'utf8')) as { results: Array<{ path: string; expectedText: string; sha256: string; recognizedText: string }> }
    for (const item of report.results) await inspect(item.path, item.expectedText, item.sha256, sourceReport, item.recognizedText)
  }
  for (const version of ['kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1']) for (const cue of ['general', 'wait', 'repair'] as Cue[]) {
    await inspect(`public/assets/voices/${version}/${cue}.wav`, spokenLine(cue), voicePackage(version).hashes[cue], null, null)
  }
  }
  const matching = results.filter(item => item.matchesHanWithListedVariants).length
  const report = { checkedAt: new Date().toISOString(), status: renderedPauses ? matching === results.length ? 'synthetic_rendered_pause_asr_gate_passed' : 'synthetic_rendered_pause_asr_gate_failed' : 'independent_recognition_completed', modelId, modelRevision: 'def027084691107096b5ebba69785756d63de6c5', modelHashes, hanVariantMap: variants, results, renderedPlans, limitations: ['Independent ASR is not human listening or proof of spoken correctness', 'Earlier failed gates remain failed', 'Rendered source parameters use structured synthetic fixtures', 'No real person familiarity result'] }
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, samples: results.length, matching: results.filter(item => item.matchesHanWithListedVariants).length, resultPath }, null, 2))
  if (renderedPauses && matching !== results.length) process.exitCode = 1
} finally { await rm(temporary, { recursive: true, force: true }) }
