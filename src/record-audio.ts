export function recordAudio(stream: MediaStream) {
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) { stream.getTracks().forEach(track => track.stop()); throw new Error('recording_unsupported') }
  let recorder: MediaRecorder
  try { recorder = new MediaRecorder(stream, { mimeType }) }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error }
  let chunks: Blob[] = []
  let bytes = 0
  let cancelled = false
  let failure: Error | undefined
  let finished = false
  let stopping = false
  let released = false
  let resolve!: (file: File | undefined) => void
  let reject!: (error: Error) => void
  const result = new Promise<File | undefined>((yes, no) => { resolve = yes; reject = no })
  let timer: ReturnType<typeof setTimeout>
  function release() {
    clearTimeout(timer)
    if (released) return
    released = true
    stream.getTracks().forEach(track => track.stop())
  }
  function complete() {
    if (finished) return
    finished = true
    release()
    const type = mimeType!.split(';')[0]
    const extension = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm'
    const file = !cancelled && !failure && bytes ? new File(chunks, `recording-${Date.now()}.${extension}`, { type }) : undefined
    chunks = []
    if (failure) reject(failure)
    else resolve(file)
  }
  function stop() {
    clearTimeout(timer)
    if (cancelled || failure) release()
    if (finished || stopping) return
    stopping = true
    if (recorder.state !== 'inactive') recorder.stop()
    else complete()
  }
  recorder.ondataavailable = event => {
    if (cancelled || failure || finished || !event.data.size) return
    bytes += event.data.size
    if (bytes > 30 * 1024 * 1024) { failure = new Error('recording_too_large'); chunks = []; stop(); return }
    chunks.push(event.data)
  }
  recorder.onstop = complete
  recorder.onerror = () => { failure = new Error('recording_failed'); stop() }
  try { recorder.start(1000) }
  catch (error) { release(); throw error }
  timer = setTimeout(stop, 180_000)
  return {
    result,
    stop,
    cancel() { cancelled = true; chunks = []; stop() },
  }
}
