import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { manifestContent } from '../src/manifest'
import { renderCadenceVoice } from './cadence-voice'
import { recordedVoice } from './recorded-voice'

const observation = { normalizedAudioSha256: 'a'.repeat(64), selectedWindow: { startSec: 0, endSec: 6 }, speechActivity: { status: 'measured', speechDurationSec: 4 } }
const review = { observationFingerprint: createHash('sha256').update(manifestContent(observation)).digest('hex'), normalizedAudioSha256: observation.normalizedAudioSha256, selectedWindow: observation.selectedWindow, subject: 'single_person', text: '今天的风很好。', confirmationSource: 'user' }

it.each(['kokoro-zh-zm009-v1', 'kokoro-zh-zf001-v1'])('renders a bounded, source-bound candidate for %s without replacing the baseline', async version => {
  const baseline = await recordedVoice('wait', version)
  const rendered = await renderCadenceVoice('synthetic-asset', observation, { ...review, rateEstimate: { charactersPerWindowSec: 999 } }, 'wait', version)
  expect(rendered).not.toBeNull()
  expect(rendered!.plan).toMatchObject({ speed: .8, limited: true, sourceCharactersPerWindowSec: 1, baselineVoiceVersion: version, pauseTransfer: false, observationFingerprint: review.observationFingerprint })
  expect(rendered!.plan.sha256).toBe(createHash('sha256').update(rendered!.audio).digest('hex'))
  expect(Math.abs(rendered!.plan.durationSec - rendered!.plan.baselineDurationSec / .8)).toBeLessThan(.12)
  expect(await recordedVoice('wait', version)).toEqual(baseline)
})

it('refuses stale analysis, a different window, mixed speakers and unconfirmed or insufficient text', async () => {
  const version = 'kokoro-zh-zm009-v1'
  for (const input of [null, { ...review, subject: 'mixed' }, { ...review, confirmationSource: 'asr' }, { ...review, text: 'hello' }, { ...review, selectedWindow: { startSec: 1, endSec: 6 } }, { ...review, normalizedAudioSha256: 'b'.repeat(64) }]) {
    expect(await renderCadenceVoice('synthetic-asset', observation, input, 'wait', version)).toBeNull()
  }
  expect(await renderCadenceVoice('synthetic-asset', { ...observation, speechActivity: { status: 'measured', speechDurationSec: 3 } }, review, 'wait', version)).toBeNull()
})

it('limits a fast confirmed reference to the verified upper speed', async () => {
  const observed = { ...observation, selectedWindow: { startSec: 0, endSec: 2 }, speechActivity: { status: 'measured', speechDurationSec: 2 } }
  const confirmed = { ...review, selectedWindow: observed.selectedWindow, text: '今天的风很好我们一起走。', observationFingerprint: createHash('sha256').update(manifestContent(observed)).digest('hex') }
  const rendered = await renderCadenceVoice('synthetic-asset', observed, confirmed, 'wait', 'kokoro-zh-zf001-v1')
  expect(rendered!.plan).toMatchObject({ speed: 1.2, limited: true, pauseTransfer: false })
  expect(rendered!.plan.requestedSpeed).toBeGreaterThan(1.2)
})

it.each([
  ['kokoro-zh-zm009-v1', 'wait'], ['kokoro-zh-zf001-v1', 'wait'],
  ['kokoro-zh-zm009-v1', 'repair'], ['kokoro-zh-zf001-v1', 'repair'],
] as const)('maps source pauses between retained phrases for %s / %s', async (version, cue) => {
  const observed = { ...observation, speechActivity: { ...observation.speechActivity, pauses: [{ startSec: 1, endSec: 1.4 }, { startSec: 3, endSec: 4.4 }] } }
  const confirmed = { ...review, observationFingerprint: createHash('sha256').update(manifestContent(observed)).digest('hex') }
  const rendered = await renderCadenceVoice('synthetic-asset', observed, confirmed, cue, version)
  expect(rendered!.plan).toMatchObject({ method: 'confirmed_window_rate_phrase_pause_v1', speed: .8, pauseTransfer: true, pausePlan: { addedPauseSec: .65, pauseLimited: true, phrasePackVersion: 'original-boundary-phrases-v1' } })
  expect(rendered!.plan.pausePlan!.sourceMedianPauseSec).toBeCloseTo(.9, 6)
  expect(rendered!.plan.pausePlan!.phraseHashes).toHaveLength(2)
  expect(Math.abs(rendered!.plan.durationSec - (rendered!.plan.baselineDurationSec / .8 + .65))).toBeLessThan(.24)
})

it('rejects inconsistent pause intervals and leaves single-phrase lines without inserted pauses', async () => {
  for (const pauses of [[{ startSec: -1, endSec: 0 }], [{ startSec: 1, endSec: 1 }], [{ startSec: 1, endSec: 5 }], [{ startSec: 1, endSec: 2 }, { startSec: 1.5, endSec: 2.5 }]]) {
    const observed = { ...observation, speechActivity: { ...observation.speechActivity, pauses } }
    const confirmed = { ...review, observationFingerprint: createHash('sha256').update(manifestContent(observed)).digest('hex') }
    expect(await renderCadenceVoice('synthetic-asset', observed, confirmed, 'wait', 'kokoro-zh-zm009-v1')).toBeNull()
  }
  const observed = { ...observation, speechActivity: { ...observation.speechActivity, pauses: [{ startSec: 1, endSec: 1.5 }] } }
  const confirmed = { ...review, observationFingerprint: createHash('sha256').update(manifestContent(observed)).digest('hex') }
  expect((await renderCadenceVoice('synthetic-asset', observed, confirmed, 'general', 'kokoro-zh-zm009-v1'))!.plan.pauseTransfer).toBe(false)
})
