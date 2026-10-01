import { startWind } from './ambient'

export function samplePlayback(context: AudioContext, voice: AudioBuffer, destination: AudioNode, soundOutput?: AudioNode) {
  let state: 'idle' | 'playing' | 'paused' | 'finished' = 'idle'
  let startAt = 0
  let source: AudioBufferSourceNode | undefined
  let stopWind: (() => void) | undefined
  let generation = 0
  function clear() {
    if (source) { try { source.stop() } catch { /* already ended */ }; source.disconnect(); source = undefined }
    stopWind?.()
    stopWind = undefined
  }
  return {
    get state() { return state },
    get time() {
      if (state === 'idle') return 0
      if (state === 'finished') return 75
      const time = Math.max(0, Math.min(75, context.currentTime - startAt))
      if (time >= 75) { clear(); state = 'finished' }
      return time
    },
    async start() {
      const ticket = ++generation
      clear()
      state = 'idle'
      await context.resume()
      if (ticket !== generation) return
      if (context.state !== 'running') throw new Error('audio_not_running')
      startAt = context.currentTime
      const node = context.createBufferSource()
      node.buffer = voice
      node.connect(destination)
      node.onended = () => node.disconnect()
      node.start(startAt + 43)
      source = node
      stopWind = startWind(context, startAt, 75, 43, voice.duration, soundOutput)
      state = 'playing'
    },
    async pause() {
      if (state !== 'playing') return
      const ticket = generation
      if (context.state !== 'closed') await context.suspend()
      if (ticket !== generation) return
      state = 'paused'
    },
    async resume() {
      if (state !== 'paused') return
      const ticket = generation
      await context.resume()
      if (ticket !== generation) return
      if (context.state !== 'running') throw new Error('audio_not_running')
      state = 'playing'
    },
    dispose() {
      generation++
      clear()
      state = 'idle'
    },
    async stop() {
      generation++
      clear()
      state = 'idle'
      if (context.state !== 'closed') await context.suspend()
    },
  }
}
