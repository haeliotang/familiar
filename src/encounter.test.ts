import { describe, expect, it } from 'vitest'
import { createEncounter, cueFromMemory } from './encounter'

describe('encounter', () => {
  it('only maps supported memory cues', () => {
    expect(cueFromMemory('他总会回头等我')).toBe('wait')
    expect(cueFromMemory('她喜欢修东西')).toBe('repair')
    expect(cueFromMemory('他喜欢蓝色')).toBe('general')
  })

  it('keeps a published encounter stable and varies the next scene', () => {
    const first = createEncounter('他总会回头等我')
    const copy = JSON.parse(JSON.stringify(first))
    expect(copy).toEqual(first)
    expect(createEncounter(first.memory, [first]).scene).not.toBe(first.scene)
  })

  it('requires a memory for a personal encounter', () => {
    expect(() => createEncounter('  ')).toThrow()
  })
})

it('keeps 500 Unicode characters without cutting a supplementary character in half', () => {
  const text = '甲'.repeat(499) + '🙂'
  expect(createEncounter(text + '乙').memory).toBe(text)
  expect(createEncounter('🙂'.repeat(500)).memory).toBe('🙂'.repeat(500))
})

describe('memory cue attribution boundaries', () => {
  it.each(['他从不修东西', '她不会修车', '他没有修好那件东西', '她不喜欢木工', '不要安排修补动作', '他从来不回头等我', '她不会等你', '他没慢下脚步'])('does not turn negated text into a positive action: %s', text => {
    expect(cueFromMemory(text)).toBe('general')
  })
  it('uses a separate affirmative clause while rejecting contradictory cues', () => {
    expect(cueFromMemory('他不会修东西，但总会回头等我')).toBe('wait')
    expect(cueFromMemory('她不等人，但喜欢修东西')).toBe('repair')
    expect(cueFromMemory('他会回头等我，也从不回头等我')).toBe('general')
  })
})
