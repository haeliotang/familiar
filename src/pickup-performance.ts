// Both pinned retargeted bodies use the same source clip duration and reach frame.
export const pickupDuration = .8333333134651184
export const pickupContactPhase = 8 / 30
export const pickupStart = 28
export const pickupReturn = 31
export const pickupEnd = pickupReturn + pickupDuration

export function pickupPhase(seconds: number) {
  return Math.max(0, Math.min(pickupDuration, seconds >= pickupReturn ? pickupEnd - seconds : seconds - pickupStart))
}

export function pickupAttached(seconds: number) {
  return seconds >= pickupStart + pickupContactPhase && seconds <= pickupEnd - pickupContactPhase
}
