import { products, type Product } from './catalog'

export type Point = { x: number; z: number }
export type CustomRoomItem = { name: string; width: number; depth: number; height: number; color: string; kind: 'furniture' | 'rug' | 'wall' }
/** Wall-mounted items also carry `wallId`/`wallOffset` (metres from the wall centre), `wallSide` (+1 = along the wall normal) and `elevation` (metres from floor to the item's bottom). Their x/z/rotation are derived from the wall. */
export type RoomObject = { id: string; productId?: string; variantId?: string; custom?: CustomRoomItem; x: number; z: number; rotation: number; inBasket?: boolean; mirrored?: boolean; wallId?: string; wallOffset?: number; wallSide?: 1 | -1; elevation?: number }
export type DoorStyle = 'hinged' | 'double' | 'sliding' | 'opening'
export type WindowStyle = 'casement' | 'fixed' | 'balcony'
export type RoomFeature = {
  id: string; type: 'wall' | 'door' | 'window'; x: number; z: number; rotation: number
  width: number; height: number; sillHeight?: number; wall?: 'north' | 'south' | 'east' | 'west'
  wallId?: string; wallOffset?: number; thickness?: number
  /** Doors and windows only. Missing values mean a hinged door or a casement window. `hinge` is the wall-local end (left = −X); `swing` is relative to the room the opening belongs to. */
  style?: DoorStyle | WindowStyle; hinge?: 'left' | 'right'; swing?: 'in' | 'out'
}
export type ProjectRoomLabel = { id: string; name: string; x: number; z: number; confidence: number }
export type PlanImportInfo = { provider: 'local' | 'vertex-ai'; confidence: number; scaleCalibrated: boolean }
export interface ProjectState {
  schemaVersion?: 2 | 3
  name: string; roomType: string; width: number; length: number; ceilingHeight: number
  floorMaterial: string; wallMaterial: string; objects: RoomObject[]; features: RoomFeature[]
  roomLabels?: ProjectRoomLabel[]; planImport?: PlanImportInfo
}
export type FloorRegion = { id: string; points: Point[]; holes: Point[][]; area: number }
export const productById = new Map(products.map((product) => [product.id, product]))
export type RoomItemShape = Pick<Product, 'name' | 'width' | 'depth' | 'height' | 'category' | 'tone' | 'accent'>
export function roomItemShape(object: RoomObject): RoomItemShape | null {
  if (object.custom) return { name: object.custom.name, width: object.custom.width, depth: object.custom.depth, height: object.custom.height, category: object.custom.kind === 'rug' ? 'Rug' : 'Custom', tone: object.custom.color, accent: object.custom.color }
  const product = object.productId ? productById.get(object.productId) : null
  return product ? product : null
}
function isCustomRoomItem(value: unknown): value is CustomRoomItem {
  if (!value || typeof value !== 'object') return false
  const item = value as CustomRoomItem
  return typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 80 && [item.width, item.depth].every((dimension) => Number.isFinite(dimension) && dimension >= 1 && dimension <= 2000) && Number.isFinite(item.height) && item.height >= 1 && item.height <= 600 && /^#[\da-f]{6}$/i.test(item.color) && ['furniture', 'rug', 'wall'].includes(item.kind)
}
function isRoomObject(value: unknown): value is RoomObject {
  if (!value || typeof value !== 'object') return false
  const item = value as RoomObject, catalogItem = typeof item.productId === 'string' && productById.has(item.productId) && item.custom === undefined && (item.variantId === undefined || typeof item.variantId === 'string')
  const customItem = item.productId === undefined && item.variantId === undefined && isCustomRoomItem(item.custom) && item.inBasket !== true
  const wallFields = (item.wallId === undefined || typeof item.wallId === 'string') && (item.wallOffset === undefined || Number.isFinite(item.wallOffset)) && (item.wallSide === undefined || item.wallSide === 1 || item.wallSide === -1) && (item.elevation === undefined || (Number.isFinite(item.elevation) && item.elevation >= 0 && item.elevation <= 6))
  return typeof item.id === 'string' && (catalogItem || customItem) && wallFields && (item.inBasket === undefined || typeof item.inBasket === 'boolean') && (item.mirrored === undefined || typeof item.mirrored === 'boolean') && [item.x, item.z, item.rotation].every(Number.isFinite)
}
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
  return { schemaVersion: 3, name, roomType: 'Custom space', width: 12, length: 12, ceilingHeight: 2.8, floorMaterial: 'Natural oak', wallMaterial: 'Warm white', features: [], objects: [] }
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
export function footprint(product: Pick<Product, 'width' | 'depth'>, rotation: number) {
  const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation))
  return { x: (product.width * c + product.depth * s) / 200, z: (product.width * s + product.depth * c) / 200 }
}
function corners(object: RoomObject, margin = 0): Point[] {
  const p = roomItemShape(object), c = Math.cos(object.rotation), s = Math.sin(object.rotation)
  if (!p) return []
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
  if (!roomItemShape(object)) return false
  if (isWallMounted(object)) return Boolean(object.wallId && project.features.some((wall) => wall.id === object.wallId))
  const points = corners(object, 0.005)
  const inside = regions.some((region) => points.every((p) => pointInPolygon(p, region.points) && !region.holes.some((h) => pointInPolygon(p, h))) && [region.points, ...region.holes].every((ring) => ring.every((p, i) => !points.some((q, j) => crosses(q, points[(j + 1) % 4], p, ring[(i + 1) % ring.length])))) && !region.holes.some((ring) => ring.some((p) => pointInPolygon(p, points))))
  return inside && !project.features.filter((f) => f.type === 'wall').some((wall) => {
    const [a, b] = wallEndpoints(wall), half = wallThickness(wall) / 2, nx = Math.sin(wall.rotation) * half, nz = Math.cos(wall.rotation) * half
    const outline = [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }]
    return outline.some((p) => pointInPolygon(p, points)) || points.some((p) => pointInPolygon(p, outline)) || outline.some((p, i) => points.some((q, j) => crosses(p, outline[(i + 1) % 4], q, points[(j + 1) % 4])))
  })
}
export function placeObject(object: RoomObject, room: ProjectState, snap = false, wallSnap = false): RoomObject {
  const product = roomItemShape(object)
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
/** Rotates one item in place, or a group about its centre. Returns null when any rotated item would leave the floor. */
export function rotateObjects(project: ProjectState, ids: string[], angle: number): ProjectState | null {
  const selected = project.objects.filter((object) => ids.includes(object.id))
  if (!selected.length || selected.some(isWallMounted)) return null
  const centre = selected.length === 1 ? selected[0] : selected.reduce((point, object) => ({ x: point.x + object.x / selected.length, z: point.z + object.z / selected.length }), { x: 0, z: 0 })
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const objects = project.objects.map((object) => {
    if (!ids.includes(object.id)) return object
    const x = object.x - centre.x, z = object.z - centre.z
    return { ...object, x: centre.x + x * cos + z * sin, z: centre.z - x * sin + z * cos, rotation: object.rotation + angle }
  })
  const regions = getFloorRegions(project.features)
  return objects.every((object) => !ids.includes(object.id) || fitsFloor(object, project, regions)) ? { ...project, objects } : null
}
export function isWallMounted(object: RoomObject) {
  return object.custom ? object.custom.kind === 'wall' : productById.get(object.productId ?? '')?.mount === 'wall'
}
const defaultElevation = (object: RoomObject, shape: RoomItemShape) => object.custom ? Math.max(0, 1.5 - shape.height / 200) : (productById.get(object.productId ?? '')?.mountHeight ?? 120) / 100
/**
 * Hangs a wall item on its wall (or the wall nearest `point`), flush with the wall face.
 * `point` picks the position along the wall and, when `pickSide` is set, which face it hangs on.
 * Returns null when there is no wall long enough.
 */
export function hangOnWall(object: RoomObject, project: ProjectState, point?: Point, pickSide = false): RoomObject | null {
  const shape = roomItemShape(object)
  if (!shape) return null
  const width = shape.width / 100, depth = shape.depth / 100, height = shape.height / 100
  const walls = project.features.filter((f) => f.type === 'wall' && f.width >= width + 0.05)
  const target = point ?? object
  const wall = project.features.find((f) => f.type === 'wall' && f.id === object.wallId) ?? walls.sort((a, b) => distance(target, projection(target, ...wallEndpoints(a)).point) - distance(target, projection(target, ...wallEndpoints(b)).point))[0]
  if (!wall) return null
  const nx = Math.sin(wall.rotation), nz = Math.cos(wall.rotation)
  // A tap on a wall's face picks that face; a tap on its top (plan view) is ambiguous and falls back to the room side.
  const across = point ? (point.x - wall.x) * nx + (point.z - wall.z) * nz : 0
  const side = pickSide && point && Math.abs(across) > wallThickness(wall) / 4 ? (across > 0 ? 1 : -1) : object.wallId === wall.id && object.wallSide ? object.wallSide : wallInsideSign(wall, getFloorRegions(project.features)) as 1 | -1
  const along = point ? (point.x - wall.x) * Math.cos(wall.rotation) - (point.z - wall.z) * Math.sin(wall.rotation) : object.wallId === wall.id ? object.wallOffset ?? 0 : 0
  const slack = Math.max(0, (wall.width - width) / 2), wallOffset = clamp(along, -slack, slack)
  const elevation = clamp(object.elevation ?? defaultElevation(object, shape), 0, Math.max(0, wall.height - height))
  const out = wallThickness(wall) / 2 + depth / 2 + 0.005
  return { ...object, wallId: wall.id, wallSide: side, wallOffset, elevation, rotation: wall.rotation + (side === 1 ? 0 : Math.PI), x: wall.x + wallOffset * Math.cos(wall.rotation) + nx * side * out, z: wall.z - wallOffset * Math.sin(wall.rotation) + nz * side * out }
}
/** Wall items that share a wall face and overlap along it and vertically; doors and windows block both faces. */
function wallItemClashes(object: RoomObject, project: ProjectState) {
  const shape = roomItemShape(object)
  if (!shape || !object.wallId) return []
  const width = shape.width / 100, bottom = object.elevation ?? 0, top = bottom + shape.height / 100, offset = object.wallOffset ?? 0
  const clash = (otherOffset: number, otherWidth: number, otherBottom: number, otherTop: number) => Math.abs(otherOffset - offset) < (otherWidth + width) / 2 - 0.01 && otherBottom < top - 0.01 && otherTop > bottom + 0.01
  const openings = project.features.filter((f) => f.wallId === object.wallId && f.type !== 'wall' && clash(f.wallOffset ?? 0, f.width, f.sillHeight ?? 0, (f.sillHeight ?? 0) + f.height)).map((f) => f.type === 'door' ? 'the door' : 'the window')
  const items = project.objects.filter((other) => other.id !== object.id && other.wallId === object.wallId && other.wallSide === object.wallSide && isWallMounted(other)).filter((other) => { const s = roomItemShape(other)!; return clash(other.wallOffset ?? 0, s.width / 100, other.elevation ?? 0, (other.elevation ?? 0) + s.height / 100) }).map((other) => roomItemShape(other)!.name)
  return [...openings, ...items]
}
function footprintsOverlap(a: RoomObject, b: RoomObject, pa: RoomItemShape, pb: RoomItemShape) {
  const axes = (r: number) => [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]
  const aa = axes(a.rotation), ba = axes(b.rotation)
  return [...aa, ...ba].every(([x, z]) => {
    const radius = (p: Pick<Product, 'width' | 'depth'>, ax: number[][]) => Math.abs(x * ax[0][0] + z * ax[0][1]) * p.width / 200 + Math.abs(x * ax[1][0] + z * ax[1][1]) * p.depth / 200
    return Math.abs((a.x - b.x) * x + (a.z - b.z) * z) < radius(pa, aa) + radius(pb, ba) - 0.025
  })
}
export function overlaps(a: RoomObject, b: RoomObject) {
  const pa = roomItemShape(a), pb = roomItemShape(b)
  if (!pa || !pb || pa.category === 'Rug' || pb.category === 'Rug' || isWallMounted(a) || isWallMounted(b)) return false
  return footprintsOverlap(a, b, pa, pb)
}
export function placementWarnings(project: ProjectState) {
  const warnings: { id: string; message: string }[] = [], regions = getFloorRegions(project.features)
  project.objects.forEach((object, index) => {
    const item = roomItemShape(object)
    if (!item) return
    if (isWallMounted(object)) {
      if (!fitsFloor(object, project, regions)) warnings.push({ id: object.id, message: `${item.name} is no longer on a wall. Drag it onto a wall or remove it.` })
      wallItemClashes(object, project).forEach((name) => warnings.push({ id: object.id, message: `${item.name} overlaps ${name}.` }))
      // Floor items standing in front of a wall item only matter if they reach up to it.
      project.objects.forEach((other) => { const shape = roomItemShape(other); if (shape && other.id !== object.id && !isWallMounted(other) && shape.category !== 'Rug' && shape.height / 100 > (object.elevation ?? 0) + 0.02 && footprintsOverlap(object, other, item, shape)) warnings.push({ id: object.id, message: `${item.name} may hit ${shape.name}.` }) })
      return
    }
    if (!fitsFloor(object, project, regions)) warnings.push({ id: object.id, message: `${item.name} is outside an enclosed room or crosses a wall.` })
    project.objects.slice(index + 1).forEach((other) => { if (overlaps(object, other)) warnings.push({ id: object.id, message: `${item.name} overlaps ${roomItemShape(other)?.name || 'another item'}.` }) })
    project.features.filter((f) => f.type === 'door' || (f.type === 'window' && openingStyle(f) === 'balcony')).forEach((door) => {
      const dx = object.x - door.x, dz = object.z - door.z, extent = footprint(item, object.rotation - door.rotation)
      const along = dx * Math.cos(door.rotation) - dz * Math.sin(door.rotation)
      const across = (dx * Math.sin(door.rotation) + dz * Math.cos(door.rotation)) * (door.type === 'door' ? doorSwingSign(door, project.features.find((wall) => wall.id === door.wallId), regions) : 1)
      // Clear floor: a walking passage on both sides, extended on the swing side to the leaf radius.
      if (item.category !== 'Rug' && Math.abs(along) < door.width / 2 + extent.x && across > -(0.65 + extent.z) && across < (door.type === 'door' ? doorReach(door) : 0.65) + extent.z) warnings.push({ id: object.id, message: `${item.name} may block the door clearance.` })
    })
  })
  return warnings
}
export const doorStyles: DoorStyle[] = ['hinged', 'double', 'sliding', 'opening']
export const windowStyles: WindowStyle[] = ['casement', 'fixed', 'balcony']
export const openingStyle = (feature: RoomFeature) => feature.style ?? (feature.type === 'door' ? 'hinged' : 'casement')
export type OpeningSize = { label: string; width: number; height: number; sillHeight: number }
/** Common sizes per style, in metres. The first entry is the default when switching to that style. */
export const openingSizes: Record<DoorStyle | WindowStyle, OpeningSize[]> = {
  hinged: [{ label: 'Standard 80 cm', width: 0.8, height: 2.1, sillHeight: 0 }, { label: 'Narrow 70 cm', width: 0.7, height: 2.1, sillHeight: 0 }, { label: 'Wide 90 cm', width: 0.9, height: 2.1, sillHeight: 0 }],
  double: [{ label: '140 cm', width: 1.4, height: 2.1, sillHeight: 0 }, { label: '120 cm', width: 1.2, height: 2.1, sillHeight: 0 }, { label: '160 cm', width: 1.6, height: 2.1, sillHeight: 0 }],
  sliding: [{ label: '160 cm', width: 1.6, height: 2.1, sillHeight: 0 }, { label: '120 cm', width: 1.2, height: 2.1, sillHeight: 0 }, { label: '200 cm', width: 2, height: 2.1, sillHeight: 0 }],
  opening: [{ label: '90 cm', width: 0.9, height: 2.1, sillHeight: 0 }, { label: '120 cm', width: 1.2, height: 2.1, sillHeight: 0 }, { label: '160 cm', width: 1.6, height: 2.1, sillHeight: 0 }],
  casement: [{ label: 'Standard', width: 1.2, height: 1.4, sillHeight: 0.9 }, { label: 'Small', width: 0.6, height: 0.6, sillHeight: 1.1 }, { label: 'Large', width: 1.8, height: 1.5, sillHeight: 0.8 }],
  fixed: [{ label: 'Standard', width: 1.2, height: 1.4, sillHeight: 0.9 }, { label: 'Small', width: 0.6, height: 0.6, sillHeight: 1.1 }, { label: 'Large', width: 1.8, height: 1.5, sillHeight: 0.8 }],
  balcony: [{ label: '90 cm', width: 0.9, height: 2.2, sillHeight: 0 }, { label: 'Double 140 cm', width: 1.4, height: 2.2, sillHeight: 0 }, { label: 'Wide 180 cm', width: 1.8, height: 2.2, sillHeight: 0 }],
}
/** Which side of a wall (+1 = along its normal (sin r, cos r), −1 = against it) faces into a room; +1 when both or neither side does. */
export function wallInsideSign(wall: RoomFeature, regions: FloorRegion[]) {
  const nx = Math.sin(wall.rotation), nz = Math.cos(wall.rotation)
  const inside = (side: number) => regions.some((region) => pointInPolygon({ x: wall.x + nx * side * 0.15, z: wall.z + nz * side * 0.15 }, region.points))
  return inside(-1) && !inside(1) ? -1 : 1
}
/** Side of the wall a door leaf swings into (same sign convention as `wallInsideSign`). */
export const doorSwingSign = (door: RoomFeature, wall: RoomFeature | undefined, regions: FloorRegion[]) => (wall ? wallInsideSign(wall, regions) : 1) * (door.swing === 'out' ? -1 : 1)
/** How far a door needs clear floor on its swing side: the leaf radius for hinged leaves, otherwise a walking passage. */
export function doorReach(door: RoomFeature) {
  const style = openingStyle(door)
  return Math.max(0.65, style === 'hinged' ? door.width : style === 'double' ? door.width / 2 : 0)
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
  const refreshed = { ...project, features: project.features.filter((f) => f.type === 'wall' || !f.wallId || walls.has(f.wallId)).map((f) => attachOpening(f, project)) }
  // Wall items follow their wall; if the wall is gone they stay put, detached, and get a warning.
  return { ...refreshed, objects: project.objects.map((object) => !object.wallId ? object : walls.has(object.wallId) ? hangOnWall(object, refreshed) ?? object : { ...object, wallId: undefined }) }
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
  const objects = project.objects.map((object) => ({ ...object, inBasket: object.inBasket ?? false }))
  if (project.schemaVersion === 3) return refreshOpenings({ ...project, objects })
  if (project.schemaVersion === 2) return refreshOpenings({ ...project, schemaVersion: 3, objects })
  const { width: w, length: l } = project
  const points = [{ x: -w / 2, z: -l / 2 }, { x: w / 2, z: -l / 2 }, { x: w / 2, z: l / 2 }, { x: -w / 2, z: l / 2 }]
  const walls = points.map((a, i) => wallFromPoints(`boundary-${i}`, a, points[(i + 1) % 4], project.ceilingHeight))
  return refreshOpenings({ ...project, schemaVersion: 3, width: Math.max(12, w + 2), length: Math.max(12, l + 2), features: [...walls, ...project.features], objects })
}
export function isProject(value: unknown): value is ProjectState {
  if (!value || typeof value !== 'object') return false
  const p = value as ProjectState
  return (p.schemaVersion === undefined || p.schemaVersion === 2 || p.schemaVersion === 3) && typeof p.name === 'string' && typeof p.roomType === 'string' && [p.width, p.length].every((v) => Number.isFinite(v) && v >= 2 && v <= 40) && Number.isFinite(p.ceilingHeight) && p.ceilingHeight >= 2 && p.ceilingHeight <= 6 && typeof p.floorMaterial === 'string' && typeof p.wallMaterial === 'string' && (p.roomLabels === undefined || (Array.isArray(p.roomLabels) && p.roomLabels.length <= 40 && p.roomLabels.every((label) => label && typeof label.id === 'string' && typeof label.name === 'string' && [label.x, label.z, label.confidence].every(Number.isFinite) && label.confidence >= 0 && label.confidence <= 1))) && (p.planImport === undefined || (typeof p.planImport === 'object' && p.planImport !== null && ['local', 'vertex-ai'].includes(p.planImport.provider) && Number.isFinite(p.planImport.confidence) && p.planImport.confidence >= 0 && p.planImport.confidence <= 1 && typeof p.planImport.scaleCalibrated === 'boolean')) && Array.isArray(p.objects) && p.objects.length <= 1000 && p.objects.every((o) => isRoomObject(o)) && Array.isArray(p.features) && p.features.length <= 200 && p.features.every((f) => f && typeof f.id === 'string' && ['wall', 'door', 'window'].includes(f.type) && [f.x, f.z, f.rotation, f.width, f.height].every(Number.isFinite) && f.width >= 0.25 && f.width <= 60 && f.height >= 0.3 && f.height <= 6 && (f.sillHeight === undefined || Number.isFinite(f.sillHeight)) && (f.wallId === undefined || typeof f.wallId === 'string') && (f.wallOffset === undefined || Number.isFinite(f.wallOffset)) && (f.thickness === undefined || (Number.isFinite(f.thickness) && f.thickness >= 0.02 && f.thickness <= 2)) && (f.style === undefined || (f.type === 'door' ? doorStyles : f.type === 'window' ? windowStyles : []).includes(f.style as never)) && (f.hinge === undefined || ['left', 'right'].includes(f.hinge)) && (f.swing === undefined || ['in', 'out'].includes(f.swing)))
}

// ── Sims-style wall building ─────────────────────────────────────────────
const GRID_STEP = 0.25
const unit = (p: Point) => { const length = Math.hypot(p.x, p.z) || 1; return { x: p.x / length, z: p.z / length } }
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z
const isWall = (f: RoomFeature) => f.type === 'wall'

/** End point of a wall drag: along the nearest 45° direction, on the 25 cm grid, or onto a nearby existing wall end. */
export function snapWallDrag(start: Point, raw: Point, project: ProjectState): Point {
  const ends = project.features.filter(isWall).flatMap(wallEndpoints).filter((p) => distance(p, start) > EPS)
  const near = ends.sort((a, b) => distance(a, raw) - distance(b, raw))[0]
  if (near && distance(near, raw) < 0.23) return near
  const d = sub(raw, start)
  if (Math.hypot(d.x, d.z) < 0.05) return start
  const angle = Math.round(Math.atan2(d.z, d.x) / (Math.PI / 4)) * (Math.PI / 4)
  const dir = { x: Math.round(Math.cos(angle)), z: Math.round(Math.sin(angle)) }
  // Per-axis distance along the direction, rounded to whole grid steps so both ends stay on the grid.
  const steps = Math.max(0, Math.round(dot(d, dir) / dot(dir, dir) / GRID_STEP))
  return { x: clamp(start.x + dir.x * steps * GRID_STEP, -project.width / 2, project.width / 2), z: clamp(start.z + dir.z * steps * GRID_STEP, -project.length / 2, project.length / 2) }
}

const collinear = (wall: RoomFeature, a: Point, dir: Point) => wallEndpoints(wall).every((p) => Math.abs(cross(dir, sub(p, a))) < 0.01)
/** Re-bases openings and wall items from `fromIds` onto wall `to` by their world position. */
function reassignToWall(project: ProjectState, fromIds: Set<string>, to: RoomFeature): ProjectState {
  const along = (p: Point) => (p.x - to.x) * Math.cos(to.rotation) - (p.z - to.z) * Math.sin(to.rotation)
  return {
    ...project,
    features: project.features.map((f) => f.type !== 'wall' && f.wallId && fromIds.has(f.wallId) ? { ...f, wallId: to.id, wallOffset: along(f) } : f),
    objects: project.objects.map((o) => o.wallId && fromIds.has(o.wallId) ? { ...o, wallId: to.id, wallOffset: along(o) } : o),
  }
}

/** Adds a wall from a to b. Collinear walls it overlaps or touches are merged into one, so redrawing over a wall never doubles it. */
export function addWallSegment(project: ProjectState, a: Point, b: Point, id: string): ProjectState {
  const length = distance(a, b)
  if (length < 0.25 || project.features.length >= 200) return project
  const dir = unit(sub(b, a))
  let from = 0, to = length
  const merged = project.features.filter(isWall).filter((wall) => {
    if (!collinear(wall, a, dir)) return false
    const [c, d] = wallEndpoints(wall).map((p) => dot(sub(p, a), dir))
    if (Math.max(c, d) < -0.001 || Math.min(c, d) > length + 0.001) return false
    from = Math.min(from, c, d); to = Math.max(to, c, d)
    return true
  })
  const height = merged[0]?.height ?? project.ceilingHeight
  const wall = { ...(merged[0] ?? {}), ...wallFromPoints(merged[0]?.id ?? id, { x: a.x + dir.x * from, z: a.z + dir.z * from }, { x: a.x + dir.x * to, z: a.z + dir.z * to }, height) }
  if (merged.length === 1 && Math.abs(merged[0].width - wall.width) < 0.001) return project
  const ids = new Set(merged.map((m) => m.id))
  const next = { ...project, features: [...project.features.filter((f) => !ids.has(f.id)), wall] }
  return refreshOpenings(reassignToWall(next, ids, wall))
}

/** Removes the part of any collinear wall covered by the drag from a to b; leftover pieces of at least 25 cm stay. */
export function eraseWallSegment(project: ProjectState, a: Point, b: Point, makeId: () => string): ProjectState {
  const length = distance(a, b)
  if (length < 0.1) return project
  const dir = unit(sub(b, a))
  let next = project
  for (const wall of project.features.filter(isWall)) {
    if (!collinear(wall, a, dir)) continue
    const [p, q] = wallEndpoints(wall), tp = dot(sub(p, a), dir), tq = dot(sub(q, a), dir)
    const lo = Math.min(tp, tq), hi = Math.max(tp, tq)
    if (hi <= 0.001 || lo >= length - 0.001) continue
    const at = (t: number) => ({ x: a.x + dir.x * t, z: a.z + dir.z * t })
    const pieces = [[lo, Math.max(lo, 0)], [Math.min(hi, length), hi]].filter(([s, e]) => e - s >= 0.25).map(([s, e]) => wallFromPoints('', at(s), at(e), wall.height))
    const kept = pieces.map((piece, i) => ({ ...wall, ...piece, id: i === 0 ? wall.id : makeId() }))
    // Openings and wall items inside the removed part go with it (items are detached); the rest move to the piece they sit on.
    const inGap = (f: { x: number; z: number }) => { const t = dot(sub(f, a), dir); return t > Math.max(lo, 0) && t < Math.min(hi, length) }
    next = { ...next, features: [...next.features.filter((f) => f.id !== wall.id && !(f.wallId === wall.id && inGap(f))), ...kept], objects: next.objects.map((o) => o.wallId === wall.id && inGap(o) ? { ...o, wallId: undefined } : o) }
    kept.forEach((piece) => {
      const [s, e] = wallEndpoints(piece).map((point) => dot(sub(point, a), dir)), within = (f: { x: number; z: number }) => { const t = dot(sub(f, a), dir); return t >= Math.min(s, e) - 0.001 && t <= Math.max(s, e) + 0.001 }
      next = { ...next, features: next.features.map((f) => f.type !== 'wall' && f.wallId === wall.id && within(f) ? { ...f, wallId: piece.id, wallOffset: undefined } : f), objects: next.objects.map((o) => o.wallId === wall.id && within(o) ? reassignToWall({ ...next, objects: [o] }, new Set([wall.id]), piece).objects[0] : o) }
    })
  }
  return next === project ? project : refreshOpenings(next)
}

/** Sets a wall's length by moving its end corner along the wall, and shifting the next wall with it so a closed room stays closed. */
export function setWallLength(project: ProjectState, id: string, length: number): ProjectState {
  const wall = project.features.find((f) => f.id === id && isWall(f))
  if (!wall || !Number.isFinite(length) || length < 0.25) return project
  const [a, b] = wallEndpoints(wall), dir = unit(sub(b, a)), delta = { x: dir.x * (length - wall.width), z: dir.z * (length - wall.width) }
  const move = (p: Point) => ({ x: p.x + delta.x, z: p.z + delta.z })
  const neighbour = project.features.filter(isWall).find((f) => f.id !== id && wallEndpoints(f).some((p) => distance(p, b) < 0.001))
  let result = moveWallEndpoint(project, id, b, move(b))
  if (neighbour) {
    const far = wallEndpoints(neighbour).find((p) => distance(p, b) >= 0.001)
    if (far && distance(far, a) > 0.001) result = moveWallEndpoint(result, neighbour.id, far, move(far))
  }
  return result
}
