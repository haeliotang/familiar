import { useEffect, useRef, useState } from 'react'
import { recordAudio } from './record-audio'

export function AudioRecorder({ label, busy, onFile, onRecording }: { label: string; busy: boolean; onFile: (file: File) => void; onRecording: (value: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [message, setMessage] = useState('')
  const recording = useRef<ReturnType<typeof recordAudio> | null>(null)
  const generation = useRef(0)
  const locked = useRef(false)
  const notify = useRef(onRecording)
  notify.current = onRecording
  useEffect(() => () => { generation.current++; recording.current?.cancel(); if (locked.current) notify.current(false) }, [])
  useEffect(() => {
    if (state !== 'recording') return
    const start = performance.now()
    const timer = window.setInterval(() => setSeconds(Math.min(180, Math.floor((performance.now() - start) / 1000))), 500)
    return () => window.clearInterval(timer)
  }, [state])

  async function start() {
    if (busy || locked.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setMessage('此浏览器暂不支持直接录音，请上传录音文件。'); return }
    locked.current = true
    onRecording(true)
    const ticket = ++generation.current
    setState('requesting')
    setMessage('')
    setSeconds(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (ticket !== generation.current) { stream.getTracks().forEach(track => track.stop()); return }
      const current = recordAudio(stream)
      recording.current = current
      setState('recording')
      const file = await current.result
      if (ticket !== generation.current) return
      if (file) { onFile(file); setMessage('录音已选好，点击“去看看”才会上传。') }
      else setMessage('没有保存录音，可以重新录制。')
    } catch (cause) {
      if (ticket !== generation.current) return
      const name = cause instanceof Error ? cause.name : ''
      const code = cause instanceof Error ? cause.message : ''
      setMessage(name === 'NotAllowedError' ? '未获得麦克风权限，可以上传录音文件。' : code === 'recording_too_large' ? '录音超过 30 MB，请缩短后重录。' : '暂时无法录音，可以重试或上传文件。')
    } finally {
      if (ticket === generation.current) {
        recording.current = null
        locked.current = false
        setState('idle')
        onRecording(false)
      }
    }
  }
  function cancel() {
    generation.current++
    recording.current?.cancel()
    recording.current = null
    locked.current = false
    setState('idle')
    setMessage('已取消录音。')
    onRecording(false)
  }
  return <div className="audio-recorder">
    {state === 'idle' ? <button type="button" className="quiet" disabled={busy} onClick={() => void start()}>录制{label}</button> : <div className="actions">
      <span role="status">{state === 'requesting' ? '请允许浏览器使用麦克风…' : `正在录制${label} · ${seconds} 秒 / 180 秒`}</span>
      {state === 'recording' && <button type="button" onClick={() => recording.current?.stop()}>结束并选用录音</button>}
      <button type="button" className="quiet" onClick={cancel}>取消录音</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>
}
