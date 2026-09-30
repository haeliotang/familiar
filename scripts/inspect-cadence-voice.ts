import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { observeAudioFile } from '../server/audio-observations'
import { transcribeLocal } from '../server/asr'
import { spokenLine } from '../src/encounter'

const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'friend-cadence-inspection-'))
const directory = 'artifacts/acceptance/M0/cadence-candidates-v1'
const results = []
try {
  for (const speakerId of [58, 3]) for (const speed of [.8, 1, 1.2]) {
    const source = `${directory}/speaker-${speakerId}-speed-${speed}-repeat-1.wav`
    const normalized = join(root, `${speakerId}-${speed}.wav`)
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', source, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', normalized], { timeout: 10000 })
    const observation = await observeAudioFile(normalized)
    const transcript = await transcribeLocal(normalized)
    const expectedHan = spokenLine('wait').match(/\p{Script=Han}/gu)?.join('')
    const recognizedHan = transcript.text.match(/\p{Script=Han}/gu)?.join('')
    results.push({ speakerId, speed, source, durationSec: observation.durationSec, speechActivity: observation.speechActivity, text: transcript.text, strictHanMatch: expectedHan === recognizedHan })
  }
  const report = { checkedAt: new Date().toISOString(), expectedText: spokenLine('wait'), scope: 'synthetic_vad_and_asr_diagnostics_not_human_audio_quality', results }
  await writeFile(`${directory}/diagnostics.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
