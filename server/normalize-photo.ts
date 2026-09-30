import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

export class PhotoDecoderUnavailable extends Error {}

export async function normalizePhoto(input: string, output: string) {
  const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata()
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp', 'heif'].includes(metadata.format || '')) throw new Error('invalid_image')
  let temporary: string | undefined
  try {
    let decoded = input
    if (metadata.format === 'heif') {
      temporary = await mkdtemp(join(dirname(output), '.photo-'))
      decoded = join(temporary, 'decoded.png')
      try {
        await run('heif-convert', ['--quiet', input, decoded], { timeout: 30_000, maxBuffer: 1024 * 1024 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new PhotoDecoderUnavailable('photo_decoder_unavailable')
        throw error
      }
    }
    await sharp(decoded, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(output)
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
