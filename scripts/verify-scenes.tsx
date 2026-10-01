import { useRef, useState } from 'react'
import { frameMeasurement } from '../src/frame-measurement'
import { createRoot } from 'react-dom/client'
import { Scene } from '../src/scene'
import { demoEncounter, type Cue } from '../src/encounter'
import { candidateSceneIds, sceneLabels, type SceneId } from '../src/scene-catalog'
import { sittingMaleAvatarVersion, sittingFemaleAvatarVersion, pickupMaleAvatarVersion, pickupFemaleAvatarVersion, compactMaleAvatarVersion, compactFemaleAvatarVersion, currentAvatarVersion, femaleAvatarVersion } from '../src/avatar-catalog'

function SceneReview() {
  const [scene, setScene] = useState<SceneId>('riverside')
  const [visible, setVisible] = useState(true)
  const [reviewTime, setReviewTime] = useState(5)
  const measurement = useRef<ReturnType<typeof frameMeasurement> | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [reportText, setReportText] = useState('')
  const query = new URLSearchParams(location.search)
  const sitting = query.get('actions') === 'sitting'
  const pickup = query.get('actions') === 'pickup'
  const compact = query.get('textures') === 'mobile'
  const female = query.get('character') === 'female'
  const close = query.get('close') === '1'
  const cue: Cue = query.get('cue') === 'repair' ? 'repair' : query.get('cue') === 'wait' ? 'wait' : 'general'
  const encounter = { ...demoEncounter(), scene, cue, avatarVersion: compact ? female ? compactFemaleAvatarVersion : compactMaleAvatarVersion : pickup ? female ? pickupFemaleAvatarVersion : pickupMaleAvatarVersion : sitting ? female ? sittingFemaleAvatarVersion : sittingMaleAvatarVersion : female ? femaleAvatarVersion : currentAvatarVersion, ...(pickup || compact ? { performanceVersion: 'character-timeline-v4' } : sitting ? { performanceVersion: 'character-timeline-v3' } : {}) }
  return <main>
    <h1>六场景候选审核</h1>
    <p>合成示例 · 固定种子 1 · 成人{female ? '女性' : '男性'}角色{pickup ? ' · 拿取动作候选' : sitting ? ' · 坐下动作候选' : ''}{compact ? ' · 1024 纹理候选' : ''} · 尚未通过素材发布验收。</p>
    <nav aria-label="选择审核场景">{candidateSceneIds.map(id => <button key={id} disabled={measuring} aria-pressed={scene === id} onClick={() => { setScene(id); setVisible(true) }}>{sceneLabels[id]}</button>)}</nav>
    <h2>{sceneLabels[scene]}</h2>
    {close && <label>动作时间（秒）<input type="number" min="0" max="75" step="0.1" value={reviewTime} onChange={event => { const time = Number(event.target.value); if (Number.isFinite(time) && time >= 0 && time <= 75) setReviewTime(time) }} /></label>}
    <button onClick={() => setVisible(!visible)}>{visible ? '退出场景' : '重新进入场景'}</button>
    {!close && <><button disabled={measuring || !visible} onClick={() => { measurement.current = frameMeasurement(); setMeasuring(true) }}>开始记录渲染帧</button><button disabled={!measuring} onClick={() => {
      const report = measurement.current?.report()
      measurement.current = null
      setMeasuring(false)
      const text = JSON.stringify({ recordedAt: new Date().toISOString(), userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio, scene, avatarVersion: encounter.avatarVersion, performanceVersion: encounter.performanceVersion, seed: encounter.seed, cue, ...report }, null, 2)
      setReportText(text)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'familiar-render-frames.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>结束并下载记录</button><p>请保持页面可见，记录至少90秒。先开启播放；75秒结束后的停留也会记录。报告保留暂停和隐藏状态，不等于持续动作或手机验收结论。测量期间不要切换场景。</p></>}
    {reportText && <details><summary>本次原始帧记录</summary><textarea aria-label="本次原始帧记录" readOnly rows={10} style={{ width: '100%' }} value={reportText} /></details>}
    {visible ? <Scene key={scene} encounter={encounter} onRenderedFrame={(atMs, playback) => measurement.current?.record(atMs, document.visibilityState === 'visible', playback)} review={close ? pickup ? { seconds: reviewTime, eye: [2.4, 1.3, .6], target: [0, .9, -2.4] } : { seconds: reviewTime, eye: [2.4, 1.3, -15], target: [0, .9, -18] } : undefined} /> : <p role="status">已退出，可以重新进入检查。</p>}
    <p>需逐个检查全路线、转身、近处遮挡、退出重进和真实手机表现。此页面不自动给出通过结论。</p>
  </main>
}

const style = document.createElement('style')
style.textContent = 'body{margin:0;background:#eeeae0;color:#29352d;font:16px system-ui}main{max-width:1100px;margin:auto;padding:16px}button{padding:10px;margin:4px}button[aria-pressed=true]{background:#c9d8bd}.scene{width:100%;height:60vh;min-height:300px}.scene canvas{display:block}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.subtitle{min-height:2em;padding:8px}'
document.head.append(style)
createRoot(document.getElementById('root')!).render(<SceneReview />)
