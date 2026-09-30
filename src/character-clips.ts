import { AnimationClip } from 'three'

export function parseCharacterClips(library: { clips: ReturnType<typeof AnimationClip.toJSON>[] }) {
  return library.clips.map(clip => AnimationClip.parse(clip))
}
