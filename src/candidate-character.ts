import * as THREE from 'three'

// Local review candidate: rigid head, no facial animation or published compatibility.
export function composeCandidateCharacter(base: THREE.Group, outfit: THREE.Group) {
  base.updateMatrixWorld(true)
  outfit.updateMatrixWorld(true)
  const sourceHead = base.getObjectByName('Head')
  const targetHead = outfit.getObjectByName('Head')
  if (!sourceHead || !targetHead) throw new Error('missing_head_joint')
  const toHead = sourceHead.matrixWorld.clone().invert()
  const cutoff = sourceHead.getWorldPosition(new THREE.Vector3()).y - 0.07
  let triangles = 0
  base.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    if (Array.isArray(object.material)) throw new Error('unsupported_head_material_groups')
    const original = object.geometry
    const index = original.index
    const count = index ? index.count : original.attributes.position.count
    const positions: number[] = []
    const normals: number[] = []
    const attributes = Object.keys(original.attributes).filter(name => !['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)).map(name => [name, original.getAttribute(name)] as const)
    const copied = new Map(attributes.map(([name]) => [name, [] as number[]]))
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(toHead.clone().multiply(object.matrixWorld))
    const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const normal = new THREE.Vector3()
    for (let offset = 0; offset < count; offset += 3) {
      const vertices = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner)
      vertices.forEach((vertex, corner) => object.getVertexPosition(vertex, points[corner]).applyMatrix4(object.matrixWorld))
      if (points.some(point => point.y < cutoff)) continue
      vertices.forEach((vertex, corner) => {
        points[corner].applyMatrix4(toHead).toArray(positions, positions.length)
        if (original.attributes.normal) normal.fromBufferAttribute(original.attributes.normal, vertex).applyNormalMatrix(normalMatrix).toArray(normals, normals.length)
        for (const [name, attribute] of attributes) {
          const values = copied.get(name)!
          for (let component = 0; component < attribute.itemSize; component++) values.push(attribute.getComponent(vertex, component))
        }
      })
      triangles++
    }
    if (!positions.length) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (normals.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    for (const [name, attribute] of attributes) geometry.setAttribute(name, new THREE.Float32BufferAttribute(copied.get(name)!, attribute.itemSize))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, object.material)
    mesh.name = `candidate_head_${object.name}`
    targetHead.add(mesh)
  })
  if (!triangles) throw new Error('empty_head_geometry')
  outfit.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true })
  return { character: outfit, headTriangles: triangles }
}
