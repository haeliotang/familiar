import { useEffect, useRef, useState } from 'react'
import { api } from './api'

export interface PendingPreparation { personId: string; key: string; submittedAt: number; preparationId?: string }
const storageKey = 'ordinary-friend-pending-preparation-v1'
export function savedPreparation(): PendingPreparation | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
    return value && typeof value.personId === 'string' && typeof value.key === 'string' && Number.isFinite(value.submittedAt) ? value : null
  } catch { return null }
}
export function savePreparation(value: PendingPreparation | null) {
  try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey) } catch { /* The server job remains durable when local storage is unavailable. */ }
}
export function preparationWaitState(elapsedMs: number) {
  return elapsedMs >= 60_000 ? 'timeout' : elapsedMs >= 40_000 ? 'slow' : 'waiting'
}

export function PreparationProgress({ pending, onReady, onDiscard }: { pending: PendingPreparation; onReady: (episodeId: string, signal: AbortSignal) => Promise<void>; onDiscard: () => void }) {
  const [windowStart, setWindowStart] = useState(pending.submittedAt)
  const [paused, setPaused] = useState(false)
  const [state, setState] = useState('waiting')
  const [error, setError] = useState('')
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    if (paused) return
    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    async function request<T>(path: string, options?: RequestInit) {
      const deadline = setTimeout(() => controller.abort(), 10_000)
      try { return await api<T>(path, { ...options, signal: controller.signal }) }
      finally { clearTimeout(deadline) }
    }
    let statusUrl = pending.preparationId ? `/v1/preparations/${pending.preparationId}` : undefined
    async function poll() {
      try {
        if (!statusUrl) {
          const created = await request<{ statusUrl: string }>(`/v1/persons/${pending.personId}/preparations`, { method: 'POST', headers: { 'Idempotency-Key': pending.key }, body: '{}' })
          statusUrl = created.statusUrl
        }
        if (!active) return
        const status = await request<{ status: string; episodeId: string | null; errorCode: string | null }>(statusUrl)
        if (!active) return
        if (status.status === 'completed' && status.episodeId) {
          await onReadyRef.current(status.episodeId, controller.signal)
          return
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          setState('failed')
          setError(status.errorCode === 'candidate_assets_unavailable' ? '场景或声音资源暂不可用，请稍后重新发起。' : status.errorCode === 'source_changed' ? '资料已改变，请根据当前资料重新发起相遇。' : status.errorCode === 'no_usable_evidence' ? '目前没有可用资料，请补充或核对后重新发起。' : '这次准备未完成，可以返回后重新发起。')
          return
        }
        const wait = preparationWaitState(Date.now() - windowStart)
        setState(wait)
        if (wait !== 'timeout') pollTimer = setTimeout(() => { void poll() }, 1000)
      } catch (cause) {
        if (!active) return
        setState('disconnected')
        setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : '连接暂时中断，准备请求已保留。')
      }
    }
    setState('waiting')
    setError('')
    void poll()
    return () => { active = false; controller.abort(); clearTimeout(pollTimer) }
  }, [pending.personId, pending.key, pending.preparationId, paused, windowStart])
  const retry = () => { setPaused(false); setWindowStart(Date.now()) }
  return <section aria-label="相遇准备进度">
    <h2>{paused ? '稍后再看' : state === 'timeout' ? '这次准备还没有完成' : state === 'failed' ? '暂时无法准备这次相遇' : state === 'disconnected' ? '暂时无法查看准备进度' : '正在准备这次相遇'}</h2>
    <p role="status">{paused ? '这次准备请求已保留。回来时可以继续查看同一请求。' : state === 'slow' ? '还在准备。你可以先离开，稍后回来查看。' : state === 'timeout' ? '已等待至少 60 秒。任务没有被当作成功，你可以继续等待或稍后回来。' : state === 'waiting' ? '正在确认资料并编排场景；准备完成后进入相遇。' : error}</p>
    <div className="actions">
      {(paused || state === 'timeout' || state === 'disconnected') && <button onClick={retry}>继续查看同一次准备</button>}
      {!paused && state !== 'failed' && <button className="quiet" onClick={() => setPaused(true)}>稍后再看</button>}
      {state === 'failed' && <button onClick={onDiscard}>返回资料</button>}
    </div>
  </section>
}
