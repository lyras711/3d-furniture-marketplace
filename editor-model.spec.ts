import { test, expect } from '@playwright/test'
import { attachOpening, emptyProject, getFloorRegions, fitsFloor, isProject, migrateProject, moveWallEndpoint, overlaps, placeObject, placementWarnings, snapBuildPoint, wallFromPoints, wallEndpoints, type Point, type ProjectState } from './src/editor'

const loop = (points: Point[], prefix = 'wall') => points.map((a, i) => wallFromPoints(`${prefix}-${i}`, a, points[(i + 1) % points.length], 2.8))
const square: Point[] = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }]
const room = (): ProjectState => ({ ...emptyProject(), features: loop(square) })
const sofa = { id: 'sofa', productId: 'sofa-haven', x: 0, z: 0, rotation: 0 }
const area = (p: ProjectState) => getFloorRegions(p.features).reduce((sum, f) => sum + f.area, 0)

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
