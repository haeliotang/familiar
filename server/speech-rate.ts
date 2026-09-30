export function estimateChineseSpeechRate(text: string, speechDurationSec: number, windowDurationSec: number) {
  if (!Number.isFinite(speechDurationSec) || !Number.isFinite(windowDurationSec) || speechDurationSec < 2 || windowDurationSec < speechDurationSec) return null
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  if (!han || /[\p{Script=Latin}\p{N}]/u.test(text)) return null
  return { method: 'asr_han_character_rate_v1', reviewStatus: 'unconfirmed', recognizedHanCharacters: han, speechDurationSec, windowDurationSec, charactersPerSpeechSec: han / speechDurationSec, charactersPerWindowSec: han / windowDurationSec }
}
