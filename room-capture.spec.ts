import { test, expect } from '@playwright/test'
import { getFloorRegions, wallEndpoints, type Point } from './src/editor'
import { cornersFromEntries, cornersFromMeasuredWalls, projectFromCorners, wallLengths, type MeasuredWall } from './src/roomCapture'

const area = (corners: Point[]) => getFloorRegions(projectFromCorners(corners).features)[0].area
const close = (a: number[], b: number[], digits = 2) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits))

test('hand-measured rectangle builds four walls with the measured lengths', () => {
  const { corners, adjusted } = cornersFromEntries([{ length: 4.2, turn: 90 }, { length: 3.1, turn: 90 }, { length: 4.2, turn: 90 }, { length: 3.1, turn: 90 }])
  expect(adjusted).toBe(false)
  close(wallLengths(corners), [4.2, 3.1, 4.2, 3.1])
  const project = projectFromCorners(corners, { ceilingHeight: 2.6 })
  expect(project.features.filter((f) => f.type === 'wall')).toHaveLength(4)
  expect(project.features.every((f) => f.height === 2.6)).toBe(true)
  expect(getFloorRegions(project.features)[0].area).toBeCloseTo(13.02, 2)
  expect(project.objects).toEqual([])
})

test('small closing errors are distributed without bending a square room', () => {
  const { corners, adjusted, gap } = cornersFromEntries([{ length: 4, turn: 90 }, { length: 3, turn: 90 }, { length: 4.06, turn: 90 }, { length: 2.97, turn: 90 }])
  expect(adjusted).toBe(true)
  expect(gap).toBeGreaterThan(0.05)
  const project = projectFromCorners(corners)
  for (const wall of project.features) expect(Math.abs(Math.sin(wall.rotation * 2))).toBeLessThan(1e-6)
  expect(getFloorRegions(project.features)).toHaveLength(1)
})

test('large gaps are rejected unless the user adds the closing wall', () => {
  const open = [{ length: 4, turn: 90 }, { length: 3, turn: 90 }, { length: 4, turn: 90 }]
  expect(() => cornersFromEntries(open)).toThrow('from where you started')
  const { corners } = cornersFromEntries(open, true)
  expect(corners).toHaveLength(4)
  expect(area(corners)).toBeCloseTo(12, 3)
})

test('L-shaped room uses left turns for the inside corner', () => {
  const { corners } = cornersFromEntries([{ length: 6, turn: 90 }, { length: 2, turn: 90 }, { length: 3, turn: -90 }, { length: 2, turn: 90 }, { length: 3, turn: 90 }, { length: 4, turn: 90 }])
  expect(area(corners)).toBeCloseTo(18, 3)
})

test('crossing walls and wrong turns are rejected', () => {
  expect(() => projectFromCorners([{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 4 }])).toThrow('cross')
  expect(() => cornersFromEntries([{ length: 4, turn: 90 }, { length: 3, turn: -90 }, { length: 4, turn: 90 }])).toThrow()
})

test('AR walls meet at line intersections even when corners were not reached', () => {
  const r = 0.4, cos = Math.cos(r), sin = Math.sin(r)
  const world = (x: number, z: number): Point => ({ x: 10 + x * cos - z * sin, z: -3 + x * sin + z * cos })
  const walls: MeasuredWall[] = [
    { a: world(0.8, 0.01), b: world(3.4, -0.01) },
    { a: world(5.01, 0.5), b: world(4.99, 3.2) },
    { a: world(4.1, 4.01), b: world(0.6, 3.99) },
    { a: world(-0.01, 3.5), b: world(0.01, 0.4) },
  ]
  const { corners } = cornersFromMeasuredWalls(walls)
  close(wallLengths(corners), [5, 4, 5, 4])
  const project = projectFromCorners(corners)
  const [a, b] = wallEndpoints(project.features[0])
  expect(Math.abs(a.z - b.z)).toBeLessThan(1e-6)
  expect(getFloorRegions(project.features)[0].area).toBeCloseTo(20, 1)
})

test('AR straightening can be turned off for angled walls', () => {
  const walls: MeasuredWall[] = [{ a: { x: 0, z: 0 }, b: { x: 4, z: 0 } }, { a: { x: 4, z: 0.2 }, b: { x: 4.2, z: 3 } }, { a: { x: 3, z: 3 }, b: { x: 1, z: 3 } }, { a: { x: 0, z: 2 }, b: { x: 0, z: 1 } }]
  const straight = cornersFromMeasuredWalls(walls).corners, raw = cornersFromMeasuredWalls(walls, false).corners
  expect(straight[2].x).toBeCloseTo(straight[1].x, 6)
  expect(raw[2].x).not.toBeCloseTo(raw[1].x, 2)
  expect(() => cornersFromMeasuredWalls(walls.slice(0, 2))).toThrow('between 3')
  expect(() => cornersFromMeasuredWalls([...walls.slice(0, 3), { a: { x: 0, z: 1 }, b: { x: 0.05, z: 1 } }])).toThrow('20 cm')
})
