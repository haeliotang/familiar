import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { transcribeLocal } from '../server/asr'

const run = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'familiar-asr-'))
try {
  const wav = join(root, 'synthetic.wav')
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', '.models/kokoro-general.wav', '-ac', '1', '-ar', '16000', wav], { timeout: 10_000 })
  const started = performance.now()
  const result = await transcribeLocal(wav)
  if (!result.text || !result.segments.length) throw new Error('synthetic speech produced no transcript')
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
  const silence = join(root, 'silence.wav')
  sherpa.writeWave(silence, { samples: new Float32Array(16000), sampleRate: 16000 })
  if ((await transcribeLocal(silence)).text !== '') throw new Error('digital silence produced a transcript')
  console.log(JSON.stringify({ model: result.modelId, syntheticText: result.text, expected: '今天的风很好。', exactMatch: result.text.replace(/[。！!，,\s]/g, '') === '今天的风很好', elapsedMs: Math.round(performance.now() - started), silenceRejected: true }))
} finally { await rm(root, { recursive: true, force: true }) }
