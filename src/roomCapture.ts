import { emptyProject, getFloorRegions, isProject, polygonArea, wallFromPoints, type Point, type ProjectState } from './editor'

/** Two floor points anywhere along the base of one wall, in metres. */
export type MeasuredWall = { a: Point; b: Point }
/** One wall walked by hand: its length in metres, then the turn in degrees at its end corner (positive = right in plan view). */
export type WallEntry = { length: number; turn: number }
export type CaptureResult = { corners: Point[]; gap: number; adjusted: boolean }

export const MAX_CAPTURED_WALLS = 40
const MIN_WALL = 0.2, MAX_EXTENT = 38, STRAIGHTEN_DEGREES = 7, PARALLEL_DEGREES = 12
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z })
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const rad = (degrees: number) => degrees * Math.PI / 180

export const closeTolerance = (perimeter: number) => Math.min(0.5, Math.max(0.1, perimeter * 0.03))

/** Corners of a hand-measured room: walk each wall in turn and distribute the closing gap with the transit rule, which keeps square rooms square. */
export function cornersFromEntries(entries: WallEntry[], closeGap = false): CaptureResult {
  if (entries.length < 3 || entries.length > MAX_CAPTURED_WALLS) throw new Error(`Measure between 3 and ${MAX_CAPTURED_WALLS} walls.`)
  if (entries.some((entry) => !Number.isFinite(entry.length) || entry.length < MIN_WALL || entry.length > MAX_EXTENT || !Number.isFinite(entry.turn))) throw new Error(`Each wall must be between ${MIN_WALL} and ${MAX_EXTENT} m.`)
  let heading = 0
  const steps = entries.map((entry) => { const step = { x: Math.cos(rad(heading)) * entry.length, z: Math.sin(rad(heading)) * entry.length }; heading += entry.turn; return step })
  const end = steps.reduce((sum, step) => ({ x: sum.x + step.x, z: sum.z + step.z }), { x: 0, z: 0 })
  const gap = Math.hypot(end.x, end.z), perimeter = entries.reduce((sum, entry) => sum + entry.length, 0)
  const walk = (list: Point[]) => list.reduce<Point[]>((points, step) => [...points, { x: points.at(-1)!.x + step.x, z: points.at(-1)!.z + step.z }], [{ x: 0, z: 0 }])
  if (gap <= 0.005) return { corners: walk(steps).slice(0, -1), gap, adjusted: false }
  if (closeGap) return { corners: walk(steps), gap, adjusted: false }
  if (gap > closeTolerance(perimeter)) throw new Error(`The walls end ${formatMetres(gap)} from where you started. Check the lengths and turns, or add the missing wall.`)
  const sumX = steps.reduce((sum, step) => sum + Math.abs(step.x), 0), sumZ = steps.reduce((sum, step) => sum + Math.abs(step.z), 0)
  const corrected = steps.map((step) => ({ x: step.x - (sumX ? end.x * Math.abs(step.x) / sumX : 0), z: step.z - (sumZ ? end.z * Math.abs(step.z) / sumZ : 0) }))
  return { corners: walk(corrected).slice(0, -1), gap, adjusted: true }
}

/** Corners of an AR-measured room. Each wall is the infinite line through its two floor points; corners are where consecutive walls meet, so the user never needs to reach a blocked corner. */
export function cornersFromMeasuredWalls(walls: MeasuredWall[], straighten = true): CaptureResult {
  if (walls.length < 3 || walls.length > MAX_CAPTURED_WALLS) throw new Error(`Measure between 3 and ${MAX_CAPTURED_WALLS} walls.`)
  if (walls.some((wall) => ![wall.a.x, wall.a.z, wall.b.x, wall.b.z].every(Number.isFinite) || dist(wall.a, wall.b) < MIN_WALL)) throw new Error('Mark two points at least 20 cm apart on every wall.')
  const reference = Math.atan2(walls[0].b.z - walls[0].a.z, walls[0].b.x - walls[0].a.x)
  const lines = walls.map((wall) => {
    let angle = Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x)
    const snapped = reference + Math.round((angle - reference) / (Math.PI / 2)) * Math.PI / 2
    if (straighten && Math.abs(angle - snapped) <= rad(STRAIGHTEN_DEGREES)) angle = snapped
    return { origin: { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.z + wall.b.z) / 2 }, direction: { x: Math.cos(angle), z: Math.sin(angle) }, wall }
  })
  const corners = lines.map((line, index) => {
    const previous = lines[(index - 1 + lines.length) % lines.length], denominator = cross(previous.direction, line.direction)
    if (Math.abs(denominator) < Math.sin(rad(PARALLEL_DEGREES))) return { x: (previous.wall.b.x + line.wall.a.x) / 2, z: (previous.wall.b.z + line.wall.a.z) / 2 }
    const t = cross(sub(line.origin, previous.origin), line.direction) / denominator
    const corner = { x: previous.origin.x + previous.direction.x * t, z: previous.origin.z + previous.direction.z * t }
    if (Math.max(dist(corner, previous.origin), dist(corner, line.origin)) > MAX_EXTENT) throw new Error(`Walls ${index || lines.length} and ${index + 1} do not meet near a corner. Re-measure one of them.`)
    return corner
  })
  return { corners, gap: 0, adjusted: straighten }
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a)), d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c))
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Aligns the first wall with +X, centres the outline on the build grid, and creates an editable schema-v3 project. */
export function projectFromCorners(corners: Point[], options: { name?: string; ceilingHeight?: number } = {}): ProjectState {
  if (corners.length < 3) throw new Error('A room needs at least 3 walls.')
  const angle = Math.atan2(corners[1].z - corners[0].z, corners[1].x - corners[0].x), cos = Math.cos(-angle), sin = Math.sin(-angle)
  const rotated = corners.map((p) => ({ x: p.x * cos - p.z * sin, z: p.x * sin + p.z * cos }))
  const xs = rotated.map((p) => p.x), zs = rotated.map((p) => p.z)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const points = rotated.map((p) => ({ x: Math.round((p.x - cx) * 1000) / 1000, z: Math.round((p.z - cz) * 1000) / 1000 }))
  const extentX = Math.max(...xs) - Math.min(...xs), extentZ = Math.max(...zs) - Math.min(...zs)
  if (extentX > MAX_EXTENT || extentZ > MAX_EXTENT) throw new Error(`The room is larger than ${MAX_EXTENT} m. Measure one room at a time.`)
  if (points.some((p, i) => dist(p, points[(i + 1) % points.length]) < MIN_WALL)) throw new Error('Two corners are almost on top of each other. Re-measure the short wall.')
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue
    if (segmentsCross(points[i], points[i + 1], points[j], points[(j + 1) % points.length])) throw new Error('The walls cross each other. Check the turn direction at each corner.')
  }
  if (Math.abs(polygonArea(points)) < 1) throw new Error('The measured room is smaller than 1 m².')
  const project = emptyProject(options.name || 'Measured room')
  project.roomType = 'Measured room'
  if (options.ceilingHeight !== undefined) {
    if (!Number.isFinite(options.ceilingHeight) || options.ceilingHeight < 2 || options.ceilingHeight > 6) throw new Error('Enter a ceiling height between 2 and 6 m.')
    project.ceilingHeight = options.ceilingHeight
  }
  project.width = Math.min(40, Math.max(12, Math.ceil(extentX + 2))); project.length = Math.min(40, Math.max(12, Math.ceil(extentZ + 2)))
  project.features = points.map((p, i) => wallFromPoints(`measured-wall-${i}`, p, points[(i + 1) % points.length], project.ceilingHeight))
  if (!isProject(project) || getFloorRegions(project.features).length !== 1) throw new Error('These measurements do not form one closed room.')
  return project
}

/** Open path walked so far, starting at the origin, for live previews. */
export function entryPath(entries: WallEntry[]): Point[] {
  let heading = 0
  return entries.reduce<Point[]>((points, entry) => { const last = points.at(-1)!, next = { x: last.x + Math.cos(rad(heading)) * entry.length, z: last.z + Math.sin(rad(heading)) * entry.length }; heading += entry.turn; return [...points, next] }, [{ x: 0, z: 0 }])
}

export const wallLengths = (corners: Point[]) => corners.map((p, i) => dist(p, corners[(i + 1) % corners.length]))
export const formatMetres = (metres: number) => metres < 1 ? `${Math.round(metres * 100)} cm` : `${metres.toFixed(2)} m`
