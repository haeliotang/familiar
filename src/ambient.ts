export function startWind(context: AudioContext, startAt: number, duration: number, speechAt: number, speechDuration: number) {
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate)
  const samples = buffer.getChannelData(0)
  let seed = 173
  let smoothed = 0
  for (let index = 0; index < samples.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    smoothed = smoothed * 0.97 + (seed / 0xffffffff * 2 - 1) * 0.03
    samples[index] = smoothed
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 700
  const gain = context.createGain()
  const level = 0.18
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(level, startAt + 1.5)
  gain.gain.setValueAtTime(level, startAt + speechAt - 0.4)
  gain.gain.linearRampToValueAtTime(level * 0.2, startAt + speechAt)
  const speechEnd = Math.min(speechAt + speechDuration, duration - 2)
  gain.gain.setValueAtTime(level * 0.2, startAt + speechEnd)
  gain.gain.linearRampToValueAtTime(level, startAt + speechEnd + 0.6)
  gain.gain.setValueAtTime(level, startAt + duration - 1.5)
  gain.gain.linearRampToValueAtTime(0, startAt + duration)
  source.connect(filter).connect(gain).connect(context.destination)
  source.start(startAt)
  source.stop(startAt + duration)
  let stopped = false
  function stop() {
    if (stopped) return
    stopped = true
    try { source.stop() } catch { /* already ended */ }
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  source.onended = stop
  return stop
}
