import { afterEach, describe, expect, it, vi } from 'vitest'
import { preparationWaitState, savedPreparation, savePreparation } from './preparation-progress'

afterEach(() => vi.unstubAllGlobals())
describe('preparation recovery metadata', () => {
  it('keeps the 40 and 60 second boundaries explicit', () => {
    expect(preparationWaitState(39_999)).toBe('waiting')
    expect(preparationWaitState(40_000)).toBe('slow')
    expect(preparationWaitState(59_999)).toBe('slow')
    expect(preparationWaitState(60_000)).toBe('timeout')
  })
  it('restores only request metadata and clears discarded requests', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
    const request = { personId: 'synthetic-person', key: 'synthetic-request', submittedAt: 123 }
    savePreparation(request)
    expect(savedPreparation()).toEqual(request)
    savePreparation(null)
    expect(savedPreparation()).toBeNull()
    storage.set('ordinary-friend-pending-preparation-v1', '{invalid')
    expect(savedPreparation()).toBeNull()
  })
})
