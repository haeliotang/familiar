import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const directory = 'public/assets/quaternius'
const female = process.argv.includes('--female')
const mobile = process.argv.includes('--mobile-candidate')
const measurements = []
for (const path of female ? ['base-female-v1/adult-female', 'peasant-female-v1/outfit'] : ['base-character-v1/adult-male', 'peasant-male-v1/outfit']) {
  const source = await readFile(`${directory}/${path}.glb`)
  const jsonLength = source.readUInt32LE(12)
  const document = JSON.parse(source.subarray(20, 20 + jsonLength).toString())
  const binary = source.subarray(28 + jsonLength)
  const imageViews = new Set<number>(document.images.map((image: { bufferView: number }) => image.bufferView))
  const chunks: Buffer[] = []
  let length = 0
  const insert = (data: Buffer) => {
    const padding = (4 - length % 4) % 4
    chunks.push(Buffer.alloc(padding), data)
    length += padding
    const offset = length
    length += data.length
    return offset
  }
  // Preserve all geometry, skin and bind-pose bytes without loss.
  for (let index = 0; index < document.bufferViews.length; index++) {
    if (imageViews.has(index)) continue
    const view = document.bufferViews[index]
    view.byteOffset = insert(binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength))
  }
  for (const image of document.images) {
    const view = document.bufferViews[image.bufferView]
    const original = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)
    const sampled = mobile ? await sharp(original).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer() : original
    const encoded = await sharp(sampled).webp({ lossless: true, effort: 6 }).toBuffer()
    // Confirm exact decoded pixel identity, including alpha, before writing.
    const before = await sharp(sampled).ensureAlpha().raw().toBuffer()
    const after = await sharp(encoded).ensureAlpha().raw().toBuffer()
    if (!before.equals(after)) throw new Error(`Texture pixels changed: ${image.name}`)
    view.byteOffset = insert(encoded)
    view.byteLength = encoded.length
    image.mimeType = 'image/webp'
  }
  for (const texture of document.textures) {
    texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } }
    delete texture.source
  }
  document.extensionsUsed = [...new Set([...(document.extensionsUsed || []), 'EXT_texture_webp'])]
  document.extensionsRequired = [...new Set([...(document.extensionsRequired || []), 'EXT_texture_webp'])]
  document.buffers = [{ byteLength: length }]
  const json = Buffer.from(JSON.stringify(document))
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const data = Buffer.concat([...chunks, Buffer.alloc((4 - length % 4) % 4)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + paddedJson.length + data.length, 8)
  header.writeUInt32LE(paddedJson.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const chunkHeader = Buffer.alloc(8)
  chunkHeader.writeUInt32LE(data.length, 0)
  chunkHeader.writeUInt32LE(0x004e4942, 4)
  const optimized = Buffer.concat([header, paddedJson, chunkHeader, data])
  const suffix = mobile ? 'mobile-v2' : 'webp'
  await writeFile(`${directory}/${path}-${suffix}.glb`, optimized)
  measurements.push({ path: `${path}-${suffix}.glb`, sourceSha256: createHash('sha256').update(source).digest('hex'), sha256: createHash('sha256').update(optimized).digest('hex'), sourceBytes: source.length, bytes: optimized.length, pixels: mobile ? 'exact decoded RGBA match to resized texture; original detail reduced to at most 1024 pixels per side' : 'exact decoded RGBA match', extension: 'EXT_texture_webp' })
}
await writeFile(`${directory}/optimization${female ? '-female' : ''}${mobile ? '-mobile' : ''}.json`, JSON.stringify({ method: mobile ? '1024px texture sampling and lossless WebP; geometry and rig bytes unchanged' : 'lossless WebP textures; geometry and rig bytes unchanged', status: 'candidate; browser and device compatibility review required', measurements }, null, 2) + '\n')
console.log(JSON.stringify(measurements, null, 2))
