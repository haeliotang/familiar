import { Box3, Scene } from 'three'
import { expect, it } from 'vitest'
import { candidateSceneIds, currentSceneVersion, sceneLayout } from './scene-catalog'
import { createPlaceProps } from './place-props'
import { disposeScene } from './dispose-scene'
import { createReviewSeat } from './review-seat'

it.each(candidateSceneIds)('keeps %s props clear of the walking lane and above the ground', scene => {
  const layout = sceneLayout(currentSceneVersion, scene, 1)
  if (!layout.props) throw new Error('missing_props')
  const group = createPlaceProps(layout.props)
  const world = new Scene()
  world.add(group)
  try {
    expect(group.children.length).toBeGreaterThan(0)
    for (const mesh of group.children) {
      const bounds = new Box3().setFromObject(mesh)
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.001)
      expect(bounds.max.x < -2.2 || bounds.min.x > 2.2).toBe(true)
    }
  } finally { disposeScene(world) }
})

it.each(candidateSceneIds)('keeps the initial sitting slot clear of %s scenery', scene => {
  const layout = sceneLayout(currentSceneVersion, scene, 1)
  if (!layout.props) throw new Error('missing_props')
  const props = createPlaceProps(layout.props)
  const { seat } = createReviewSeat()
  seat.position.set(0, .01, -18.33)
  const seatBounds = new Box3().setFromObject(seat)
  const world = new Scene()
  world.add(props, seat)
  try {
    for (const prop of props.children) expect(seatBounds.intersectsBox(new Box3().setFromObject(prop))).toBe(false)
    for (const tree of layout.trees) expect(Math.hypot(tree.x, tree.z + 18.33)).toBeGreaterThan(1.5)
  } finally { disposeScene(world) }
})
