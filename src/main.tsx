import { sceneLabels } from './scene-catalog'
import { audioObservationMessage } from './audio-observation-message'
import { PreparationProgress, savedPreparation, savePreparation, type PendingPreparation } from './preparation-progress'
import { limitMemoryText, memoryCharacterCount } from './memory-text'
import { fromApi, type ApiEpisode } from './episode'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Encounter } from './encounter'
import { demoEncounter } from './encounter'
import { api, submitEvidence } from './api'
import { SceneView } from './scene-loader'
import { Feedback } from './feedback'
import { EvidenceCorrection } from './evidence-correction'
import { DeletionStatus } from './deletion-status'
import { AudioRecorder } from './audio-recorder'
import { AssetReview } from './asset-review'
import { TranscriptReview } from './transcript-review'
import './style.css'

function App() {
  const [pending, setPending] = useState<PendingPreparation | null>(null)
  const [memory, setMemory] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [photoPrompt, setPhotoPrompt] = useState(false)
  const [deceasedAudio, setDeceasedAudio] = useState<File | null>(null)
  const [memoryAudio, setMemoryAudio] = useState<File | null>(null)
  const [reviewAssetId, setReviewAssetId] = useState<string | null>(null)
  const [inputVersion, setInputVersion] = useState(0)
  const [assetRevision, setAssetRevision] = useState(0)
  const [personId, setPersonId] = useState<string | null>(null)
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [current, setCurrent] = useState<Encounter | null>(null)
  const [replay, setReplay] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const session = await fetch('/v1/sessions/current', { credentials: 'same-origin' })
        if (session.status === 401) await api('/v1/sessions/anonymous', { method: 'POST' })
        else if (!session.ok) throw new Error('无法连接本地服务。')
        const persons = await api<{ persons: Array<{ personId: string }> }>('/v1/persons')
        const id = persons.persons[0]?.personId || null
        const history = id ? await api<{ episodes: ApiEpisode[] }>(`/v1/persons/${id}/episodes`) : { episodes: [] }
        const restored = await Promise.all(history.episodes.filter(item => item.status === 'prototype').map(fromApi))
        const assets = id ? await api<{ assets: Array<{ assetId: string; kind: string; state: string; reviewState: string }> }>(`/v1/persons/${id}/assets`) : { assets: [] }
        const saved = savedPreparation()
        const queued = id && saved?.personId !== id ? await api<{ preparations: Array<{ preparationId: string; createdAt: string }> }>(`/v1/persons/${id}/preparations`) : { preparations: [] }
        const recovered = queued.preparations[0]
        if (active) {
          setPersonId(id)
          if (saved?.personId === id) setPending(saved)
          else if (id && recovered) {
            const pending = { personId: id, key: recovered.preparationId, preparationId: recovered.preparationId, submittedAt: Date.parse(recovered.createdAt) }
            savePreparation(pending)
            setPending(pending)
          } else savePreparation(null)
          setReviewAssetId(assets.assets.find(asset => asset.kind === 'user_memory_audio' && asset.state === 'ready' && asset.reviewState === 'pending')?.assetId || null)
          setEncounters(restored)
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '本地服务不可用。')
      } finally { if (active) setBusy(false) }
    }
    void load()
    return () => { active = false }
  }, [])

  async function begin(next = false, photoChoice?: 'memory' | 'generic') {
    if (submitting.current || pending) return
    const submittedMemory = photoChoice === 'generic' ? '' : memory
    if (!next && !submittedMemory.trim() && !photos.length && !deceasedAudio && !memoryAudio) { setError('请写下一句记忆、选一份文件，或进入示例体验。'); return }
    if (!next && !photoChoice && !personId && photos.length && !submittedMemory.trim() && !deceasedAudio && !memoryAudio) { setPhotoPrompt(true); return }
    setPhotoPrompt(false)
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      let id = personId
      if (!id) {
        const person = await api<{ personId: string }>('/v1/persons', { method: 'POST', body: '{}' })
        id = person.personId
        setPersonId(id)
      }
      let uploadErrors: string[] = []
      let uploadedMemoryId: string | null = null
      if (!next) {
        const selected: Array<readonly ['photo' | 'deceased_audio' | 'user_memory_audio', File]> = [
          ...photos.map(file => ['photo', file] as const),
          ...(deceasedAudio ? [['deceased_audio', deceasedAudio] as const] : []),
          ...(memoryAudio ? [['user_memory_audio', memoryAudio] as const] : []),
        ]
        uploadErrors = await submitEvidence(id, submittedMemory, selected, (kind, assetId) => { if (kind === 'user_memory_audio') uploadedMemoryId = assetId })
        setPhotos([])
        setDeceasedAudio(null)
        setMemoryAudio(null)
        setInputVersion(value => value + 1)
        if (uploadedMemoryId) {
          setReviewAssetId(uploadedMemoryId)
          setMemory('')
          setPhotos([])
          setDeceasedAudio(null)
          setMemoryAudio(null)
          setInputVersion(value => value + 1)
          if (uploadErrors.length) setError(uploadErrors.join('；'))
          return
        }
      }
      const request = { personId: id, key: crypto.randomUUID(), submittedAt: Date.now() }
      savePreparation(request)
      setPending(request)
      setReviewAssetId(null)
      setMemory('')
      if (uploadErrors.length) setError(uploadErrors.join('；'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法开始。') }
    finally { submitting.current = false; setBusy(false); setAssetRevision(value => value + 1) }
  }

  async function prepared(episodeId: string, signal: AbortSignal) {
    const episode = await api<{ status: string; manifest: ApiEpisode['manifest'] }>(`/v1/episodes/${episodeId}`, { signal })
    if (episode.status !== 'prototype') throw new Error('相遇尚未准备好。')
    const encounter = await fromApi({ episodeId, status: episode.status, manifest: episode.manifest, createdAt: new Date().toISOString() })
    if (signal.aborted) return
    setEncounters(items => [encounter, ...items.filter(item => item.id !== episodeId)])
    setCurrent(encounter)
    setPending(null)
    savePreparation(null)
  }

  async function clear() {
    if (!personId || submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      await api(`/v1/persons/${personId}`, { method: 'DELETE' })
      setPersonId(null)
      setPending(null)
      savePreparation(null)
      setReviewAssetId(null)
      setEncounters([])
      setCurrent(null)
      setMemory('')
      setPhotos([])
      setPhotoPrompt(false)
      setDeceasedAudio(null)
      setMemoryAudio(null)
      setInputVersion(value => value + 1)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法删除。') }
    finally { submitting.current = false; setBusy(false) }
  }

  async function retract() {
    if (!current?.evidenceId || submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      await api(`/v1/evidence/${current.evidenceId}/retract`, { method: 'POST' })
      setEncounters(items => items.map(item => item.evidenceId === current.evidenceId ? { ...item, retracted: true } : item))
      setCurrent({ ...current, retracted: true })
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法纠正。') }
    finally { submitting.current = false; setBusy(false) }
  }

  async function hide() {
    if (!current || submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      await api(`/v1/episodes/${current.id}/hide`, { method: 'POST' })
      setEncounters(items => items.filter(item => item.id !== current.id))
      setCurrent(null)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法移除。') }
    finally { submitting.current = false; setBusy(false) }
  }

  return <main>
    <header><span className="brand">普通朋友</span><span className="edition">体验原型 · 本地示例</span></header>
    {pending ? <section className="intro">
      <PreparationProgress key={pending.key} pending={pending} onReady={prepared} onDiscard={() => { setPending(null); savePreparation(null); setCurrent(null) }} />
      <button className="text-button" disabled={busy} onClick={() => void clear()}>删除服务端的这份资料</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section> : !current ? <section className="intro">
      <p className="eyebrow">一次想象中的相遇</p>
      <h1>记得一点，<br />就从这里开始。</h1>
      <p className="lead">写下一句你记得的细节。我们会把它放进一段虚构的相遇里；这里不会声称知道那个人真实的近况。</p>
      {reviewAssetId ? <TranscriptReview key={reviewAssetId} assetId={reviewAssetId} busy={busy} onContinue={() => void begin(true)} /> : photoPrompt ? <section aria-labelledby="photo-question">
        <h2 id="photo-question">你记得那个人的一个小习惯吗？</h2>
        <p>照片暂时不能告诉我们那个人的习惯。你可以自愿补一句记忆，也可以先看一段一般的想象场景。</p>
        <label htmlFor="photo-memory">一句记忆（可以留空）</label>
        <textarea id="photo-memory" disabled={busy} value={memory} onChange={event => setMemory(limitMemoryText(event.target.value))} placeholder="比如：他总会回头等走在后面的人。" />
        <p>{memoryCharacterCount(memory)} / 500 字符</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions"><button disabled={busy || !memory.trim()} onClick={() => void begin(false, 'memory')}>用这句记忆继续</button><button className="quiet" disabled={busy} onClick={() => void begin(false, 'generic')}>不补充，先看一般场景</button><button className="quiet" disabled={busy} onClick={() => setPhotoPrompt(false)}>返回资料</button></div>
      </section> : <>
      <label htmlFor="memory">你记得的一个小细节</label>
      <textarea id="memory" value={memory} onChange={event => setMemory(limitMemoryText(event.target.value))} placeholder="比如：他走路时，总会回头等我。" />
      <p>{memoryCharacterCount(memory)} / 500 字符</p>
      <div className="file-fields">
        <label>照片（最多 5 张）<input disabled={busy} key={`photos-${inputVersion}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple onChange={event => setPhotos(Array.from(event.target.files || []))} /></label>
        <label>那个人本人的录音<input disabled={busy} key={`deceased-${inputVersion}`} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/ogg" onChange={event => setDeceasedAudio(event.target.files?.[0] || null)} /></label>
        <AudioRecorder key={`record-deceased-${inputVersion}`} label="那个人本人的录音" busy={busy} onFile={setDeceasedAudio} onRecording={value => { submitting.current = value; setBusy(value) }} />
        {deceasedAudio && <p className="note">已选那个人本人的录音：{deceasedAudio.name}</p>}
        <label>我讲述的一段记忆<input disabled={busy} key={`memory-${inputVersion}`} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/ogg" onChange={event => setMemoryAudio(event.target.files?.[0] || null)} /></label>
        <AudioRecorder key={`record-memory-${inputVersion}`} label="我讲述的记忆" busy={busy} onFile={setMemoryAudio} onRecording={value => { submitting.current = value; setBusy(value) }} />
        {memoryAudio && <p className="note">已选记忆录音：{memoryAudio.name}</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!busy && <DeletionStatus />}
      <div className="actions"><button disabled={busy} onClick={() => void begin()}>{busy ? '准备中…' : '去看看'}</button><button className="quiet" disabled={busy} onClick={() => setCurrent(demoEncounter())}>先看示例</button></div>
      </>}
      {personId && !reviewAssetId && <AssetReview key={personId} personId={personId} revision={assetRevision} busy={busy} onReview={setReviewAssetId} onProcessing={value => { submitting.current = value; setBusy(value) }} onContinue={() => void begin(true)} />}
      {reviewAssetId && error && <p className="error" role="alert">{error}</p>}
      {encounters.length > 0 && <div className="history"><h2>以前的相遇</h2>{encounters.map(item => <button className="history-item" key={item.id} disabled={busy} onClick={() => setCurrent(item)}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {sceneLabels[item.scene]}{item.retracted ? ' · 线索已撤回' : ''}</button>)}</div>}
      {personId && <button className="text-button" disabled={busy} onClick={() => void clear()}>删除服务端的这份资料</button>}
      <p className="note">当前为本地开发原型。文件只保存在本机私有目录；记忆录音可在本机转写，核对后用于线索。照片和本人录音尚不会提取个人线索。请暂勿输入真实私密资料。</p>
    </section> : <section className="view">
      <div className="view-header"><button className="quiet" onClick={() => setCurrent(null)}>← 返回</button><span>{current.id === 'demo' ? '无个人资料的示例' : current.personalizationLevel === 'generic' ? '一般想象场景 · 未使用个人线索' : '由你的记忆启发 · 虚构场景原型'}</span></div>
      <SceneView encounter={current} replay={replay} />
      <p className="voice-note">本次人物外观是虚构创作；合成语音使用新音色，不模仿上传录音。</p>
      {current.id !== 'demo' && current.personalizationLevel === 'generic' && <p className="note" role="status">这次没有使用可用的个人线索，是一段一般的想象场景。你可以返回，自愿补一句记忆。</p>}
      {current.degraded && current.degradationReason === 'audio_analysis_unavailable' ? <p className="note" role="status">这段录音暂未分析成功，本次使用预设声音。可以返回资料页重新检查录音。</p> : current.audioSignalStatus && <p className="note">{audioObservationMessage(current.audioSignalStatus)}</p>}
      <div className="view-footer"><span>{current.retracted ? '这处线索已撤回；旧相遇仅供回看。' : current.cue === 'wait' ? '线索：回头等待' : current.cue === 'repair' ? '线索：修补物件' : '一般想象场景'}</span><div className="actions"><button className="quiet" onClick={() => setReplay(value => value + 1)}>重新观看</button>{current.id !== 'demo' && <><EvidenceCorrection evidenceId={current.evidenceId} retracted={current.retracted} busy={busy} onRetract={() => void retract()} /><button className="quiet" disabled={busy} onClick={() => void hide()}>移除这次回看</button><button disabled={busy} onClick={() => void begin(true)}>再相遇</button></>}</div></div>
      {current.id !== 'demo' && <Feedback key={current.id} episodeId={current.id} />}
      {error && <p className="error" role="alert">{error}</p>}
    </section>}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
