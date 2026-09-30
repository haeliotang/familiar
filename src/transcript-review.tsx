import { memoryCharacterCount } from './memory-text'
import { useEffect, useState } from 'react'
import { api } from './api'

export function TranscriptReview({ assetId, busy, onContinue }: { assetId: string; busy: boolean; onContinue: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void api<{ transcript: { text: string } }>(`/v1/assets/${assetId}/transcription`, { method: 'POST' }).then(({ transcript }) => {
      if (active) setText(transcript.text)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '暂时无法转写。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [assetId, attempt])

  async function confirm() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await api(`/v1/assets/${assetId}/transcription/confirm`, { method: 'POST', body: JSON.stringify({ text }) })
      setConfirmed(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法确认。') }
    finally { setSaving(false) }
  }
  async function continueEncounter() {
    if (saving || busy) return
    if (confirmed) { onContinue(); return }
    setSaving(true)
    setError('')
    try {
      await api(`/v1/assets/${assetId}/transcription/skip`, { method: 'POST' })
      onContinue()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法跳过。') }
    finally { setSaving(false) }
  }
  return <section className="transcript-review">
    <h2>核对你讲述的记忆</h2>
    <p>机器识别可能有错。请修改成你愿意确认的一小段记忆（最多 500 个字符）；确认后才会用作线索。</p>
    {loading ? <p role="status">正在本机转写录音…</p> : <>
      <label htmlFor="transcript">识别文字<textarea id="transcript" value={text} disabled={saving || busy} onChange={event => { setText(event.target.value); setConfirmed(false) }} /></label>
      <p>{memoryCharacterCount(text.trim())} / 500 字符{!text.trim() ? ' · 暂无可确认文字，可自行补充或跳过。' : ''}</p>
      <button disabled={saving || busy || confirmed || !text.trim() || memoryCharacterCount(text.trim()) > 500} onClick={() => void confirm()}>{saving ? '保存中…' : confirmed ? '已确认' : '确认这段记忆'}</button>
      {confirmed && <p role="status">已保存为你确认的记忆线索。</p>}
    </>}
    {error && <><p className="error" role="alert">{error}</p><button className="quiet" disabled={loading || saving || busy} onClick={() => setAttempt(value => value + 1)}>重试转写</button></>}
    <div className="actions"><button disabled={saving || busy} className={confirmed ? '' : 'quiet'} onClick={() => void continueEncounter()}>{confirmed ? '去看看' : '跳过转写，去看看'}</button></div>
    <p className="note">跳过时不会使用这份未经确认的识别文字；已上传的照片、录音和其他记忆仍会保留。</p>
  </section>
}
