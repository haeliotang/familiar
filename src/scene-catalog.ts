export const currentSceneVersion = 'procedural-places-v3'
export const candidateSceneIds = ['riverside', 'courtyard', 'farm', 'workshop', 'cabin', 'market'] as const
export type SceneId = typeof candidateSceneIds[number]
export const sceneLabels: Record<SceneId, string> = { riverside: '河岸小路', courtyard: '旧时庭院', farm: '农庄边缘', workshop: '木工角落', cabin: '山间小屋', market: '集市收摊时' }
export type SceneProp = { shape: 'box' | 'cylinder' | 'cone'; size: [number, number, number]; position: [number, number, number]; color: number; rotationY?: number }

const places: Record<SceneId, { background: string; groundColor: number; props: SceneProp[] }> = {
  riverside: { background: '#b2c6bc', groundColor: 0x758b70, props: [
    { shape: 'box', size: [2.2, .15, .5], position: [4.6, .6, -1], color: 0x8d7254 },
    { shape: 'box', size: [.15, .6, .5], position: [3.8, .3, -1], color: 0x695b45 },
    { shape: 'box', size: [.15, .6, .5], position: [5.4, .3, -1], color: 0x695b45 },
  ] },
  courtyard: { background: '#c3b8a3', groundColor: 0x9b8a6e, props: [
    { shape: 'box', size: [.4, 2.3, 18], position: [-6.4, 1.15, -3], color: 0xb7a78d },
    { shape: 'box', size: [4, 2.8, 4], position: [6, 1.4, -5], color: 0xc8b69b },
    { shape: 'cone', size: [5, 1.4, 5], position: [6, 3.5, -5], color: 0x786a58, rotationY: Math.PI / 4 },
    { shape: 'cylinder', size: [1.3, .7, 1.3], position: [-4, .35, 0], color: 0x8e8372 },
  ] },
  farm: { background: '#c7d0b1', groundColor: 0x929567, props: [
    { shape: 'box', size: [5, .1, 10], position: [-6.5, .05, -3], color: 0x655741 },
    { shape: 'box', size: [.4, .45, 10], position: [-4.7, .25, -3], color: 0x82934c },
    { shape: 'box', size: [.4, .45, 10], position: [-6.2, .25, -3], color: 0x82934c },
    { shape: 'box', size: [.4, .45, 10], position: [-7.7, .25, -3], color: 0x82934c },
    { shape: 'box', size: [5, .15, .15], position: [6, 1, -3], color: 0xa58b62 },
    { shape: 'box', size: [.15, 1.3, .15], position: [3.6, .65, -3], color: 0xa58b62 },
    { shape: 'box', size: [.15, 1.3, .15], position: [8.4, .65, -3], color: 0xa58b62 },
  ] },
  workshop: { background: '#b9bdb0', groundColor: 0x918575, props: [
    { shape: 'box', size: [2.7, .18, 1.2], position: [4.7, 1.05, -1.5], color: 0xa58259 },
    { shape: 'box', size: [.18, 1, 1], position: [3.6, .5, -1.5], color: 0x6b5945 },
    { shape: 'box', size: [.18, 1, 1], position: [5.8, .5, -1.5], color: 0x6b5945 },
    { shape: 'box', size: [2, .25, .35], position: [4.7, 1.27, -1.5], color: 0xc4a879 },
    { shape: 'box', size: [3, .35, 1.2], position: [-4.8, .175, -2], color: 0x8a6948 },
    { shape: 'box', size: [3, .35, 1], position: [-4.8, .525, -2], color: 0x9c7d56 },
  ] },
  cabin: { background: '#aabdb8', groundColor: 0x74816a, props: [
    { shape: 'box', size: [4, 2.8, 4], position: [6, 1.4, -4], color: 0x887258 },
    { shape: 'cone', size: [5, 1.7, 5], position: [6, 3.65, -4], color: 0x5f685a, rotationY: Math.PI / 4 },
    { shape: 'box', size: [1, 1.8, .1], position: [6, .9, -1.95], color: 0x574b3b },
    { shape: 'cone', size: [10, 8, 10], position: [-10, 4, -16], color: 0x83938a },
    { shape: 'cone', size: [12, 10, 12], position: [11, 5, -20], color: 0x91a19a },
  ] },
  market: { background: '#d0bd9f', groundColor: 0xa69272, props: [
    { shape: 'box', size: [2.5, .15, 1.4], position: [4.5, .9, -1], color: 0x967554 },
    { shape: 'box', size: [.15, 2.5, .15], position: [3.3, 1.25, -1.6], color: 0x7b624a },
    { shape: 'box', size: [.15, 2.5, .15], position: [5.7, 1.25, -1.6], color: 0x7b624a },
    { shape: 'box', size: [2.8, .12, 2], position: [4.5, 2.5, -1], color: 0xb8996a },
    { shape: 'box', size: [1, .6, .9], position: [-3.7, .3, -.5], color: 0x9c7952 },
    { shape: 'box', size: [.8, .7, .8], position: [-4.7, .35, -1.6], color: 0x806349 },
    { shape: 'cylinder', size: [.8, 1, .8], position: [-4, .5, -3], color: 0x907551 },
  ] },
}

export function sceneForEncounter(count: number): SceneId {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid_encounter_count')
  return candidateSceneIds[count % candidateSceneIds.length]
}

// Retain this implementation for recorded v1 episodes; changes need a new version.
export function sceneLayout(version: string | undefined, scene: SceneId, seed: number): {
  background: string; groundColor: number; water: boolean
  cameraPosition: readonly [number, number, number]; cameraTarget: readonly [number, number, number]
  trees: { x: number; z: number }[]; props?: SceneProp[]
} {
  if (!version) throw new Error('missing_scene_version')
  if (version !== 'procedural-path-v1' && version !== 'procedural-places-v2' && version !== 'procedural-places-v3') throw new Error('unsupported_scene_version')
  if (!Object.hasOwn(places, scene) || (version === 'procedural-path-v1' && scene !== 'riverside' && scene !== 'courtyard')) throw new Error('unsupported_scene')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('invalid_scene_seed')
  let state = seed >>> 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000 }
  const trees = Array.from({ length: 16 }, (_, index) => ({
    x: (index % 2 === 0 ? -1 : 1) * (3.7 + index % 3 + .05 + random() * .3),
    z: -13 + index * 1.8 + (random() - .5) * .3,
  }))
  const retained = {
    background: scene === 'riverside' ? '#b2c6bc' : '#c3b8a3',
    groundColor: scene === 'riverside' ? 0x758b70 : 0x9b8a6e,
    water: scene === 'riverside',
    cameraPosition: [3.2, 2.3, 8] as const,
    cameraTarget: [0, 1, 0] as const,
    trees,
  }
  if (version === 'procedural-path-v1') return retained
  const place = places[scene]
  const layout = { ...retained, background: place.background, groundColor: place.groundColor, props: place.props.map(prop => ({ ...prop, size: [...prop.size] as [number, number, number], position: [...prop.position] as [number, number, number] })), trees: trees.filter(tree => !place.props.some(prop => Math.abs(tree.x - prop.position[0]) < prop.size[0] / 2 + 1.2 && Math.abs(tree.z - prop.position[2]) < prop.size[2] / 2 + 1.2)) }
  return version === 'procedural-places-v2' ? layout : { ...layout, trees: layout.trees.filter(tree => tree.z < -8) }
}
