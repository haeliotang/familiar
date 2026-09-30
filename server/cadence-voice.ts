import { createHash } from 'node:crypto'
import { z } from 'zod'
import { manifestContent } from '../src/manifest'
import { spokenLine, type Cue } from '../src/encounter'
import { recordedVoice } from './recorded-voice'
import { retimeVoice } from './retime-voice'
import { estimateChineseSpeechRate } from './speech-rate'
import { recordedPhrases, voicePcm, joinVoicePhrases } from './phrase-voice'

const windowSchema = z.object({ startSec: z.number().finite().min(0), endSec: z.number().finite().max(180) }).refine(value => value.endSec > value.startSec && value.endSec - value.startSec <= 30)
const observationSchema = z.object({ normalizedAudioSha256: z.string().regex(/^[a-f0-9]{64}$/), selectedWindow: windowSchema, speechActivity: z.object({ status: z.literal('measured'), speechDurationSec: z.number().finite(), pauses: z.array(z.object({ startSec: z.number().finite(), endSec: z.number().finite() })).optional() }) })
const reviewSchema = z.object({ observationFingerprint: z.string(), normalizedAudioSha256: z.string(), selectedWindow: windowSchema, subject: z.literal('single_person'), text: z.string().trim().min(1).max(500), confirmationSource: z.literal('user') })
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export async function renderCadenceVoice(sourceAssetId: string, observations: Record<string, unknown>, review: unknown, cue: Cue, voiceVersion: string) {
  const observed = observationSchema.safeParse(observations)
  const confirmed = reviewSchema.safeParse(review)
  if (!observed.success || !confirmed.success) return null
  const source = observed.data
  const input = confirmed.data
  const observationFingerprint = createHash('sha256').update(manifestContent(observations)).digest('hex')
  if (input.observationFingerprint !== observationFingerprint || input.normalizedAudioSha256 !== source.normalizedAudioSha256 || input.selectedWindow.startSec !== source.selectedWindow.startSec || input.selectedWindow.endSec !== source.selectedWindow.endSec) return null
  // Recompute from confirmed text; never trust a stored or automatic rate estimate.
  const estimate = estimateChineseSpeechRate(input.text, source.speechActivity.speechDurationSec, source.selectedWindow.endSec - source.selectedWindow.startSec)
  if (!estimate) return null
  const standard = await recordedVoice(cue, voiceVersion)
  let baselineDurationSec = voicePcm(standard).durationSec
  const baselineCharacters = spokenLine(cue).match(/\p{Script=Han}/gu)?.length ?? 0
  let requestedSpeed = estimate.charactersPerWindowSec / (baselineCharacters / baselineDurationSec)
  let phrases: Awaited<ReturnType<typeof recordedPhrases>> | undefined
  let pausePlan: { sourceMedianPauseSec: number; addedPauseSec: number; pauseLimited: boolean; phrasePackVersion: string; phraseHashes: string[] } | undefined
  const pauses = source.speechActivity.pauses ?? []
  for (let i = 0; i < pauses.length; i++) {
    if (pauses[i].startSec < source.selectedWindow.startSec || pauses[i].endSec > source.selectedWindow.endSec || pauses[i].endSec <= pauses[i].startSec || (i > 0 && pauses[i].startSec < pauses[i - 1].endSec)) return null
  }
  if (source.speechActivity.speechDurationSec + pauses.reduce((total, pause) => total + pause.endSec - pause.startSec, 0) > source.selectedWindow.endSec - source.selectedWindow.startSec + 1e-6) return null
  if (pauses.length && cue !== 'general') {
    const lengths = pauses.map(pause => pause.endSec - pause.startSec).sort((a, b) => a - b)
    const sourceMedianPauseSec = (lengths[Math.floor((lengths.length - 1) / 2)] + lengths[Math.floor(lengths.length / 2)]) / 2
    const addedPauseSec = Math.min(.65, Math.max(.25, sourceMedianPauseSec))
    phrases = await recordedPhrases(cue, voiceVersion)
    baselineDurationSec = phrases.audio.reduce((total, part) => total + voicePcm(part).durationSec, 0)
    const desiredDurationSec = baselineCharacters / estimate.charactersPerWindowSec
    requestedSpeed = baselineDurationSec / Math.max(.1, desiredDurationSec - addedPauseSec)
    pausePlan = { sourceMedianPauseSec, addedPauseSec, pauseLimited: Math.abs(sourceMedianPauseSec - addedPauseSec) > 1e-6, phrasePackVersion: phrases.version, phraseHashes: phrases.hashes }
  }
  const baselineCharactersPerWindowSec = baselineCharacters / baselineDurationSec
  const speed = Math.round(Math.min(1.2, Math.max(.8, requestedSpeed)) * 1000) / 1000
  let audio: Buffer
  if (phrases && pausePlan) {
    const parts: Buffer[] = []
    for (const part of phrases.audio) parts.push(await retimeVoice(part, speed))
    audio = joinVoicePhrases(parts, pausePlan.addedPauseSec)
  } else audio = await retimeVoice(standard, speed)
  const durationSec = voicePcm(audio).durationSec
  const expectedDurationSec = baselineDurationSec / speed + (pausePlan?.addedPauseSec ?? 0)
  if (Math.abs(durationSec - expectedDurationSec) > (phrases ? .24 : .12)) throw new Error('cadence_duration_mismatch')
  return { audio, plan: {
    method: pausePlan ? 'confirmed_window_rate_phrase_pause_v1' : 'confirmed_window_rate_atempo_v1', sourceAssetId, observationFingerprint,
    normalizedAudioSha256: source.normalizedAudioSha256, selectedWindow: source.selectedWindow,
    confirmationSource: 'user', baselineVoiceVersion: voiceVersion, baselineSha256: hash(standard),
    baselineDurationSec, baselineCharactersPerWindowSec, sourceCharactersPerWindowSec: estimate.charactersPerWindowSec,
    requestedSpeed, speed, limited: Math.abs(requestedSpeed - speed) > .001, durationSec, sha256: hash(audio),
    pauseTransfer: !!pausePlan, ...(pausePlan ? { pausePlan } : {}),
  } }
}
