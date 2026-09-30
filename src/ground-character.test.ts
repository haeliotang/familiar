import * as THREE from 'three'
import { expect, it } from 'vitest'
import { groundCharacter } from './ground-character'

it('grounds each changed pose without accumulating the previous vertical correction', () => {
  const character = new THREE.Group()
  const foot = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .3))
  foot.position.y = -.04
  character.add(foot)
  const bounds = new THREE.Box3()
  expect(groundCharacter(character, bounds)).toBeCloseTo(.14)
  expect(bounds.setFromObject(character, true).min.y).toBeCloseTo(0)
  foot.position.y = .2
  expect(groundCharacter(character, bounds)).toBeCloseTo(-.1)
  expect(bounds.setFromObject(character, true).min.y).toBeCloseTo(0)
  expect(groundCharacter(character, bounds)).toBeCloseTo(-.1)
})

it('places the feet on a raised path surface', () => {
  const character = new THREE.Group()
  character.add(new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .3)))
  groundCharacter(character, new THREE.Box3(), .01)
  expect(new THREE.Box3().setFromObject(character, true).min.y).toBeCloseTo(.01)
})
