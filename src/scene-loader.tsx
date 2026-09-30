import { resolvePerformanceVersion } from './performance-catalog'
import { sceneLayout } from './scene-catalog'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { Encounter } from './encounter'

const Scene = lazy(() => import('./scene').then(module => ({ default: module.Scene })))

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="scene-placeholder" role="alert"><p>暂时无法打开场景。可以返回，或重新加载页面。</p><button onClick={() => window.location.reload()}>重新加载</button></div>
    return this.props.children
  }
}

export function SceneView({ encounter, replay }: { encounter: Encounter; replay: number }) {
  try { sceneLayout(encounter.sceneVersion, encounter.scene, encounter.seed) }
  catch { return <div className="scene-placeholder" role="alert">{encounter.sceneVersion ? '这次相遇的场景版本暂不支持，无法还原。' : '这次旧相遇未保存场景版本，无法还原当时的场景。'}</div> }
  try { resolvePerformanceVersion(encounter.performanceVersion) }
  catch { return <div className="scene-placeholder" role="alert">这次相遇的动作版本暂不支持，无法还原。</div> }
  if (encounter.id !== 'demo' && !encounter.manifestVerified) return <div className="scene-placeholder" role="alert">这次相遇的记录校验未通过，暂时无法播放。</div>
  return <SceneBoundary key={encounter.id}><Suspense fallback={<div className="scene-placeholder" role="status">正在打开场景…</div>}>
    <Scene key={`${encounter.id}-${replay}-${encounter.retracted}`} encounter={encounter} />
  </Suspense></SceneBoundary>
}
