import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { AnimationClip } from 'three'

// Publish into a new directory; recorded seven-clip episodes keep their original bytes.
for (const gender of ['male', 'female']) {
  const paths = [`/assets/quaternius/peasant-${gender}-sitting-v2/animations.json`, `/assets/quaternius/peasant-${gender}-v1/interaction-candidate-v1/animations.json`]
  const bytes = await Promise.all(paths.map(path => readFile(`public${path}`)))
  const [retained, candidates] = bytes.map(value => JSON.parse(value.toString()))
  const pickup = candidates.clips.find((clip: { name: string }) => clip.name === 'PickUp_Table')
  if (!pickup) throw new Error(`missing_pickup_clip:${gender}`)
  const clips = [...retained.clips, pickup]
  if (clips.length !== 8 || new Set(clips.map(clip => clip.name)).size !== 8 || clips.some(clip => !AnimationClip.parse(clip).validate())) throw new Error(`invalid_pickup_package:${gender}`)
  const directory = `public/assets/quaternius/peasant-${gender}-pickup-v3`
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/animations.json`, JSON.stringify({ status: 'runtime-review-candidate', inputs: paths.map((path, index) => ({ path, sha256: createHash('sha256').update(bytes[index]).digest('hex') })), clips }))
}
