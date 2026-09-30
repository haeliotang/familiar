// Canonical JSON keeps object key order out of the episode fingerprint.
export function manifestContent(manifest: Record<string, unknown>) {
  const { manifestHash: _hash, ...content } = manifest
  function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)]))
    return value
  }
  return JSON.stringify(sorted(content))
}
