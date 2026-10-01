export const currentPerformanceVersion = 'character-timeline-v4'
export type PerformanceVersion = 'character-timeline-v1' | 'character-timeline-v2' | 'character-timeline-v3' | 'character-timeline-v4'

export function resolvePerformanceVersion(version: string | undefined): PerformanceVersion {
  // Episodes created before the version field used the retained v1 timeline.
  if (version === undefined || version === 'character-timeline-v1') return 'character-timeline-v1'
  if (version === 'character-timeline-v2' || version === 'character-timeline-v3' || version === 'character-timeline-v4') return version
  throw new Error('unsupported_performance_version')
}
