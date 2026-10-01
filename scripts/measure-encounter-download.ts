import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { avatarAssets, pickupMaleAvatarVersion, pickupFemaleAvatarVersion, compactMaleAvatarVersion, compactFemaleAvatarVersion } from '../src/avatar-catalog'
import { voiceVersionForAvatar } from '../src/voice-catalog'

// Sum uncompressed file bytes, without treating throughput estimates as measurements.
const application = ['dist/index.html', ...(await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name)).map(name => `dist/assets/${name}`)]
const results = []
for (const version of [pickupMaleAvatarVersion, pickupFemaleAvatarVersion, compactMaleAvatarVersion, compactFemaleAvatarVersion]) {
  const assets = avatarAssets(version)
  for (const cue of ['general', 'wait', 'repair']) {
    const paths = [...application, ...['head', 'body', 'animations', 'motion'].map(name => `public${assets[name as 'head' | 'body' | 'animations' | 'motion']}`), `public/assets/voices/${voiceVersionForAvatar(version)}/${cue}.wav`]
    const files = await Promise.all(paths.map(async path => {
      const bytes = await readFile(path)
      return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
    results.push({ version, cue, bytes, within12MB: bytes <= 12_000_000, files })
  }
}
await writeFile('docs/verification/encounter-download-bytes.json', JSON.stringify({ scope: 'built application + selected avatar files + one standard voice; excludes HTTP overhead, API JSON, private uploads and generated cadence voice; no network timing or device result', results }, null, 2) + '\n')
console.log(JSON.stringify(results.map(({ version, cue, bytes, within12MB }) => ({ version, cue, bytes, within12MB })), null, 2))
