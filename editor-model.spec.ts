import { test, expect } from '@playwright/test'
import { attachOpening, emptyProject, getFloorRegions, fitsFloor, isProject, migrateProject, moveWallEndpoint, overlaps, placeObject, placementWarnings, snapBuildPoint, wallFromPoints, wallEndpoints, wallThickness, type Point, type ProjectState } from './src/editor'

import { analyzePlanPixels, createProjectFromPlan, type PlanAnalysis } from './src/planImport'

function planImage(rects: number[][]) {
  const width = 500, height = 400, data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [x, y, w, h, shade = 190] of rects) for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const i = (py * width + px) * 4
    data[i] = data[i + 1] = data[i + 2] = shade
  }
  return { width, height, data }
}

const loop = (points: Point[], prefix = 'wall') => points.map((a, i) => wallFromPoints(`${prefix}-${i}`, a, points[(i + 1) % points.length], 2.8))
const square: Point[] = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }]
const room = (): ProjectState => ({ ...emptyProject(), features: loop(square) })
const sofa = { id: 'sofa', productId: 'sofa-haven', x: 0, z: 0, rotation: 0 }
const area = (p: ProjectState) => getFloorRegions(p.features).reduce((sum, f) => sum + f.area, 0)

test('plan extraction preserves disjoint collinear walls and rejects invented bounding rooms', () => {
  const result = analyzePlanPixels(planImage([[30, 50, 100, 10], [210, 50, 180, 10], [80, 180, 280, 10], [200, 260, 120, 1, 80], [10, 330, 2, 30, 80]]))
  const row = result.walls.filter((wall) => wall.horizontal && Math.abs(wall.a.y - 54.5) < 2)
  expect(row).toHaveLength(2)
  expect(row[0].b.x < 140 || row[1].b.x < 140).toBe(true)
  expect(result.walls.every((wall) => wall.horizontal)).toBe(true)
  expect(result.bounds.minX).toBeGreaterThan(20)
  expect(result.openings.some((opening) => opening.type === 'unconfirmed')).toBe(true)
  expect(() => analyzePlanPixels(planImage([]))).toThrow('No solid wall bands')
  expect(() => analyzePlanPixels(planImage([[30, 40, 300, 1, 0], [30, 40, 1, 200, 0]]))).toThrow('No solid wall bands')
})

test('plan extraction retains an irregular footprint instead of filling its missing corner', () => {
  const result = analyzePlanPixels(planImage([[100, 30, 220, 10], [100, 30, 10, 90], [30, 110, 80, 10], [30, 110, 10, 200], [30, 300, 290, 10], [310, 30, 10, 280]]))
  expect(result.walls).toHaveLength(6)
  const analysis: PlanAnalysis = { ...result, openings: [], sourceWidth: 500, sourceHeight: 400, previewUrl: '', pageCount: 1 }
  const project = createProjectFromPlan(analysis, 10, 'Irregular import')
  expect(getFloorRegions(project.features)).toHaveLength(1)
  expect(project.objects).toEqual([])
  expect(isProject(project)).toBe(true)
  expect(getFloorRegions(project.features)[0].area).toBeLessThan(10 * 10)
  expect(() => createProjectFromPlan(analysis, NaN, '')).toThrow('measured')
  expect(() => createProjectFromPlan(analysis, 100, '')).toThrow('measured')
  expect(createProjectFromPlan({ ...analysis, openings: [{ ...analysis.walls[0], type: 'unconfirmed' }] }, 10, '').features).toEqual(project.features)
})

test('plan openings use their actual supporting wall and preserve measured width', () => {
  const walls: PlanAnalysis['walls'] = [
    { a: { x: 10, y: 20 }, b: { x: 80, y: 20 }, horizontal: true, thickness: 8 },
    { a: { x: 110, y: 20 }, b: { x: 210, y: 20 }, horizontal: true, thickness: 8 },
    { a: { x: 10, y: 20 }, b: { x: 10, y: 150 }, horizontal: false, thickness: 8 },
    { a: { x: 210, y: 20 }, b: { x: 210, y: 150 }, horizontal: false, thickness: 8 },
    { a: { x: 10, y: 150 }, b: { x: 210, y: 150 }, horizontal: true, thickness: 8 },
  ]
  const analysis: PlanAnalysis = { walls, openings: [{ a: { x: 80, y: 20 }, b: { x: 110, y: 20 }, horizontal: true, thickness: 8, type: 'window' }], bounds: { minX: 10, maxX: 210, minY: 20, maxY: 150 }, sourceWidth: 220, sourceHeight: 160, previewUrl: '', pageCount: 1, warnings: [] }
  const project = createProjectFromPlan(analysis, 8, 'Measured import'), opening = project.features.find((f) => f.type === 'window')!
  expect(opening.width).toBeCloseTo(1.2)
  expect(opening.x).toBeCloseTo(-0.6)
  expect(project.features.find((f) => f.id === opening.wallId)?.z).toBeCloseTo(-2.6)
  expect(getFloorRegions(project.features)).toHaveLength(1)
  const inferred = createProjectFromPlan({ ...analysis, openings: [{ ...analysis.openings[0], type: 'unconfirmed', suggestedType: 'window' }] }, 8, 'WIP')
  expect(inferred.features).toEqual(project.features)
})

test('wall thickness survives import, persistence and connected endpoint edits', () => {
  const image = planImage([[40, 40, 300, 16], [40, 320, 300, 16], [40, 40, 16, 296], [324, 40, 16, 296], [180, 56, 3, 264, 230]])
  const detection = analyzePlanPixels(image)
  const partition = detection.walls.find((wall) => !wall.horizontal && Math.abs(wall.a.x - 181) < 3)
  expect(partition).toBeTruthy()
  expect(partition!.thickness).toBeLessThan(5)
  const analysis: PlanAnalysis = { ...detection, openings: [], sourceWidth: 500, sourceHeight: 400, previewUrl: '', pageCount: 1 }
  const project = createProjectFromPlan(analysis, 10, 'Variable walls')
  const thicknesses = project.features.map(wallThickness)
  expect(Math.max(...thicknesses)).toBeGreaterThan(Math.min(...thicknesses) * 3)
  const restored = migrateProject(JSON.parse(JSON.stringify(project)))
  expect(restored.features.map(wallThickness)).toEqual(thicknesses)
  const wall = project.features[0], previous = wallEndpoints(wall)[0]
  const changed = moveWallEndpoint(project, wall.id, previous, { x: previous.x + 0.25, z: previous.z })
  expect(changed.features.map(wallThickness)).toEqual(thicknesses)
  expect(wallThickness(wallFromPoints('legacy', { x: 0, z: 0 }, { x: 1, z: 0 }, 2.8))).toBe(0.12)
  expect(isProject({ ...project, features: [{ ...wall, thickness: -1 }] })).toBe(false)
  expect(isProject({ ...project, features: [{ ...wall, thickness: Infinity }] })).toBe(false)
})

test('furniture clearance and snapping use the wall surface rather than the centreline', () => {
  const p = room(), north = p.features[0]
  p.features[0] = { ...north, thickness: 0.6 }
  const object = { ...sofa, productId: 'chair-arc', x: 0, z: -1.6 }
  expect(fitsFloor(object, { ...p, features: p.features.map((f) => ({ ...f, thickness: 0.08 })) })).toBe(true)
  expect(fitsFloor(object, p)).toBe(false)
  const snapped = placeObject({ ...object, z: -1.3 }, p, false, true)
  expect(fitsFloor(snapped, p)).toBe(true)
  expect(snapped.z).toBeGreaterThan(object.z)
})

test('new spaces contain only a build grid, never implicit walls, floors or furniture', () => {
  const p = emptyProject()
  expect(p.features).toEqual([])
  expect(p.objects).toEqual([])
  expect(getFloorRegions(p.features)).toEqual([])
  expect(fitsFloor(sofa, p)).toBe(false)
})

test('a floor appears only after the final wall closes the loop, in either direction', () => {
  const p = room()
  expect(getFloorRegions(p.features.slice(0, 3))).toEqual([])
  expect(area(p)).toBeCloseTo(16)
  expect(getFloorRegions(p.features)).toHaveLength(1)
  expect(area({ ...p, features: loop([...square].reverse()) })).toBeCloseTo(16)
  expect(area({ ...p, features: p.features.filter((_, i) => i !== 1) })).toBe(0)
})

test('L-shaped and diagonal outlines produce exact polygon floors', () => {
  const p = { ...emptyProject(), features: loop([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }]) }
  expect(area(p)).toBeCloseTo(12)
  expect(fitsFloor({ ...sofa, productId: 'chair-arc', x: 3, z: 3 }, p)).toBe(false)
  expect(fitsFloor({ ...sofa, productId: 'chair-arc', x: 1, z: 3 }, p)).toBe(true)
  expect(area({ ...p, features: loop([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 0, z: 3 }]) })).toBeCloseTo(6)
})

test('partitions, T junctions and crossing walls split rooms without duplicate floor area', () => {
  const p = room()
  p.features.push(wallFromPoints('partition', { x: 0, z: -2 }, { x: 0, z: 2 }, 2.8))
  expect(getFloorRegions(p.features)).toHaveLength(2)
  expect(area(p)).toBeCloseTo(16)
  p.features.push(wallFromPoints('cross', { x: -2, z: 0 }, { x: 2, z: 0 }, 2.8))
  expect(getFloorRegions(p.features)).toHaveLength(4)
  expect(area(p)).toBeCloseTo(16)
  expect(fitsFloor(sofa, p)).toBe(false)
})

test('duplicate edges, dangling walls and disconnected rooms are handled', () => {
  const p = room()
  p.features.push(...loop(square, 'duplicate'), wallFromPoints('stub', { x: -2, z: 0 }, { x: -3, z: 0 }, 2.8))
  expect(getFloorRegions(p.features)).toHaveLength(1)
  expect(area(p)).toBeCloseTo(16)
  p.features.push(...loop(square.map(({ x, z }) => ({ x: x + 6, z })), 'second'))
  expect(getFloorRegions(p.features)).toHaveLength(2)
  expect(area(p)).toBeCloseTo(32)
})

test('nested enclosed rooms do not double-count floor area', () => {
  const p = room()
  p.features.push(...loop(square.map(({ x, z }) => ({ x: x / 2, z: z / 2 })), 'inner'))
  expect(getFloorRegions(p.features)).toHaveLength(2)
  expect(area(p)).toBeCloseTo(16)
})

test('moving a connected corner preserves closure and updates its neighbours', () => {
  const p = room()
  const start = wallEndpoints(p.features[0])[0]
  const next = moveWallEndpoint(p, p.features[0].id, start, { x: -3, z: -2 })
  expect(getFloorRegions(next.features)).toHaveLength(1)
  expect(area(next)).toBeCloseTo(18)
  expect(wallEndpoints(next.features[3]).some((point) => point.x === -3 && point.z === -2)).toBe(true)
})

test('build snapping closes endpoints and projects onto wall segments', () => {
  expect(snapBuildPoint({ x: 2.08, z: 2.03 }, room())).toEqual({ x: 2, z: 2 })
  expect(snapBuildPoint({ x: 1.02, z: -1.93 }, room())).toEqual({ x: 1, z: -2 })
})

test('openings attach to a drawn wall and follow it when moved or rotated', () => {
  const p = room()
  const door = attachOpening({ id: 'door', type: 'door', x: 1.9, z: 0.4, rotation: 0, width: 0.9, height: 2.1 }, p)
  expect(door.wallId).toBe('wall-1')
  expect(door.x).toBeCloseTo(2)
  const wall = { ...p.features[1], x: 3, rotation: -Math.PI / 4 }
  const changed = { ...p, features: p.features.map((f) => f.id === wall.id ? wall : f) }
  const moved = attachOpening(door, changed)
  expect(moved.rotation).toBe(wall.rotation)
  expect(Math.abs(moved.x - 3)).toBeLessThan(0.5)
  expect(getFloorRegions([...p.features, door])).toHaveLength(1)
})

test('furniture fits actual enclosed geometry and keeps authoritative dimensions', () => {
  const p = room()
  expect(fitsFloor(sofa, p)).toBe(true)
  expect(fitsFloor({ ...sofa, x: 1.5 }, p)).toBe(false)
  expect(fitsFloor({ ...sofa, x: 0.875 }, p)).toBe(false)
  expect(fitsFloor({ ...sofa, x: 1.4, rotation: Math.PI / 2 }, p)).toBe(true)
  expect(placeObject({ ...sofa, x: 0.24 }, p, true).x).toBeCloseTo(0.2)
  expect(overlaps(sofa, { ...sofa, id: 'other', x: 0.5 })).toBe(true)
  expect(overlaps(sofa, { ...sofa, id: 'rug', productId: 'rug-loom' })).toBe(false)
  expect(placementWarnings({ ...p, features: [], objects: [sofa] })[0].message).toContain('outside an enclosed room')
})

test('legacy rectangular projects migrate once and keep their furniture and openings', () => {
  const old = { name: 'Saved room', roomType: 'Living room', width: 4, length: 5, ceilingHeight: 2.8, floorMaterial: 'Natural oak', wallMaterial: 'Warm white', objects: [sofa], features: [{ id: 'door', type: 'door' as const, x: 0, z: 2.5, rotation: 0, width: 0.9, height: 2.1 }] }
  const p = migrateProject(old)
  expect(area(p)).toBeCloseTo(20)
  expect(p.objects).toEqual([sofa])
  expect(p.features.find((f) => f.id === 'door')?.wallId).toBeTruthy()
  expect(migrateProject(p)).toEqual(p)
  expect(isProject(p)).toBe(true)
  expect(isProject({ ...p, width: Infinity })).toBe(false)
  expect(isProject({ ...p, objects: [{ ...sofa, productId: 'unknown' }] })).toBe(false)
})
