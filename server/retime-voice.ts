import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
export async function retimeVoice(audio: Buffer, speed: number) {
  if (!Number.isFinite(speed) || speed < .8 || speed > 1.2 || audio.length < 44 || audio.length > 30 * 1024 * 1024 || audio.toString('ascii', 0, 4) !== 'RIFF') throw new Error('unsupported_voice_parameters')
  if (speed === 1) return audio
  const root = await mkdtemp(join(tmpdir(), 'friend-retime-'))
  try {
    const input = join(root, 'standard.wav')
    const output = join(root, 'retimed.wav')
    await writeFile(input, audio)
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-af', `atempo=${speed}`, '-c:a', 'pcm_s16le', '-map_metadata', '-1', output], { timeout: 10000, maxBuffer: 1024 * 1024 })
    return await readFile(output)
  } finally { await rm(root, { recursive: true, force: true }) }
}
