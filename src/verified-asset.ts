export async function verifiedAsset(url: string, sha256: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('character_asset_unavailable')
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== sha256) throw new Error('character_asset_changed')
  return bytes
}
