import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { renderCadenceVoice } from '../server/cadence-voice'
import { manifestContent } from '../src/manifest'
import { compactMaleAvatarVersion, compactFemaleAvatarVersion } from '../src/avatar-catalog'
import { voiceVersionForAvatar } from '../src/voice-catalog'
import type { Cue } from '../src/encounter'

const baseline = JSON.parse(await readFile('docs/verification/encounter-download-bytes.json', 'utf8'))
const results = []
for (const version of [compactMaleAvatarVersion, compactFemaleAvatarVersion]) for (const cue of ['general', 'wait', 'repair'] as Cue[]) {
  const selected = baseline.results.find((item: { version: string; cue: string }) => item.version === version && item.cue === cue)
  if (!selected) throw new Error('missing_baseline_measurement')
  for (const file of selected.files) {
    const bytes = await readFile(file.path)
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('stale_baseline_measurement')
  }
  const voiceBytes = selected.files.find((file: { path: string }) => file.path.endsWith(`${cue}.wav`)).bytes
  for (const speed of [.8, 1.2]) for (const pause of [0, .25, .65]) {
    const observation = { normalizedAudioSha256: 'a'.repeat(64), selectedWindow: { startSec: 0, endSec: 6 }, speechActivity: { status: 'measured', speechDurationSec: 4, pauses: pause ? [{ startSec: 1, endSec: 1 + pause }] : [] } }
    const review = { observationFingerprint: createHash('sha256').update(manifestContent(observation)).digest('hex'), normalizedAudioSha256: observation.normalizedAudioSha256, selectedWindow: observation.selectedWindow, subject: 'single_person', text: speed === .8 ? '今天的风很好。' : '风'.repeat(40), confirmationSource: 'user' }
    const rendered = await renderCadenceVoice('synthetic-download-measurement', observation, review, cue, voiceVersionForAvatar(version))
    if (!rendered || rendered.plan.speed !== speed) throw new Error('unexpected_measurement_speed')
    const bytes = selected.bytes - voiceBytes + rendered.audio.length
    results.push({ version, cue, speed, sourcePauseSec: pause, pauseTransfer: rendered.plan.pauseTransfer, addedPauseSec: rendered.plan.pausePlan?.addedPauseSec ?? 0, voiceBytes: rendered.audio.length, voiceSha256: rendered.plan.sha256, durationSec: rendered.plan.durationSec, bytes, within12MB: bytes <= 12_000_000 })
  }
}
await writeFile('docs/verification/cadence-download-bytes.json', JSON.stringify({ scope: '36 synthetic boundary cases rendered by actual cadence pipeline; built application + selected compact avatar + generated voice; excludes HTTP overhead, API JSON and private uploads; not network/device timing', results }, null, 2) + '\n')
console.log(JSON.stringify({ cases: results.length, maxBytes: Math.max(...results.map(result => result.bytes)), allWithin12MB: results.every(result => result.within12MB) }))
if (results.some(result => !result.within12MB)) process.exitCode = 1
