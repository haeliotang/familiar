import { expect, it } from 'vitest'
import { resolvePerformanceVersion } from './performance-catalog'

it('retains the old timeline when a legacy record lacks the new version field', () => {
  expect(resolvePerformanceVersion(undefined)).toBe('character-timeline-v1')
  expect(resolvePerformanceVersion('character-timeline-v1')).toBe('character-timeline-v1')
  expect(resolvePerformanceVersion('character-timeline-v2')).toBe('character-timeline-v2')
  expect(resolvePerformanceVersion('character-timeline-v3')).toBe('character-timeline-v3')
  expect(resolvePerformanceVersion('character-timeline-v4')).toBe('character-timeline-v4')
})

it('rejects an unrecognized performance version', () => {
  expect(() => resolvePerformanceVersion('future')).toThrow('unsupported_performance_version')
})
