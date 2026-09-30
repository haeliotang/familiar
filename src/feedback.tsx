import { useEffect, useState } from 'react'
import { api } from './api'

type Experience = 'familiar' | 'unfamiliar' | 'uncertain'
type Issue = 'incorrect_detail' | 'unnatural_voice' | 'slow_preparation' | 'other'
type SavedFeedback = { experience: Experience | null; issue: Issue | null; comment: string | null }

export function Feedback({ episodeId }: { episodeId: string }) {
  const [experience, setExperience] = useState<Experience | ''>('')
  const [issue, setIssue] = useState<Issue | ''>('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void api<{ feedback: SavedFeedback | null }>(`/v1/episodes/${episodeId}/feedback`).then(({ feedback }) => {
      if (active && feedback) {
        setExperience(feedback.experience || '')
        setIssue(feedback.issue || '')
        setComment(feedback.comment || '')
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '暂时无法读取反馈。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [episodeId])

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api(`/v1/episodes/${episodeId}/feedback`, { method: 'POST', body: JSON.stringify({
        ...(experience ? { experience } : {}), ...(issue ? { issue } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}),
      }) })
      setMessage('已保存，你仍可以修改。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法保存反馈。') }
    finally { setSaving(false) }
  }

  return <details className="feedback">
    <summary>说说这次体验（可跳过）</summary>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <label>有没有让你联想到那个人？<select disabled={loading || saving} value={experience} onChange={event => { setExperience(event.target.value as Experience | ''); setMessage('') }}>
        <option value="">暂不回答</option><option value="familiar">有</option><option value="unfamiliar">没有</option><option value="uncertain">说不清</option>
      </select></label>
      <label>有没有影响体验的地方？<select disabled={loading || saving} value={issue} onChange={event => { setIssue(event.target.value as Issue | ''); setMessage('') }}>
        <option value="">暂不回答</option><option value="incorrect_detail">某个细节不对</option><option value="unnatural_voice">声音不自然</option><option value="slow_preparation">等待太久</option><option value="other">其他</option>
      </select></label>
      <label>愿意的话，留下一句话<textarea maxLength={500} disabled={loading || saving} value={comment} onChange={event => { setComment(event.target.value); setMessage('') }} /></label>
      <button disabled={loading || saving || (!experience && !issue && !comment.trim())}>{saving ? '保存中…' : '保存反馈'}</button>
      {message && <p role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
    </form>
  </details>
}
