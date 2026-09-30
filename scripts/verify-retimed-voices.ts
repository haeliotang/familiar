import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { recordedVoice } from '../server/recorded-voice'
import { retimeVoice } from '../server/retime-voice'
import { transcribeLocal } from '../server/asr'

const run = promisify(execFile)
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const root = await mkdtemp(join(tmpdir(), 'friend-retimed-review-'))
const directory = 'artifacts/acceptance/M0/retimed-candidates-v1'
await mkdir(directory, { recursive: true })
const results = []
try {
  for (const voiceVersion of ['kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1']) {
    const source = await recordedVoice('wait', voiceVersion)
    let baselineDurationSec = 0
    let baselineText = ''
    for (const speed of [1, .8, 1.2]) {
      const audio = await retimeVoice(source, speed)
      const path = `${directory}/${voiceVersion}-speed-${speed}.wav`
      await writeFile(path, audio)
      const wave = sherpa.readWave(path)
      const durationSec = wave.samples.length / wave.sampleRate
      const normalized = join(root, `${voiceVersion}-${speed}.wav`)
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', normalized], { timeout: 10000 })
      const transcript = await transcribeLocal(normalized)
      if (speed === 1) { baselineDurationSec = durationSec; baselineText = transcript.text }
      const han = (text: string) => text.match(/\p{Script=Han}/gu)?.join('') ?? ''
      results.push({ voiceVersion, speed, path, sourceSha256: createHash('sha256').update(source).digest('hex'), sha256: createHash('sha256').update(audio).digest('hex'), durationSec, expectedDurationSec: baselineDurationSec / speed, durationWithinTolerance: Math.abs(durationSec - baselineDurationSec / speed) < .12, text: transcript.text, sameRecognizedHanAsBaseline: han(transcript.text) === han(baselineText) })
    }
  }
  const report = { checkedAt: new Date().toISOString(), method: 'ffmpeg_atempo', status: results.every(item => item.durationWithinTolerance && item.sameRecognizedHanAsBaseline) ? 'synthetic_duration_and_asr_consistency_passed' : 'candidate_gate_failed', results, limitations: ['ASR consistency is not proof of spoken word accuracy', 'No human naturalness or familiarity result', 'No source rhythm transfer', 'Not a published voice version'] }
  await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.status === 'candidate_gate_failed' ? 1 : 0
} finally { await rm(root, { recursive: true, force: true }) }
