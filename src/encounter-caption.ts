import type { Encounter } from './encounter'
import { spokenLine } from './encounter'
import { resolvePerformanceVersion } from './performance-catalog'

export function encounterCaption(encounter: Encounter, seconds: number) {
  if (encounter.performanceVersion === 'character-timeline-v3' && seconds < 12) return seconds < 1.3 ? '那个人慢慢坐下。' : seconds < 12 - 1.0333333015441895 ? '坐着歇一会儿，听风吹过。' : '那个人起身，准备往前走。'
  if (seconds < 12) return '风吹过小路。有人正在忙自己的事。'
  if (seconds < 28) return '那个人沿着路，慢慢往前走。'
  if (encounter.cue === 'repair' && resolvePerformanceVersion(encounter.performanceVersion) !== 'character-timeline-v1' && seconds < 43) return seconds < 33.2 ? '停下来，蹲下查看身旁的小木箱。' : '查看过木箱，起身歇一会儿。'
  if (seconds < 43) return encounter.cue === 'wait' ? '走出几步，又停下，回头等了一会儿。' : encounter.cue === 'repair' ? '停下来，耐心地把手里的东西修好。' : '停下来，望了望远处。'
  if (seconds < 55) return `“${spokenLine(encounter.cue)}”`
  return '那个人继续往前。你可以在这里多待一会儿。'
}
