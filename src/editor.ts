import { products, type Product } from './catalog'

export type Point = { x: number; z: number }
export type RoomObject = { id: string; productId: string; variantId?: string; x: number; z: number; rotation: number }
export type RoomFeature = {
  id: string; type: 'wall' | 'door' | 'window'; x: number; z: number; rotation: number
  width: number; height: number; sillHeight?: number; wall?: 'north' | 'south' | 'east' | 'west'
  wallId?: string; wallOffset?: number; thickness?: number
}
export interface ProjectState {
  schemaVersion?: 2
  name: string; roomType: string; width: number; length: number; ceilingHeight: number
  floorMaterial: string; wallMaterial: string; objects: RoomObject[]; features: RoomFeature[]
}
export type FloorRegion = { id: string; points: Point[]; holes: Point[][]; area: number }
export const productById = new Map(products.map((product) => [product.id, product]))
export const floorColors: Record<string, string> = { 'Natural oak': '#cfb58f', 'Pale oak': '#e1d3b8', 'Warm concrete': '#c9c6bd' }
export const wallColors: Record<string, string> = { 'Warm white': '#f1eee6', 'Soft sage': '#c8d1c0', 'Sand': '#ded0bb' }
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const EPS = 0.00001
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const key = (p: Point) => `${Math.round(p.x * 100000)},${Math.round(p.z * 100000)}`
const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
export const polygonArea = (points: Point[]) => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2
export function emptyProject(name = 'My space'): ProjectState {
  return { schemaVersion: 2, name, roomType: 'Custom space', width: 12, length: 12, ceilingHeight: 2.8, floorMaterial: 'Natural oak', wallMaterial: 'Warm white', features: [], objects: [] }
}
export const wallThickness = (wall: RoomFeature) => wall.thickness ?? 0.12
export function wallEndpoints(wall: RoomFeature): [Point, Point] {
  const dx = Math.cos(wall.rotation) * wall.width / 2, dz = -Math.sin(wall.rotation) * wall.width / 2
  return [{ x: wall.x - dx, z: wall.z - dz }, { x: wall.x + dx, z: wall.z + dz }]
}
export function wallFromPoints(id: string, a: Point, b: Point, height: number): RoomFeature {
  return { id, type: 'wall', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, width: distance(a, b), height, rotation: -Math.atan2(b.z - a.z, b.x - a.x) }
}
function projection(point: Point, a: Point, b: Point) {
  const d = sub(b, a), length2 = d.x ** 2 + d.z ** 2
  const t = length2 ? ((point.x - a.x) * d.x + (point.z - a.z) * d.z) / length2 : 0
  return { t, point: at(a, b, clamp(t, 0, 1)) }
}
export function snapBuildPoint(point: Point, project: ProjectState, excludeId?: string): Point {
  const grid = { x: clamp(Math.round(point.x * 4) / 4, -project.width / 2, project.width / 2), z: clamp(Math.round(point.z * 4) / 4, -project.length / 2, project.length / 2) }
  const walls = project.features.filter((f) => f.type === 'wall' && f.id !== excludeId)
  const endpoints = walls.flatMap(wallEndpoints).sort((a, b) => distance(a, point) - distance(b, point))
  if (endpoints[0] && distance(endpoints[0], point) < 0.23) return endpoints[0]
  const projected = walls.map((wall) => projection(grid, ...wallEndpoints(wall)).point).sort((a, b) => distance(a, point) - distance(b, point))
  return projected[0] && distance(projected[0], point) < 0.18 ? projected[0] : grid
}
export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if (distance(point, projection(point, a, b).point) < EPS) return true
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}
export function getFloorRegions(features: RoomFeature[]): FloorRegion[] {
  const segments = features.filter((f) => f.type === 'wall' && f.width > EPS).map((f) => ({ ends: wallEndpoints(f), cuts: [0, 1] }))
  segments.forEach((s, i) => segments.slice(i + 1).forEach((other) => {
    const [a, b] = s.ends, [c, d] = other.ends, ab = sub(b, a), cd = sub(d, c), ca = sub(c, a)
    const denominator = cross(ab, cd)
    if (Math.abs(denominator) > EPS) {
      const t = cross(ca, cd) / denominator, u = cross(ca, ab) / denominator
      if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) { s.cuts.push(clamp(t, 0, 1)); other.cuts.push(clamp(u, 0, 1)) }
    } else if (Math.abs(cross(ca, ab)) < EPS) {
      ;[c, d].forEach((p) => { const t = projection(p, a, b).t; if (t > 0 && t < 1) s.cuts.push(t) })
      ;[a, b].forEach((p) => { const t = projection(p, c, d).t; if (t > 0 && t < 1) other.cuts.push(t) })
    }
  }))
  const nodes = new Map<string, Point>(), neighbours = new Map<string, Set<string>>()
  segments.forEach(({ ends: [a, b], cuts }) => {
    cuts.sort((x, y) => x - y)
    cuts.slice(0, -1).forEach((t, i) => {
      const p = at(a, b, t), q = at(a, b, cuts[i + 1]), pk = key(p), qk = key(q)
      if (pk === qk) return
      nodes.set(pk, p); nodes.set(qk, q)
      if (!neighbours.has(pk)) neighbours.set(pk, new Set())
      if (!neighbours.has(qk)) neighbours.set(qk, new Set())
      neighbours.get(pk)!.add(qk); neighbours.get(qk)!.add(pk)
    })
  })
  const leaves = [...neighbours.keys()].filter((id) => neighbours.get(id)!.size < 2)
  while (leaves.length) {
    const id = leaves.pop()!, links = neighbours.get(id)
    if (!links) continue
    links.forEach((other) => { neighbours.get(other)?.delete(id); if (neighbours.get(other)?.size === 1) leaves.push(other) })
    neighbours.delete(id)
  }
  const sorted = new Map([...neighbours].map(([id, links]) => {
    const p = nodes.get(id)!
    return [id, [...links].sort((a, b) => Math.atan2(nodes.get(a)!.z - p.z, nodes.get(a)!.x - p.x) - Math.atan2(nodes.get(b)!.z - p.z, nodes.get(b)!.x - p.x))]
  }))
  const visited = new Set<string>(), rings: Point[][] = []
  sorted.forEach((links, start) => links.forEach((next) => {
    if (visited.has(`${start}>${next}`)) return
    let a = start, b = next
    const points: Point[] = []
    for (let i = 0; i <= segments.length * segments.length * 4 + 4; i++) {
      const edge = `${a}>${b}`
      if (visited.has(edge)) break
      visited.add(edge); points.push(nodes.get(a)!)
      const outgoing = sorted.get(b)!, index = outgoing.indexOf(a)
      const c = outgoing[(index - 1 + outgoing.length) % outgoing.length]
      a = b; b = c
      if (a === start && b === next) {
        if (points.length >= 3 && polygonArea(points) > 0.01) rings.push(points)
        break
      }
    }
  }))
  const parents = rings.map((ring, i) => rings.map((candidate, j) => ({ j, area: polygonArea(candidate) })).filter(({ j, area }) => j !== i && area > polygonArea(ring) + EPS && ring.every((p) => pointInPolygon(p, rings[j]))).sort((a, b) => a.area - b.area)[0]?.j)
  return rings.map((points, i) => {
    const holes = rings.filter((_, j) => parents[j] === i)
    return { id: points.map(key).sort().join(';'), points, holes, area: polygonArea(points) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0) }
  })
}
export function footprint(product: Product, rotation: number) {
  const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation))
  return { x: (product.width * c + product.depth * s) / 200, z: (product.width * s + product.depth * c) / 200 }
}
function corners(object: RoomObject, margin = 0): Point[] {
  const p = productById.get(object.productId)!, c = Math.cos(object.rotation), s = Math.sin(object.rotation)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
    const dx = x * (p.width / 200 + margin), dz = z * (p.depth / 200 + margin)
    return { x: object.x + dx * c + dz * s, z: object.z - dx * s + dz * c }
  })
}
function crosses(a: Point, b: Point, c: Point, d: Point) {
  const ab = sub(b, a), cd = sub(d, c)
  return cross(ab, sub(c, a)) * cross(ab, sub(d, a)) < -EPS && cross(cd, sub(a, c)) * cross(cd, sub(b, c)) < -EPS
}
export function fitsFloor(object: RoomObject, project: ProjectState, regions = getFloorRegions(project.features)) {
  if (!productById.has(object.productId)) return false
  const points = corners(object, 0.005)
  const inside = regions.some((region) => points.every((p) => pointInPolygon(p, region.points) && !region.holes.some((h) => pointInPolygon(p, h))) && [region.points, ...region.holes].every((ring) => ring.every((p, i) => !points.some((q, j) => crosses(q, points[(j + 1) % 4], p, ring[(i + 1) % ring.length])))) && !region.holes.some((ring) => ring.some((p) => pointInPolygon(p, points))))
  return inside && !project.features.filter((f) => f.type === 'wall').some((wall) => {
    const [a, b] = wallEndpoints(wall), half = wallThickness(wall) / 2, nx = Math.sin(wall.rotation) * half, nz = Math.cos(wall.rotation) * half
    const outline = [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }]
    return outline.some((p) => pointInPolygon(p, points)) || points.some((p) => pointInPolygon(p, outline)) || outline.some((p, i) => points.some((q, j) => crosses(p, outline[(i + 1) % 4], q, points[(j + 1) % 4])))
  })
}
export function placeObject(object: RoomObject, room: ProjectState, snap = false, wallSnap = false): RoomObject {
  const product = productById.get(object.productId)
  if (!product) return object
  let result = { ...object, x: snap ? Math.round(object.x * 10) / 10 : object.x, z: snap ? Math.round(object.z * 10) / 10 : object.z }
  if (wallSnap) {
    for (const wall of room.features.filter((f) => f.type === 'wall')) {
      const [a, b] = wallEndpoints(wall), hit = projection(result, a, b)
      if (hit.t < 0 || hit.t > 1) continue
      const nx = Math.sin(wall.rotation), nz = Math.cos(wall.rotation)
      const extent = footprint(product, object.rotation - wall.rotation).z + wallThickness(wall) / 2 + 0.015
      const signed = (result.x - hit.point.x) * nx + (result.z - hit.point.z) * nz
      if (Math.abs(Math.abs(signed) - extent) < 0.16) {
        result = { ...result, x: hit.point.x + Math.sign(signed || 1) * extent * nx, z: hit.point.z + Math.sign(signed || 1) * extent * nz }
      }
    }
  }
  return result
}
export function overlaps(a: RoomObject, b: RoomObject) {
  const pa = productById.get(a.productId), pb = productById.get(b.productId)
  if (!pa || !pb || pa.category === 'Rug' || pb.category === 'Rug') return false
  const axes = (r: number) => [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]
  const aa = axes(a.rotation), ba = axes(b.rotation)
  return [...aa, ...ba].every(([x, z]) => {
    const radius = (p: Product, ax: number[][]) => Math.abs(x * ax[0][0] + z * ax[0][1]) * p.width / 200 + Math.abs(x * ax[1][0] + z * ax[1][1]) * p.depth / 200
    return Math.abs((a.x - b.x) * x + (a.z - b.z) * z) < radius(pa, aa) + radius(pb, ba) - 0.025
  })
}
export function placementWarnings(project: ProjectState) {
  const warnings: { id: string; message: string }[] = [], regions = getFloorRegions(project.features)
  project.objects.forEach((object, index) => {
    const product = productById.get(object.productId)
    if (!product) return
    if (!fitsFloor(object, project, regions)) warnings.push({ id: object.id, message: `${product.name} is outside an enclosed room or crosses a wall.` })
    project.objects.slice(index + 1).forEach((other) => { if (overlaps(object, other)) warnings.push({ id: object.id, message: `${product.name} overlaps ${productById.get(other.productId)?.name}.` }) })
    project.features.filter((f) => f.type === 'door').forEach((door) => {
      const dx = object.x - door.x, dz = object.z - door.z, extent = footprint(product, object.rotation - door.rotation)
      if (product.category !== 'Rug' && Math.abs(dx * Math.cos(door.rotation) - dz * Math.sin(door.rotation)) < door.width / 2 + extent.x && Math.abs(dx * Math.sin(door.rotation) + dz * Math.cos(door.rotation)) < 0.65 + extent.z) warnings.push({ id: object.id, message: `${product.name} may block the door clearance.` })
    })
  })
  return warnings
}
export function attachOpening(feature: RoomFeature, room: ProjectState): RoomFeature {
  if (feature.type === 'wall') return { ...feature, height: clamp(feature.height, 0.3, 6) }
  const walls = room.features.filter((f) => f.type === 'wall' && f.width >= 0.5)
  const wall = walls.find((f) => f.id === feature.wallId) || walls.sort((a, b) => distance(feature, projection(feature, ...wallEndpoints(a)).point) - distance(feature, projection(feature, ...wallEndpoints(b)).point))[0]
  if (!wall) return { ...feature, wallId: undefined }
  const width = clamp(feature.width, 0.3, wall.width - 0.16)
  const projected = (feature.x - wall.x) * Math.cos(wall.rotation) - (feature.z - wall.z) * Math.sin(wall.rotation)
  const wallOffset = clamp(feature.wallId === wall.id && feature.wallOffset !== undefined ? feature.wallOffset : projected, -(wall.width - width) / 2 + 0.04, (wall.width - width) / 2 - 0.04)
  const sillHeight = feature.type === 'window' ? clamp(feature.sillHeight ?? 0.85, 0, wall.height - 0.3) : 0
  return { ...feature, wall: undefined, wallId: wall.id, wallOffset, width, sillHeight, height: clamp(feature.height, 0.3, wall.height - sillHeight), rotation: wall.rotation, x: wall.x + wallOffset * Math.cos(wall.rotation), z: wall.z - wallOffset * Math.sin(wall.rotation) }
}
export function refreshOpenings(project: ProjectState): ProjectState {
  const walls = new Set(project.features.filter((f) => f.type === 'wall').map((f) => f.id))
  return { ...project, features: project.features.filter((f) => f.type === 'wall' || !f.wallId || walls.has(f.wallId)).map((f) => attachOpening(f, project)) }
}
export function moveWallEndpoint(project: ProjectState, id: string, previous: Point, next: Point): ProjectState {
  const bounded = { x: clamp(next.x, -project.width / 2, project.width / 2), z: clamp(next.z, -project.length / 2, project.length / 2) }
  const features = project.features.map((wall) => {
    if (wall.type !== 'wall') return wall
    const [a, b] = wallEndpoints(wall)
    const aa = distance(a, previous) < EPS ? bounded : a, bb = distance(b, previous) < EPS ? bounded : b
    return aa === a && bb === b ? wall : { ...wall, ...wallFromPoints(wall.id, aa, bb, wall.height) }
  })
  if (!features.some((f) => f.id === id) || features.some((f) => f.type === 'wall' && f.width < 0.25)) return project
  return refreshOpenings({ ...project, features })
}
export function migrateProject(project: ProjectState): ProjectState {
  if (project.schemaVersion === 2) return refreshOpenings(project)
  const { width: w, length: l } = project
  const points = [{ x: -w / 2, z: -l / 2 }, { x: w / 2, z: -l / 2 }, { x: w / 2, z: l / 2 }, { x: -w / 2, z: l / 2 }]
  const walls = points.map((a, i) => wallFromPoints(`boundary-${i}`, a, points[(i + 1) % 4], project.ceilingHeight))
  return refreshOpenings({ ...project, schemaVersion: 2, width: Math.max(12, w + 2), length: Math.max(12, l + 2), features: [...walls, ...project.features] })
}
export function isProject(value: unknown): value is ProjectState {
  if (!value || typeof value !== 'object') return false
  const p = value as ProjectState
  return (p.schemaVersion === undefined || p.schemaVersion === 2) && typeof p.name === 'string' && typeof p.roomType === 'string' && [p.width, p.length].every((v) => Number.isFinite(v) && v >= 2 && v <= 40) && Number.isFinite(p.ceilingHeight) && p.ceilingHeight >= 2 && p.ceilingHeight <= 6 && typeof p.floorMaterial === 'string' && typeof p.wallMaterial === 'string' && Array.isArray(p.objects) && p.objects.length <= 1000 && p.objects.every((o) => o && typeof o.id === 'string' && productById.has(o.productId) && (o.variantId === undefined || typeof o.variantId === 'string') && [o.x, o.z, o.rotation].every(Number.isFinite)) && Array.isArray(p.features) && p.features.length <= 200 && p.features.every((f) => f && typeof f.id === 'string' && ['wall', 'door', 'window'].includes(f.type) && [f.x, f.z, f.rotation, f.width, f.height].every(Number.isFinite) && f.width >= 0.25 && f.width <= 60 && f.height >= 0.3 && f.height <= 6 && (f.sillHeight === undefined || Number.isFinite(f.sillHeight)) && (f.wallId === undefined || typeof f.wallId === 'string') && (f.wallOffset === undefined || Number.isFinite(f.wallOffset)) && (f.thickness === undefined || (Number.isFinite(f.thickness) && f.thickness >= 0.02 && f.thickness <= 2)))
}
