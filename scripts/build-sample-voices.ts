import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { synthesize } from '../server/tts'
import { spokenLine, type Cue } from '../src/encounter'

const female = process.argv.includes('--female')
const directory = female ? 'public/assets/sample-voices-female' : 'public/assets/sample-voices'
const speakerId = female ? 3 : 58
await mkdir(directory, { recursive: true })
const voices = []
for (const cue of ['general', 'wait', 'repair'] as Cue[]) {
  const audio = await synthesize(cue, speakerId)
  await writeFile(`${directory}/${cue}.wav`, audio)
  voices.push({ cue, text: spokenLine(cue), bytes: audio.length, sha256: createHash('sha256').update(audio).digest('hex') })
}
await writeFile(`${directory}/provenance.json`, JSON.stringify({ source: 'locally generated synthetic sample lines; no user recordings', model: 'kokoro-int8-multi-lang-v1_1', runtime: 'sherpa-onnx-node 1.13.8', speakerId, speed: 1, purpose: 'local candidate review only', voices }, null, 2) + '\n')
console.log(voices)
