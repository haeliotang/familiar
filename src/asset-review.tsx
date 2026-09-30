import { PersonAudioReview } from './person-audio-review'
import { audioObservationMessage } from './audio-observation-message'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'

type Asset = { assetId: string; kind: string; state: string; reviewState: string }

export function AssetReview({ personId, revision, busy, onProcessing, onContinue, onReview }: { personId: string; revision: number; busy: boolean; onProcessing: (value: boolean) => void; onContinue: () => void; onReview: (assetId: string) => void }) {
  const [personAudioId, setPersonAudioId] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [observations, setObservations] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [processing, setProcessing] = useState<string | null>(null)
  const pending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    let current = true
    void api<{ assets: Asset[] }>(`/v1/persons/${personId}/assets`).then(result => {
      if (current) setAssets(result.assets)
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : '暂时无法读取资料状态。') })
    return () => { current = false }
  }, [personId, revision, refresh])

  async function retry(assetId: string, operation = 'complete') {
    if (busy || pending.current) return
    pending.current = true
    setProcessing(assetId)
    setError('')
    onProcessing(true)
    try {
      const result = await api<{ observations?: { signalStatus: string } }>(`/v1/assets/${assetId}/${operation}`, { method: 'POST' })
      if (active.current && operation === 'audio-observations') setObservations(items => ({ ...items, [assetId]: audioObservationMessage(result.observations?.signalStatus) }))
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '暂时无法处理资料。')
    } finally {
      pending.current = false
      if (active.current) {
        setProcessing(null)
        setRefresh(value => value + 1)
        onProcessing(false)
      }
    }
  }

  if (personAudioId) return <PersonAudioReview assetId={personAudioId} busy={busy} onProcessing={onProcessing} onClose={() => { setPersonAudioId(null); setRefresh(value => value + 1) }} />
  if (!assets.length && !error) return null
  return <section className="asset-review">
    <h2>已上传的资料</h2>
    {assets.map((asset, index) => {
      const label = `${asset.kind === 'photo' ? '照片' : asset.kind === 'user_memory_audio' ? '我讲述的记忆录音' : '本人录音'} ${index + 1}`
      return <p key={asset.assetId}>{label} · {asset.state === 'ready' ? '已处理' : asset.state === 'uploaded' ? '等待处理' : asset.state === 'rejected' ? '无法解码，请重新选择文件' : '尚未上传完成，请重新选择文件'} {asset.state === 'uploaded' && <button className="quiet" disabled={busy || !!processing} onClick={() => void retry(asset.assetId)}>{processing === asset.assetId ? '处理资料中…' : `重试处理${label}`}</button>}{asset.state === 'ready' && asset.kind === 'user_memory_audio' && asset.reviewState === 'pending' && <button className="quiet" disabled={busy || !!processing} onClick={() => onReview(asset.assetId)}>核对这段记忆录音</button>}{asset.state === 'ready' && asset.kind === 'deceased_audio' && <button className="quiet" disabled={busy || !!processing} onClick={() => void retry(asset.assetId, 'audio-observations')}>{processing === asset.assetId ? '检查录音中…' : '检查本人录音'}</button>}{asset.state === 'ready' && asset.kind === 'deceased_audio' && <button className="quiet" disabled={busy || !!processing} onClick={() => setPersonAudioId(asset.assetId)}>核对本人录音</button>}{observations[asset.assetId] && <span role="status"> {observations[asset.assetId]}</span>}</p>
    })}
    {error && <p className="error" role="alert">{error}</p>}
    {assets.some(asset => asset.state === 'ready') && !assets.some(asset => asset.kind === 'user_memory_audio' && asset.state === 'ready' && asset.reviewState === 'pending') && <button disabled={busy || !!processing} onClick={onContinue}>用已处理资料去看看</button>}
    <p className="note">重试使用已上传的文件，无需重复上传。记忆录音核对后才用作线索；照片和本人录音尚不会提取个人线索。</p>
  </section>
}
