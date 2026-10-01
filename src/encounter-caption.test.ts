import { expect, it } from 'vitest'
import { demoEncounter } from './encounter'
import { encounterCaption } from './encounter-caption'

it('changes the v2 repair caption when the complete action ends and preserves the v1 caption', () => {
  const encounter = { ...demoEncounter(), cue: 'repair' as const }
  expect(encounterCaption(encounter, 31)).toContain('蹲下')
  expect(encounterCaption(encounter, 34)).toContain('起身')
  expect(encounterCaption(encounter, 40)).not.toContain('修好')
  expect(encounterCaption({ ...encounter, performanceVersion: undefined }, 40)).toContain('修好')
})

it('describes taking and replacing only in the new general performance', () => {
  const encounter = { ...demoEncounter(), cue: 'general' as const, performanceVersion: 'character-timeline-v4' }
  expect(encounterCaption(encounter, 30)).toContain('拿起')
  expect(encounterCaption(encounter, 31.3)).toContain('放回')
  expect(encounterCaption(encounter, 33)).not.toContain('放回')
  expect(encounterCaption({ ...encounter, performanceVersion: 'character-timeline-v3' }, 30)).not.toContain('拿起')
  expect(encounterCaption({ ...encounter, cue: 'wait' }, 30)).toContain('等')
})
