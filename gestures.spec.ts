import { test, expect } from '@playwright/test'
import { angleStep, beyondSlop, classifyTwoFinger, fingerAngle, isDoubleTap, snapRotation } from './src/gestures'

test('drags wait for the touch slop', () => {
  expect(beyondSlop({ x: 10, y: 10 }, { x: 14, y: 13 })).toBe(false)
  expect(beyondSlop({ x: 10, y: 10 }, { x: 17, y: 10 })).toBe(true)
})

test('double taps must be quick and close together', () => {
  const first = { x: 100, y: 100, time: 1000 }
  expect(isDoubleTap(null, first)).toBe(false)
  expect(isDoubleTap(first, { x: 110, y: 108, time: 1250 })).toBe(true)
  expect(isDoubleTap(first, { x: 100, y: 100, time: 1400 })).toBe(false)
  expect(isDoubleTap(first, { x: 140, y: 100, time: 1100 })).toBe(false)
})

test('two-finger gestures lock to whichever of twist or pinch passes its threshold first', () => {
  expect(classifyTwoFinger(0.05, 1.03)).toBe('pending')
  expect(classifyTwoFinger(0.2, 1.02)).toBe('rotate')
  expect(classifyTwoFinger(0.03, 1.2)).toBe('zoom')
  expect(classifyTwoFinger(-0.3, 0.95)).toBe('rotate')
})

test('rotation settles on 45° steps only when close, and twists unwrap across ±180°', () => {
  const degrees = (value: number) => value * Math.PI / 180
  expect(snapRotation(degrees(-88))).toBeCloseTo(degrees(-90))
  expect(snapRotation(degrees(47))).toBeCloseTo(degrees(45))
  expect(snapRotation(degrees(30))).toBeCloseTo(degrees(30))
  expect(angleStep(degrees(175), degrees(-175))).toBeCloseTo(degrees(10))
  expect(fingerAngle([{ x: 0, y: 0 }, { x: 0, y: 10 }])).toBeCloseTo(Math.PI / 2)
})
