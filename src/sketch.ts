import type { Point } from './editor'

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z })
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const grid = (p: Point): Point => ({ x: Math.round(p.x * 4) / 4, z: Math.round(p.z * 4) / 4 })
const SNAP_RAD = 12 * Math.PI / 180

/** Ramer–Douglas–Peucker: keeps the points that matter for the outline's shape. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]], span = dist(a, b) || 1
  let worst = 0, index = 0
  points.forEach((p, i) => { const d = Math.abs(cross(sub(b, a), sub(p, a))) / span; if (i > 0 && i < points.length - 1 && d > worst) { worst = d; index = i } })
  if (worst <= epsilon) return [a, b]
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)]
}

/**
 * Turns freehand strokes into straight wall segments.
 * Each stroke is simplified to its corners, directions within 12° of a 45° step are squared up,
 * corners are re-intersected from those lines, near-closed strokes are closed, and corners land on the 25 cm grid.
 */
export function wallsFromSketch(strokes: Point[][]): [Point, Point][] {
  return strokes.flatMap((stroke) => {
    const length = stroke.slice(1).reduce((sum, p, i) => sum + dist(p, stroke[i]), 0)
    if (stroke.length < 2 || length < 0.5) return []
    const xs = stroke.map((p) => p.x), zs = stroke.map((p) => p.z)
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
    let corners = simplify(stroke, Math.max(0.15, extent * 0.06))
    const closed = corners.length >= 4 && dist(corners[0], corners[corners.length - 1]) < Math.max(0.6, length * 0.15)
    if (closed) corners = corners.slice(0, -1)
    const count = closed ? corners.length : corners.length - 1
    let lines = Array.from({ length: count }, (_, i) => {
      const a = corners[i], b = corners[(i + 1) % corners.length]
      let angle = Math.atan2(b.z - a.z, b.x - a.x)
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      if (Math.abs(angle - snapped) <= SNAP_RAD) angle = snapped
      return { origin: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, dir: { x: Math.cos(angle), z: Math.sin(angle) }, a, b }
    }).filter((line) => dist(line.a, line.b) >= 0.3)
    // Consecutive lines that ended up parallel are one wall drawn with a wobble.
    lines = lines.filter((line, i) => i === 0 || Math.abs(cross(line.dir, lines[i - 1].dir)) > 0.05 || dist(line.origin, lines[i - 1].origin) > 1.5)
    if (closed && lines.length > 1 && Math.abs(cross(lines[0].dir, lines[lines.length - 1].dir)) <= 0.05) lines.pop()
    if (!lines.length) return []
    const meet = (p: (typeof lines)[number], q: (typeof lines)[number]): Point => {
      const d = cross(p.dir, q.dir)
      if (Math.abs(d) < 0.05) return { x: (p.b.x + q.a.x) / 2, z: (p.b.z + q.a.z) / 2 }
      const t = cross(sub(q.origin, p.origin), q.dir) / d
      return { x: p.origin.x + p.dir.x * t, z: p.origin.z + p.dir.z * t }
    }
    const onLine = (line: (typeof lines)[number], p: Point): Point => { const t = (p.x - line.origin.x) * line.dir.x + (p.z - line.origin.z) * line.dir.z; return { x: line.origin.x + line.dir.x * t, z: line.origin.z + line.dir.z * t } }
    const points = closed && lines.length >= 3
      ? lines.map((line, i) => meet(lines[(i - 1 + lines.length) % lines.length], line))
      : [onLine(lines[0], lines[0].a), ...lines.slice(1).map((line, i) => meet(lines[i], line)), onLine(lines[lines.length - 1], lines[lines.length - 1].b)]
    const snapped = points.map(grid)
    const segments = (closed && lines.length >= 3 ? snapped.map((p, i) => [p, snapped[(i + 1) % snapped.length]]) : snapped.slice(1).map((p, i) => [snapped[i], p])) as [Point, Point][]
    return segments.filter(([a, b]) => dist(a, b) >= 0.25)
  })
}
