import { createRepairCrate } from './repair-prop'
import { encounterCaption } from './encounter-caption'
import { resolvePerformanceVersion } from './performance-catalog'
import { sceneLayout } from './scene-catalog'
import { createPlaceProps } from './place-props'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Encounter } from './encounter'
import { samplePlayback } from './sample-playback'
import { disposeScene } from './dispose-scene'
import { spatialVoice, updateVoiceListener } from './spatial-voice'
import { viewingPose, type ViewingPosition } from './viewing-position'
import { loadCharacter } from './load-character'
import { characterTimeline } from './character-timeline'
import { groundCharacter } from './ground-character'
import { createReviewSeat } from './review-seat'
import { createEncounterSun } from './encounter-sun'
import { encounterVoiceBytes } from './encounter-voice'

export function Scene({ encounter, review }: { encounter: Encounter; review?: { seconds: number; eye: readonly [number, number, number]; target: readonly [number, number, number] } }) {
  const mount = useRef<HTMLDivElement>(null)
  const reviewFrame = useRef(review)
  reviewFrame.current = review
  const [seconds, setSeconds] = useState(0)
  const [characterState, setCharacterState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [playback, setPlayback] = useState<'loading' | 'ready' | 'unlocking' | 'playing' | 'paused' | 'unavailable' | 'finished'>('loading')
  const context = useRef<AudioContext | null>(null)
  const buffer = useRef<AudioBuffer | null>(null)
  const player = useRef<ReturnType<typeof samplePlayback> | null>(null)
  const operation = useRef(0)
  const busy = useRef(false)
  const voicePosition = useRef<PannerNode | null>(null)
  const startAt = useRef(0)
  const muted = useRef(false)
  const view = useRef<{ position: ViewingPosition; turn: number }>({ position: 'original', turn: 0 })

  useEffect(() => {
    setSeconds(0)
    setPlayback('loading')
    let active = true
    const audioContext = new AudioContext()
    context.current = audioContext
    void (async () => {
      try {
        const decoded = await audioContext.decodeAudioData(await encounterVoiceBytes(encounter))
        if (active) { buffer.current = decoded; setPlayback('ready') }
      } catch { if (active) setPlayback('unavailable') }
    })()
    return () => {
      active = false
      operation.current++
      busy.current = false
      player.current?.dispose()
      player.current = null
      context.current = null
      buffer.current = null
      void audioContext.close()
    }
  }, [encounter.id, encounter.avatarVersion, encounter.cue])

  useEffect(() => {
    if (playback !== 'playing') return
    const timer = window.setInterval(() => {
      const elapsed = muted.current ? Math.min(performance.now() / 1000 - startAt.current, encounter.durationSec) : player.current?.time ?? 0
      setSeconds(elapsed)
      if (elapsed >= encounter.durationSec) setPlayback('finished')
    }, 50)
    return () => window.clearInterval(timer)
  }, [playback, encounter.durationSec])

  async function start() {
    if (characterState !== 'ready') return
    const audioContext = context.current
    if (!audioContext) return
    if (playback === 'unavailable') {
      muted.current = true
      startAt.current = performance.now() / 1000
      setSeconds(0)
      setPlayback('playing')
      return
    }
    if (playback === 'paused' && muted.current) {
      startAt.current = performance.now() / 1000 - seconds
      setPlayback('playing')
      return
    }
    if (busy.current) return
    busy.current = true
    const ticket = ++operation.current
    setPlayback('unlocking')
    let timeout: number | undefined
    try {
      if (!player.current) {
        if (!buffer.current || !voicePosition.current) throw new Error('spatial_voice_unavailable')
        player.current = samplePlayback(audioContext, buffer.current, voicePosition.current)
      }
      const current = player.current
      await Promise.race([
        playback === 'paused' ? current.resume() : current.start(),
        new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error('audio_unlock_timeout')), 3000) }),
      ])
      if (ticket !== operation.current) return
      muted.current = false
      setSeconds(current.time)
      setPlayback('playing')
    } catch {
      if (ticket !== operation.current) return
      player.current?.dispose()
      player.current = null
      setPlayback('unavailable')
    } finally {
      window.clearTimeout(timeout)
      if (ticket === operation.current) busy.current = false
    }
  }

  async function pause() {
    if (busy.current) return
    busy.current = true
    const ticket = ++operation.current
    try {
      if (!muted.current) await player.current?.pause()
      if (ticket === operation.current) setPlayback('paused')
    } catch {
      if (ticket === operation.current) {
        player.current?.dispose()
        player.current = null
        setPlayback('unavailable')
      }
    } finally {
      if (ticket === operation.current) busy.current = false
    }
  }

  async function restart() {
    if (busy.current) return
    busy.current = true
    const ticket = ++operation.current
    try {
      await player.current?.stop()
      if (ticket !== operation.current) return
      muted.current = false
      setSeconds(0)
      setPlayback(buffer.current ? 'ready' : 'unavailable')
    } catch {
      if (ticket === operation.current) {
        player.current?.dispose()
        player.current = null
        setPlayback('unavailable')
      }
    } finally {
      if (ticket === operation.current) busy.current = false
    }
  }

  useEffect(() => {
    const host = mount.current
    if (!host) return
    const layout = sceneLayout(encounter.sceneVersion, encounter.scene, encounter.seed)
    view.current = { position: 'original', turn: 0 }
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(layout.background)
    scene.fog = new THREE.Fog(scene.background, 14, 42)
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
    camera.position.set(...layout.cameraPosition)
    camera.lookAt(...layout.cameraTarget)
    const direction = camera.getWorldDirection(new THREE.Vector3())
    const cameraUp = camera.up.clone().applyQuaternion(camera.quaternion)
    const panner = context.current ? spatialVoice(context.current, camera.position.toArray(), direction.toArray(), cameraUp.toArray()) : null
    voicePosition.current = panner
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    host.appendChild(renderer.domElement)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x58644c, 2.2))
    const sun = createEncounterSun()
    scene.add(sun)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: layout.groundColor }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 60), new THREE.MeshStandardMaterial({ color: 0xc4b59a, roughness: 1 }))
    path.rotation.x = -Math.PI / 2
    path.receiveShadow = true
    path.position.y = 0.01
    scene.add(path)
    if (layout.props) scene.add(createPlaceProps(layout.props))
    if (layout.water) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(18, 30), new THREE.MeshStandardMaterial({ color: 0x7ca6a2, metalness: 0.15, roughness: 0.3 }))
      water.rotation.x = -Math.PI / 2
      water.position.set(-11, 0.015, 0)
      scene.add(water)
    }
    const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x5b7152 })
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x695b45 })
    for (const { x, z } of layout.trees) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2), trunkMaterial)
      trunk.position.set(x, 1, z)
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 7), treeMaterial)
      crown.position.set(x, 2.4, z)
      scene.add(trunk, crown)
    }

    let active = true
    const repair = encounter.cue === 'repair' && resolvePerformanceVersion(encounter.performanceVersion) !== 'character-timeline-v1'
    if (encounter.performanceVersion === 'character-timeline-v3') {
      const { seat } = createReviewSeat()
      seat.position.set(0, path.position.y, -18.33)
      scene.add(seat)
    }
    let loaded: Awaited<ReturnType<typeof loadCharacter>> | undefined
    let motion: ReturnType<typeof characterTimeline> | undefined
    let speechDuration = -1
    const bounds = new THREE.Box3()
    setCharacterState('loading')
    void loadCharacter(encounter.avatarVersion, encounter.performanceVersion).then(result => {
      if (!active) { result.dispose(); return }
      loaded = result
      scene.add(result.character)
      if (repair) scene.add(createRepairCrate(encounter.avatarVersion!, result.walkingSpeed))
      setCharacterState('ready')
    }).catch(() => { if (active) setCharacterState('failed') })
    if (!repair) {
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0x927352 }))
      basket.position.set(0.8, 0.25, -1.5)
      scene.add(basket)
    }
    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const t = Number(host.dataset.seconds || '0')
      const viewpoint = viewingPose(reviewFrame.current?.eye ?? layout.cameraPosition, reviewFrame.current?.target ?? layout.cameraTarget, view.current.position, view.current.turn)
      camera.position.copy(viewpoint.eye)
      camera.lookAt(viewpoint.target)
      if (context.current) {
        camera.getWorldDirection(direction)
        cameraUp.copy(camera.up).applyQuaternion(camera.quaternion)
        updateVoiceListener(context.current, camera.position.toArray(), direction.toArray(), cameraUp.toArray())
      }
      if (loaded) {
        const duration = buffer.current?.duration ?? 12
        if (!motion || duration !== speechDuration) {
          motion?.dispose()
          motion = characterTimeline(loaded.character, loaded.clips, loaded.walkingSpeed, duration, resolvePerformanceVersion(encounter.performanceVersion))
          speechDuration = duration
        }
        motion.pose(t, encounter.cue)
        groundCharacter(loaded.character, bounds, path.position.y)
        if (panner) {
          panner.positionX.value = loaded.character.position.x
          panner.positionY.value = loaded.character.position.y + 1.65
          panner.positionZ.value = loaded.character.position.z
        }
      }
      renderer.render(scene, camera)
    }
    animate()
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      panner?.disconnect()
      if (voicePosition.current === panner) voicePosition.current = null
      renderer.dispose()
      host.removeChild(renderer.domElement)
      motion?.dispose()
      loaded?.dispose()
      disposeScene(scene)
    }
  }, [encounter.id, encounter.scene, encounter.cue, encounter.avatarVersion, encounter.sceneVersion, encounter.seed, encounter.performanceVersion])

  return <>
    <div className="scene" ref={mount} data-seconds={review?.seconds ?? seconds} aria-label="一段风格化的三维相遇场景" />
    {!review && <div className="controls" aria-label="观看位置">
      <button className="quiet" onClick={() => { view.current.turn = Math.min(Math.PI / 3, view.current.turn + Math.PI / 12) }}>向左看</button>
      <button className="quiet" onClick={() => { view.current.turn = Math.max(-Math.PI / 3, view.current.turn - Math.PI / 12) }}>向右看</button>
      <button className="quiet" onClick={() => { view.current.position = 'near' }}>靠近看</button>
      <button className="quiet" onClick={() => { view.current.position = 'seated' }}>坐下看</button>
      <button className="quiet" onClick={() => { view.current = { position: 'original', turn: 0 } }}>回到原处</button>
    </div>}
    <div className="subtitle" aria-live="polite">{characterState === 'ready' ? encounterCaption(encounter, review?.seconds ?? seconds) : ''}</div>
    {review ? <p role="status">{characterState === 'ready' ? '人物已加载 · 定格审核' : characterState === 'failed' ? '人物加载失败' : '正在准备人物…'}</p> :
    <div className="controls"><span>{Math.floor(seconds / 60)}:{String(Math.floor(seconds) % 60).padStart(2, '0')} / 1:15</span>{characterState === 'loading' ? <span>正在准备人物…</span> : characterState === 'failed' ? <><span role="alert">{encounter.avatarVersion ? '人物暂时无法加载，或该版本尚不支持。' : '这次旧相遇未保存人物版本，无法还原当时的人物。'}</span>{encounter.avatarVersion && <button onClick={() => window.location.reload()}>重新加载</button>}</> : playback === 'loading' || playback === 'unlocking' ? <span>{playback === 'loading' ? '正在准备本地语音…' : '正在开启声音…'}</span> : playback === 'ready' ? <button onClick={() => void start()}>开启声音并开始</button> : playback === 'unavailable' ? <button onClick={() => void start()}>语音暂不可用 · 无声开始</button> : playback === 'playing' ? <><button className="quiet" onClick={() => void pause()}>暂停</button>{muted.current && <span>无声播放</span>}</> : playback === 'paused' ? <button className="quiet" onClick={() => void start()}>继续</button> : <span>相遇结束，可以在这里停留。</span>}{characterState === 'ready' && playback !== 'loading' && playback !== 'unlocking' && <button className="quiet" onClick={() => void restart()}>从头看</button>}</div>
    }
  </>
}
