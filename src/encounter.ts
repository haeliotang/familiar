import { limitMemoryText } from './memory-text'
import { currentPerformanceVersion } from './performance-catalog'
import { currentSceneVersion, sceneForEncounter, type SceneId } from './scene-catalog'
import { currentAvatarVersion, avatarVersionForEncounter } from './avatar-catalog'

export type Cue = 'wait' | 'repair' | 'general'

export function spokenLine(cue: Cue) {
  return cue === 'wait' ? '不用急，我走慢一点。' : cue === 'repair' ? '再试试，这下应该好了。' : '今天的风很好。'
}

export interface Encounter {
  id: string
  seed: number
  memory: string
  cue: Cue
  scene: SceneId
  durationSec: 75
  createdAt: string
  sceneVersion?: string
  manifestHash?: string
  manifestVerified?: boolean
  performanceVersion?: string
  avatarVersion?: string
  evidenceId?: string
  retracted?: boolean
  degraded?: boolean
  degradationReason?: string
  audioSignalStatus?: string
  personalizationLevel?: 'generic' | 'memory_based' | 'audio_rate_based' | 'memory_and_audio_rate_based'
}

export function cueFromMemory(memory: string): Cue {
  const clauses = memory.split(/[，。！？；,!?;\n]|但是|不过|可是|但/)
  const patterns = { wait: /回头|等我|等人|等你|落后|慢下脚步/, repair: /修理|修东西|修补|修好|修车|木工/ }
  for (const cue of ['wait', 'repair'] as const) {
    const matching = clauses.filter(clause => patterns[cue].test(clause))
    // A contradictory or negated clause cannot establish an affirmative cue.
    if (matching.length && matching.every(clause => !/不|没|未|并非|别|很少/.test(clause))) return cue
  }
  return 'general'
}

export function createEncounter(memory: string, previous: Encounter[] = []): Encounter {
  const normalized = limitMemoryText(memory.trim())
  if (!normalized) throw new Error('请先写下一句记忆，或进入示例体验。')
  const seed = Math.floor(Math.random() * 0xffffffff)
  return {
    id: crypto.randomUUID(), seed, memory: normalized,
    cue: cueFromMemory(normalized),
    scene: sceneForEncounter(previous.length),
    performanceVersion: currentPerformanceVersion,
    sceneVersion: currentSceneVersion,
    avatarVersion: avatarVersionForEncounter(previous.length),
    durationSec: 75,
    createdAt: new Date().toISOString(),
  }
}

export function demoEncounter(): Encounter {
  return {
    id: 'demo', seed: 1, memory: '', cue: 'general', scene: 'riverside',
    performanceVersion: currentPerformanceVersion,
    sceneVersion: currentSceneVersion,
    avatarVersion: currentAvatarVersion,
    durationSec: 75, createdAt: new Date().toISOString(),
  }
}
