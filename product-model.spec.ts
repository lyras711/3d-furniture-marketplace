import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { inspectGlb } from './scripts/validate-model'

for (const variant of ['grey-light', 'grey-dark']) {
  test(`Vancouver ${variant} exported geometry preserves orientation and photo-specific parts`, async () => {
    const product = JSON.parse(await readFile('artifacts/products/polihome/vancouver/product.json', 'utf8'))
    const model = await inspectGlb(await readFile('public/catalog/polihome/vancouver/shared.glb'))
    const source = product.dimensionsCm
    for (const [axis, expected] of [['length', source.length], ['height', source.height], ['depth', source.cornerDepth]] as const) {
      expect(Math.abs(model.dimensionsCm[axis] - expected) / expected).toBeLessThanOrEqual(0.03)
    }
    expect(Math.abs(model.floorY)).toBeLessThan(0.001)
    expect(model.centerXZ.every((value) => Math.abs(value) < 0.005)).toBe(true)
    expect(model.polygonCount).toBeGreaterThan(100000)
    const parts = model.components
    expect(parts.filter((p) => p.name.startsWith('Vancouver_Back_Cushion_'))).toHaveLength(3)
    expect(parts.filter((p) => p.name.startsWith('Vancouver_Seat_') && !p.name.includes('Seam'))).toHaveLength(2)
    expect(parts.filter((p) => p.name.startsWith('Vancouver_Loose_Pillow_'))).toHaveLength(2)
    expect(parts.some((p) => p.name === 'Vancouver_Chaise_Pull_Strap')).toBe(true)
    for (const arm of parts.filter((p) => p.name.startsWith('Vancouver_Arm_'))) expect(arm.max[1]).toBeLessThan(source.height / 100 - 0.1)
    for (const foot of parts.filter((p) => p.name.startsWith('Vancouver_Plastic_Foot_'))) {
      expect(foot.min[1]).toBeCloseTo(0, 3)
      expect(foot.max[1]).toBeCloseTo(source.feetHeight / 100, 3)
    }
    expect((model.json.images as unknown[]).length).toBeGreaterThanOrEqual(3)
  })
}

test('GLB inspection rejects corrupt exports instead of accepting metadata', async () => {
  await expect(inspectGlb(Buffer.from('invalid'))).rejects.toThrow('Invalid GLB')
})
