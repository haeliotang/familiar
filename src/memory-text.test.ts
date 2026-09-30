import { expect, it } from 'vitest'
import { limitMemoryText, memoryCharacterCount } from './memory-text'

it('counts supplementary Unicode characters once and preserves the 500-character boundary', () => {
  const text = '甲'.repeat(499) + '🙂'
  expect(memoryCharacterCount(text)).toBe(500)
  expect(limitMemoryText(text + '乙')).toBe(text)
  expect(memoryCharacterCount(limitMemoryText('🙂'.repeat(501)))).toBe(500)
})

it('counts code points consistently for combining characters rather than visual glyphs', () => {
  expect(memoryCharacterCount('e\u0301')).toBe(2)
  expect(limitMemoryText('甲'.repeat(499) + '𠀀')).toBe('甲'.repeat(499) + '𠀀')
})
