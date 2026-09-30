import { Box3, Scene } from 'three'
import { expect, it } from 'vitest'
import { createReviewSeat } from './review-seat'
import { disposeScene } from './dispose-scene'

it('keeps all four legs on the floor and supporting the adjustable surface', () => {
  const { seat, setHeight } = createReviewSeat()
  const scene = new Scene()
  scene.add(seat)
  try {
    for (const height of [.3, .46, .65]) {
      setHeight(height)
      const surface = new Box3().setFromObject(seat.children[0])
      expect(surface.max.y).toBeCloseTo(height)
      for (const leg of seat.children.slice(1)) {
        const bounds = new Box3().setFromObject(leg)
        expect(bounds.min.y).toBeCloseTo(0)
        expect(bounds.max.y).toBeCloseTo(surface.min.y)
      }
    }
    expect(() => setHeight(NaN)).toThrow('invalid_review_seat_height')
    expect(() => setHeight(.29)).toThrow('invalid_review_seat_height')
  } finally { disposeScene(scene) }
})
