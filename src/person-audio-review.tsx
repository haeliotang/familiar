import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { memoryCharacterCount } from './memory-text'

type Subject = 'single_person' | 'mixed' | 'uncertain'
type Observation = { normalizedAudioSha256: string; selectedWindow: { startSec: number; endSec: number }; rateObservation?: { text?: string } }
type Review = { subject: Subject; text: string; rateEstimate: { charactersPerSpeechSec: number } | null }

export function PersonAudioReview({ assetId, busy, onProcessing, onClose }: { assetId: string; busy: boolean; onProcessing: (value: boolean) => void; onClose: () => void }) {
  const [observation, setObservation] = useState<Observation | null>(null)
  const [fingerprint, setFingerprint] = useState('')
  const [subject, setSubject] = useState<Subject>('uncertain')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Review | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const callbacks = useRef({ onProcessing })
  callbacks.current = { onProcessing }
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setObservation(null)
    callbacks.current.onProcessing(true)
    void (async () => {
      const result = await api<{ observations: Observation }>(`/v1/assets/${assetId}/audio-observations`, { method: 'POST', signal: controller.signal })
      const current = await api<{ review: Review | null; observationFingerprint: string }>(`/v1/assets/${assetId}/audio-review`, { signal: controller.signal })
      if (controller.signal.aborted) return
      setObservation(result.observations); setFingerprint(current.observationFingerprint)
      setSubject(current.review?.subject ?? 'uncertain'); setText(current.review?.text ?? result.observations.rateObservation?.text ?? ''); setSaved(current.review)
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法分析录音。') })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); callbacks.current.onProcessing(false) } })
    return () => { controller.abort(); callbacks.current.onProcessing(false) }
  }, [assetId, attempt])
  async function confirm() {
    if (!observation || saving || busy) return
    setSaving(true); setError(''); onProcessing(true)
    try {
      const result = await api<{ review: Review }>(`/v1/assets/${assetId}/audio-review`, { method: 'POST', body: JSON.stringify({ normalizedAudioSha256: observation.normalizedAudioSha256, observationFingerprint: fingerprint, ...observation.selectedWindow, subject, text }) })
      if (active.current) setSaved(result.review)
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '暂时无法保存核对。') }
    finally { if (active.current) { setSaving(false); onProcessing(false) } }
  }
  return <section className="transcript-review">
    <h2>核对本人录音</h2>
    {loading ? <p role="status">正在本机分析录音…</p> : observation && <>
      <p>所选片段：原录音第 {observation.selectedWindow.startSec.toFixed(2)}–{observation.selectedWindow.endSec.toFixed(2)} 秒。请根据原录音确认，不能确定时保留“不确定”。</p>
      <audio key={`${fingerprint}:${attempt}`} controls preload="none" src={`/v1/assets/${assetId}/audio-review/clip?fingerprint=${fingerprint}`} aria-label="试听所选录音片段" onError={() => setError('片段暂时无法播放，请重新分析后重试。')} />
      <label>这段片段里是谁在说话？<select value={subject} disabled={busy || saving} onChange={event => { setSubject(event.target.value as Subject); setSaved(null) }}>
        <option value="uncertain">不确定</option><option value="single_person">只有那个人本人</option><option value="mixed">有多位说话者</option>
      </select></label>
      <label>核对片段中的文字<textarea value={text} disabled={busy || saving} onChange={event => { setText(event.target.value); setSaved(null) }} /></label>
      <p>{memoryCharacterCount(text.trim())} / 500 字符。识别可能有错，也可能为空；仅填写该片段里确实说出的文字。</p>
      <button disabled={busy || saving || !!saved || memoryCharacterCount(text.trim()) > 500} onClick={() => void confirm()}>{saving ? '保存中…' : saved ? '已保存核对' : '保存核对'}</button>
      {saved && <p role="status">核对已保存。{saved.rateEstimate ? `按核对文字估计为每秒语音 ${saved.rateEstimate.charactersPerSpeechSec.toFixed(2)} 个汉字。` : '本次没有生成本人语速估计。'}</p>}
    </>}
    {error && <><p className="error" role="alert">{error}</p><button className="quiet" disabled={busy || loading || saving} onClick={() => setAttempt(value => value + 1)}>重新分析并核对</button></>}
    <button className="quiet" disabled={busy || loading || saving} onClick={onClose}>返回资料</button>
    <p className="note">核对文字只用于录音观察，不作为人物记忆。新声音的节奏迁移尚未完成。</p>
  </section>
}
