import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

function glb(path: string) {
  const bytes = readFileSync(`public/assets/quaternius/${path}.glb`)
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67)
  expect(bytes.readUInt32LE(4)).toBe(2)
  expect(bytes.readUInt32LE(8)).toBe(bytes.length)
  const length = bytes.readUInt32LE(12)
  return { document: JSON.parse(bytes.subarray(20, 20 + length).toString()), binary: bytes.subarray(28 + length) }
}

for (const path of ['base-character-v1/adult-male', 'peasant-male-v1/outfit', 'base-female-v1/adult-female', 'peasant-female-v1/outfit']) {
  it(`preserves every non-image buffer and rig in ${path}`, () => {
    const original = glb(path)
    const optimized = glb(`${path}-webp`)
    for (const key of ['meshes', 'nodes', 'skins', 'accessors', 'scenes']) expect(optimized.document[key]).toEqual(original.document[key])
    const images = new Set(original.document.images.map((image: { bufferView: number }) => image.bufferView))
    original.document.bufferViews.forEach((view: { byteOffset?: number; byteLength: number }, index: number) => {
      if (images.has(index)) return
      const next = optimized.document.bufferViews[index]
      expect(original.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength).equals(optimized.binary.subarray(next.byteOffset || 0, (next.byteOffset || 0) + next.byteLength))).toBe(true)
    })
    expect(optimized.document.extensionsRequired).toContain('EXT_texture_webp')
    for (const texture of optimized.document.textures) {
      const image = optimized.document.images[texture.extensions.EXT_texture_webp.source]
      expect(image.mimeType).toBe('image/webp')
      const view = optimized.document.bufferViews[image.bufferView]
      expect(optimized.binary.subarray(view.byteOffset, view.byteOffset + 4).toString()).toBe('RIFF')
      expect(optimized.binary.subarray(view.byteOffset + 8, view.byteOffset + 12).toString()).toBe('WEBP')
    }
  })
}
