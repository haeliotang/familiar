import { expect, it } from 'vitest'
import { manifestContent } from './manifest'

it('fingerprints the entire manifest without its own hash and ignores key order', () => {
  const first = { seed: 42, scene: { id: 'riverside', version: 'v1' }, manifestHash: 'previous' }
  expect(manifestContent(first)).toBe(manifestContent({ scene: { version: 'v1', id: 'riverside' }, seed: 42 }))
  expect(manifestContent(first)).not.toBe(manifestContent({ ...first, seed: 43 }))
  expect(manifestContent(first)).not.toBe(manifestContent({ ...first, scene: { id: 'riverside', version: 'v2' } }))
})
