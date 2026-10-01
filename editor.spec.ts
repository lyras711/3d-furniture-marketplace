import { test, expect, type Page } from '@playwright/test'
import { emptyProject, wallFromPoints } from './src/editor'

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' })
const url = `${(process.env.TEST_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')}/planner`
const square = [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]]
const frame = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const save = async (page: Page) => {
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  return page.evaluate(() => JSON.parse(localStorage.getItem('forma-room-planner-project')!))
}
async function gridPoint(page: Page, x: number, z: number) {
  const box = (await page.locator('canvas').boundingBox())!
  const zoom = Math.min(box.width / 13.2, box.height / 13.8)
  return { x: box.x + box.width / 2 + x * zoom, y: box.y + box.height / 2 + z * zoom }
}
async function segment(page: Page, a: number[], b: number[]) {
  await frame(page)
  const start = await gridPoint(page, a[0], a[1]), end = await gridPoint(page, b[0], b[1])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  await frame(page)
}
async function tapPoint(page: Page, point: number[]) {
  const position = await gridPoint(page, point[0], point[1])
  await page.touchscreen.tap(position.x, position.y)
  await frame(page)
}
async function touchDrag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] })
  for (let step = 1; step <= 8; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
  await frame(page)
}
async function build(page: Page, points = square) {
  await page.getByRole('button', { name: 'Wall', exact: true }).click()
  for (let i = 0; i < points.length; i++) await segment(page, points[i], points[(i + 1) % points.length])
  await page.keyboard.press('Escape')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '1')
}

test.beforeEach(async ({ page }) => {
  await page.goto(url)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await frame(page)
})

test('render studio preserves the project and exports the actual interior canvas', async ({ page }) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('button', { name: 'Render studio', exact: true })).toBeDisabled()
  await build(page)
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  const before = await save(page)
  await page.getByRole('button', { name: 'Render studio', exact: true }).click()
  const studio = page.getByRole('dialog', { name: 'Render studio', exact: true })
  await expect(studio.locator('canvas')).toHaveAttribute('data-render-ready', 'true', { timeout: 60000 })
  await expect(studio.getByText('Sample geometry · not retailer-accurate models')).toBeVisible()
  await studio.getByLabel('Exposure').fill('1.4')
  await studio.getByLabel('Camera position').selectOption('1')
  const download = page.waitForEvent('download')
  await studio.getByRole('button', { name: 'Save PNG' }).click()
  expect((await download).suggestedFilename()).toBe('formivo-interior.png')
  await studio.getByRole('button', { name: 'Path traced', exact: true }).click()
  await expect.poll(async () => Number(await studio.locator('canvas').getAttribute('data-samples')), { timeout: 60000 }).toBeGreaterThan(0)
  await studio.getByRole('button', { name: 'Back to editor' }).click()
  await expect(studio).toHaveCount(0)
  expect(await save(page)).toEqual(before)
  expect(errors).toEqual([])
})

test('unsupported path tracing keeps a usable live preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension as (this: WebGL2RenderingContext, name: string) => unknown
    WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) { return name === 'EXT_color_buffer_float' ? null : original.call(this, name) } as typeof WebGL2RenderingContext.prototype.getExtension
  })
  await page.reload()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await build(page)
  await page.getByRole('button', { name: 'Render studio', exact: true }).click()
  const studio = page.getByRole('dialog', { name: 'Render studio', exact: true })
  await expect(studio.locator('canvas')).toHaveAttribute('data-render-ready', 'true', { timeout: 60000 })
  await studio.getByRole('button', { name: 'Path traced', exact: true }).click()
  await expect(studio.getByRole('status')).toContainText('Path tracing unavailable')
  await expect(studio.getByRole('button', { name: 'Save PNG' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(studio).toHaveCount(0)
})

test('daylight study renders at desktop and mobile widths with local assets', async ({ page }) => {
  test.setTimeout(180000)
  const project = emptyProject('Daylight study')
  const corners = [{ x: -3, z: -2.5 }, { x: 3, z: -2.5 }, { x: 3, z: 2.5 }, { x: -3, z: 2.5 }]
  project.features = corners.map((a, i) => wallFromPoints(`wall-${i}`, a, corners[(i + 1) % 4], 2.8))
  project.features.push({ id: 'window', type: 'window', wallId: 'wall-3', wallOffset: 0, x: -3, z: 0, rotation: Math.PI / 2, width: 4, height: 2.4, sillHeight: 0.15 })
  project.objects = [
    { id: 'sofa', productId: 'sofa-haven', x: -0.3, z: -1.9, rotation: 0 },
    { id: 'rug', productId: 'rug-loom', x: -0.3, z: -0.85, rotation: 0 },
    { id: 'table', productId: 'table-arc', x: -0.3, z: -0.6, rotation: 0 },
    { id: 'lamp', productId: 'lamp-halo', x: 1.2, z: -1.9, rotation: 0 },
    { id: 'tree', productId: 'plant-olive', x: -2.5, z: -2.1, rotation: 0 },
    { id: 'console', productId: 'unit-line', x: 2.7, z: -0.4, rotation: -Math.PI / 2 },
  ]
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.evaluate((data) => localStorage.setItem('forma-room-planner-project', JSON.stringify(data)), project)
  await page.reload()
  await page.getByRole('button', { name: 'Render studio', exact: true }).click()
  const studio = page.getByRole('dialog', { name: 'Render studio', exact: true }), canvas = studio.locator('canvas')
  await expect(canvas).toHaveAttribute('data-render-ready', 'true', { timeout: 60000 })
  await page.screenshot({ path: '/tmp/forma-studio-desktop-live.png', fullPage: true })
  await studio.getByRole('button', { name: 'Path traced', exact: true }).click()
  await expect.poll(async () => Number(await canvas.getAttribute('data-samples')), { timeout: 120000 }).toBeGreaterThanOrEqual(256)
  await page.screenshot({ path: '/tmp/forma-studio-desktop-traced.png', fullPage: true })
  await studio.getByRole('button', { name: 'Live preview', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await studio.getByLabel('Camera position').selectOption('1')
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-studio-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  await page.keyboard.press('Escape')
  await expect(studio).toHaveCount(0)
  await page.screenshot({ path: '/tmp/forma-editor-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('new workspaces open in floor-plan build mode with empty, import, and template entry points', async ({ page }) => {
  await expect(page.locator('.canvas-label')).toContainText('Floor plan')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-wall-count', '0')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '0.00')
  await expect(page.getByText('Your space starts here')).toBeVisible()
  await expect(page.locator('.empty-import-button').filter({ hasText: 'Import floor plan' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use a room template', exact: true })).toBeVisible()
  const p = await save(page)
  expect(p.objects).toEqual([])
  expect(p.features).toEqual([])
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  await expect(page.getByRole('status')).toContainText('Close a loop of walls first')
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Room type')).toHaveCount(0)
  await expect(page.getByLabel('Width (m)')).toHaveCount(0)
  await page.getByLabel('Project name').fill('My own layout')
  await page.getByRole('button', { name: 'Create space' }).click()
  expect((await save(page)).features).toEqual([])
  await expect(page.locator('.canvas-label')).toContainText('Floor plan')
  await page.reload()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.canvas-label')).toContainText('Floor plan')
})

test('room templates create editable starter layouts without adding anything to the basket', async ({ page }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('button', { name: /^Living room/ }).click()
  await page.getByRole('button', { name: 'Create room', exact: true }).click()
  const project = await save(page)
  expect(project.roomType).toBe('Living room')
  expect(project.features).toHaveLength(4)
  expect(project.objects).toHaveLength(4)
  expect(project.objects.every((object: { inBasket?: boolean }) => object.inBasket === false)).toBe(true)
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '24.75')
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  await expect(page.locator('.shopping-item')).toHaveCount(0)
})

test('shopping list includes only objects explicitly added to the basket', async ({ page }) => {
  await build(page)
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  await page.getByRole('button', { name: 'Add selected object to basket' }).click()
  await page.getByTitle('Add Arc coffee table to room').click()
  const project = await save(page)
  expect(project.objects.map((object: { inBasket?: boolean }) => object.inBasket)).toEqual([true, false])
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  await expect(page.locator('.shopping-item')).toHaveCount(1)
  await expect(page.locator('.shopping-item')).toContainText('Haven three-seat sofa')
  await expect(page.locator('.shopping-item')).not.toContainText('Arc coffee table')
  await expect(page.locator('.drawer-total')).toContainText('€899')
})

test('desktop shift-selection moves, rotates, duplicates, and baskets products as a group', async ({ page }) => {
  await build(page)
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  await page.getByTitle('Add Arc coffee table to room').click()
  const before = await save(page), sofa = before.objects.find((object: { productId: string }) => object.productId === 'sofa-haven')!
  const sofaPoint = await gridPoint(page, sofa.x, sofa.z)
  await page.keyboard.down('Shift'); await page.mouse.click(sofaPoint.x, sofaPoint.y); await page.keyboard.up('Shift')
  await expect(page.getByRole('toolbar', { name: 'Multi-selection controls' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2 items selected' })).toBeVisible()
  await page.screenshot({ path: '/tmp/forma-multiselect-desktop.png', fullPage: true })
  await page.mouse.move(sofaPoint.x, sofaPoint.y); await page.mouse.down(); await page.mouse.move(sofaPoint.x + 24, sofaPoint.y, { steps: 6 }); await page.mouse.up()
  const moved = await save(page), dx = moved.objects.map((object: { x: number }, index: number) => object.x - before.objects[index].x)
  expect(dx[0]).toBeGreaterThan(0.1)
  expect(dx[0]).toBeCloseTo(dx[1], 1)
  await page.getByRole('button', { name: 'Rotate selected items 15 degrees' }).click()
  const rotated = await save(page)
  expect(rotated.objects.every((object: { rotation: number }) => object.rotation > 0)).toBe(true)
  await page.getByRole('button', { name: 'Add selected products to basket' }).click()
  expect((await save(page)).objects.every((object: { inBasket?: boolean }) => object.inBasket)).toBe(true)
  await page.getByRole('button', { name: 'Duplicate selected items' }).click()
  expect((await save(page)).objects.slice(2).every((object: { inBasket?: boolean }) => object.inBasket === false)).toBe(true)
  await page.getByRole('button', { name: 'Delete selected items' }).click()
  expect((await save(page)).objects).toHaveLength(2)
})

test('continuous wall drawing fills only a closed loop, deletion opens it, undo restores it', async ({ page }) => {
  await page.getByRole('button', { name: 'Wall', exact: true }).click()
  await expect(page.locator('.canvas-label')).toContainText('Floor plan')
  for (let i = 0; i < 3; i++) await segment(page, square[i], square[i + 1])
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-wall-count', '3')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '0')
  await expect(page.getByRole('button', { name: 'Wall', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await segment(page, square[3], square[0])
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
  await page.keyboard.press('Escape')
  const wall = await gridPoint(page, 0, -2.5)
  await page.mouse.click(wall.x, wall.y)
  await expect(page.getByRole('heading', { name: 'Wall', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove wall' }).click()
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '0')
  await page.getByTitle('Undo').click()
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
  await page.reload()
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '1')
})

test('irregular outlines and room partitions produce live non-rectangular floors', async ({ page }) => {
  await build(page, [[-3, -3], [3, -3], [3, 0], [0, 0], [0, 3], [-3, 3]])
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '27.00')
  await page.getByRole('button', { name: 'Wall', exact: true }).click()
  await segment(page, [-3, 0], [0, 0])
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '2')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '27.00')
  await page.keyboard.press('Escape')
  const canvas = page.locator('canvas'), box = (await canvas.boundingBox())!
  const point = await gridPoint(page, 2, 2)
  await page.locator('.product-card').filter({ hasText: 'Arc dining chair' }).dragTo(canvas, { targetPosition: { x: point.x - box.x, y: point.y - box.y } })
  await expect(page.getByRole('status')).toContainText('inside an enclosed room')
  expect((await save(page)).objects).toHaveLength(0)
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-custom-irregular.png', fullPage: true })
})

test('connected corner dragging updates walls and floors as one undo step', async ({ page }) => {
  await build(page)
  const middle = await gridPoint(page, 0, -2.5)
  await page.mouse.click(middle.x, middle.y)
  await expect(page.getByRole('heading', { name: 'Wall', exact: true })).toBeVisible()
  const before = await save(page)
  await segment(page, [2.5, -2.5], [3.5, -2.5])
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '1')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '27.50')
  await page.getByTitle('Undo').click()
  expect((await save(page)).features).toEqual(before.features)
})

test('Escape cancels an unfinished wall without leaving capture or phantom geometry', async ({ page }) => {
  const a = await gridPoint(page, -2, 0), b = await gridPoint(page, 2, 0)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-wall-count', '0')
  await build(page)
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
})

test('catalog category, retailer, search, sorting and clear filters still work', async ({ page }) => {
  await expect(page.locator('.product-card').first()).toHaveAttribute('draggable', 'true')
  await page.getByRole('button', { name: 'Seating', exact: true }).click()
  await expect(page.locator('.product-card')).toHaveCount(4)
  await page.getByLabel('Retailer filter').selectOption('Minoa Studio')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.getByPlaceholder('Search products').fill('no such product')
  await expect(page.getByText('No products found')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.locator('.product-card')).toHaveCount(22)
  await page.getByRole('button', { name: 'Bathroom', exact: true }).click()
  await expect(page.locator('.product-card')).toHaveCount(4)
  await page.getByRole('button', { name: 'Kitchen', exact: true }).click()
  await expect(page.locator('.product-card')).toHaveCount(3)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByLabel('Sort products').selectOption('price-low')
  await expect(page.locator('.product-card').first()).toContainText('Olive tree')
})

test('temporary room categories render without runtime errors', async ({ page }) => {
  const project = emptyProject('Temporary catalogue models')
  project.width = 12
  project.length = 12
  const corners = [{ x: -5.5, z: -5.5 }, { x: 5.5, z: -5.5 }, { x: 5.5, z: 5.5 }, { x: -5.5, z: 5.5 }]
  project.features = corners.map((a, index) => wallFromPoints(`wall-${index}`, a, corners[(index + 1) % corners.length], 2.8))
  project.objects = [
    { id: 'bed', productId: 'bed-cloud', x: -3.2, z: -3.8, rotation: 0 },
    { id: 'nightstand', productId: 'nightstand-form', x: -1.4, z: -3.8, rotation: 0 },
    { id: 'toilet', productId: 'toilet-arc', x: 0, z: -3.8, rotation: 0 },
    { id: 'shower', productId: 'shower-frame', x: 1.5, z: -3.8, rotation: 0 },
    { id: 'bath', productId: 'bath-curve', x: 3.5, z: -3.8, rotation: 0 },
    { id: 'vanity', productId: 'vanity-stone', x: -3.2, z: 0, rotation: 0 },
    { id: 'counter', productId: 'counter-line', x: 0, z: 0, rotation: 0 },
    { id: 'island', productId: 'island-form', x: 3.2, z: 0, rotation: 0 },
    { id: 'fridge', productId: 'fridge-tall', x: -3.8, z: 3.2, rotation: 0 },
  ]
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.evaluate((data) => localStorage.setItem('forma-room-planner-project', JSON.stringify(data)), project)
  await page.reload()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await frame(page)
  expect(errors).toEqual([])
})

test('a slow furniture model keeps the editor visible with an interactive loading placeholder', async ({ page }) => {
  await page.route('**/storage.googleapis.com/**/shared.glb*', async (route) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await route.continue() })
  const project = emptyProject('Loading room')
  project.features = [
    wallFromPoints('north', { x: -2.5, z: -2.5 }, { x: 2.5, z: -2.5 }, 2.8),
    wallFromPoints('east', { x: 2.5, z: -2.5 }, { x: 2.5, z: 2.5 }, 2.8),
    wallFromPoints('south', { x: 2.5, z: 2.5 }, { x: -2.5, z: 2.5 }, 2.8),
    wallFromPoints('west', { x: -2.5, z: 2.5 }, { x: -2.5, z: -2.5 }, 2.8),
  ]
  project.objects = [{ id: 'sofa', productId: 'polihome-vancouver-162638009', x: 0, z: 0, rotation: 0 }]
  await page.evaluate((value) => localStorage.setItem('forma-room-planner-project', JSON.stringify(value)), project)
  await page.reload()
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.locator('.object-loading')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '1')
  await expect(page.locator('canvas')).toBeVisible()
})

test('editor lighting modes preserve the room while switching day and night', async ({ page }) => {
  await build(page)
  await page.getByRole('button', { name: '3D', exact: true }).click(); await frame(page)
  const lighting = page.getByLabel('Editor lighting mode')
  await expect(lighting).toHaveValue('default')
  await lighting.selectOption('night')
  await expect(lighting).toHaveValue('night')
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-room-count', '1')
  await lighting.selectOption('day')
  await expect(lighting).toHaveValue('day')
  await lighting.selectOption('default')
  await expect(lighting).toHaveValue('default')
})

test('registered Polihome sofa loads its generated GLB and switches material variants', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await build(page)
  const card = page.locator('.product-card').filter({ hasText: 'Vancouver corner sofa' })
  await expect(card).toHaveCount(1)
  await expect(card.locator('img')).toHaveAttribute('src', /thumbnail\.png\?v=/)
  await card.getByTitle('Add Vancouver corner sofa to room').click()
  await expect(page.getByRole('heading', { name: 'Vancouver corner sofa', exact: true })).toBeVisible()
  await expect(page.getByLabel('Product variant')).toHaveValue('grey-light')
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('shared.glb')))).toBe(true)
  await page.getByLabel('Product variant').selectOption('grey-dark')
  await frame(page)
  await expect(page.locator('.selected-product-card img')).toHaveAttribute('src', /thumbnail\.png\?v=/)
  await expect(page.getByText(/Photo-based reconstruction · visual review pending/)).toBeVisible()
  await page.screenshot({ path: '/tmp/forma-vancouver-detailed-desktop.png', fullPage: true })
  const saved = await save(page)
  expect(saved.objects[0].variantId).toBe('grey-dark')
  await page.getByRole('button', { name: 'Rotate 15°', exact: true }).click()
  expect((await save(page)).objects[0].rotation).toBeCloseTo(Math.PI / 12)
  await page.setViewportSize({ width: 375, height: 812 })
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-vancouver-detailed-mobile.png', fullPage: true })
  await page.getByTitle('Collapse inspector').click()
  await page.getByTitle('Collapse tools').click()
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-vancouver-detailed-mobile-room.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  expect(errors).toEqual([])
})

test('draw, native-drop, move, rotate, duplicate, save and export a retail list', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await build(page)
  const canvas = page.locator('canvas'), box = (await canvas.boundingBox())!
  await page.locator('.product-card').filter({ hasText: 'Haven three-seat sofa' }).dragTo(canvas, { targetPosition: { x: box.width / 2, y: box.height / 2 } })
  await expect(page.getByRole('heading', { name: 'Haven three-seat sofa' })).toBeVisible()
  await frame(page)
  await segment(page, [0, 0], [0.5, 0.5])
  expect((await save(page)).objects[0].x).toBeGreaterThan(0.1)
  await page.getByTitle('Undo').click()
  expect((await save(page)).objects[0].x).toBeCloseTo(0)
  await page.getByTitle('Redo').click()
  await frame(page)
  const centre = await gridPoint(page, 0.5, 0.5)
  await page.mouse.click(centre.x, centre.y)
  await page.getByRole('button', { name: 'Rotate 15°', exact: true }).click()
  await expect(page.getByLabel('Rotation', { exact: true })).toHaveValue('15')
  await page.getByRole('button', { name: 'Add selected object to basket' }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  expect((await save(page)).objects[1].inBasket).toBe(false)
  await page.getByRole('button', { name: 'Add selected object to basket' }).click()
  await save(page)
  await page.reload()
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  await expect(page.locator('.shopping-item')).toHaveCount(1)
  await expect(page.locator('.shopping-item-price')).toContainText('×2')
  await expect(page.locator('.drawer-total')).toContainText('€1,798')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toBe('my-space-shopping-list.csv')
  expect(errors).toEqual([])
})

test('doors and windows attach to custom walls, survive corner edits, and delete with their wall', async ({ page }) => {
  await build(page)
  await page.getByRole('button', { name: 'Door', exact: true }).click(); await frame(page)
  const point = await gridPoint(page, 0, -2.5)
  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('heading', { name: 'Door opening' })).toBeVisible()
  await page.getByRole('button', { name: 'Window', exact: true }).click(); await frame(page)
  const windowPoint = await gridPoint(page, 2.5, 0)
  await page.mouse.click(windowPoint.x, windowPoint.y)
  await expect(page.getByRole('heading', { name: 'Window opening' })).toBeVisible()
  await page.getByLabel('Sill', { exact: true }).fill('0'); await page.getByLabel('Sill', { exact: true }).press('Enter')
  const p = await save(page)
  expect(p.features.filter((f: { wallId?: string }) => f.wallId)).toHaveLength(2)
  expect(p.features.find((f: { type: string }) => f.type === 'window').sillHeight).toBe(0)
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await frame(page)
  await page.mouse.click((await gridPoint(page, 1.5, -2.5)).x, point.y)
  await expect(page.getByRole('heading', { name: 'Wall', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove wall' }).click()
  expect((await save(page)).features.some((f: { type: string }) => f.type === 'door')).toBe(false)
  await page.getByTitle('Undo').click()
  expect((await save(page)).features).toEqual(p.features)
})

test('multiple openings stay placeable and draggable along their wall', async ({ page }) => {
  await build(page)
  await page.getByRole('button', { name: 'Door', exact: true }).click(); await frame(page)
  for (const x of [0, 0.2]) { const point = await gridPoint(page, x, -2.5); await page.mouse.click(point.x, point.y); await frame(page) }
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await frame(page)
  const from = await gridPoint(page, 0.2, -2.5), to = await gridPoint(page, 1.3, -2.5)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await frame(page)
  const saved = await save(page), doors = saved.features.filter((feature: { type: string }) => feature.type === 'door')
  expect(doors).toHaveLength(2)
  expect(doors.some((door: { wallOffset?: number }) => (door.wallOffset || 0) > 1)).toBe(true)
})

test('floor-plan import is reachable from the blank-room quick start', async ({ page }) => {
  await page.locator('.empty-import-button').filter({ hasText: 'Import floor plan' }).click()
  await expect(page.getByRole('dialog', { name: 'Import architectural drawing' })).toBeVisible()
  await expect(page.getByText('AI-assisted · approximate geometry')).toBeVisible()
  await expect(page.getByRole('checkbox')).toBeVisible()
  await page.screenshot({ path: '/tmp/forma-plan-import-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: '/tmp/forma-plan-import-mobile.png', fullPage: true })
})

test('floor-plan import uses a known-dimension calibration and creates editable fallback geometry', async ({ page }) => {
  await page.locator('.empty-import-button').filter({ hasText: 'Import floor plan' }).click()
  await page.getByRole('checkbox').check()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><rect x="50" y="50" width="300" height="16" fill="#000"/><rect x="50" y="50" width="16" height="250" fill="#000"/><rect x="334" y="50" width="16" height="250" fill="#000"/><rect x="50" y="284" width="300" height="16" fill="#000"/></svg>`
  await page.locator('.plan-import-file input').setInputFiles({ name: 'room.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await expect(page.getByText('Local fallback detection')).toBeVisible()
  await expect(page.getByText(/AI detection unavailable; used the local axis-aligned fallback/)).toBeVisible()
  await expect(page.getByText(/Firebase Auth and App Check are not configured/)).toBeVisible()
  await expect(page.locator('.plan-import-preview')).toBeVisible()
  await page.getByRole('button', { name: 'Set scale', exact: true }).click()
  const preview = (await page.locator('.plan-import-preview').boundingBox())!, imageScale = preview.width / 500
  await page.mouse.click(preview.x + 100 * imageScale, preview.y + 100 * imageScale)
  await page.mouse.click(preview.x + 300 * imageScale, preview.y + 100 * imageScale)
  await page.getByLabel('Known dimension (m)').fill('4')
  await page.getByRole('button', { name: 'Create editable room', exact: true }).click()
  const project = await save(page)
  expect(project.planImport).toMatchObject({ provider: 'local', scaleCalibrated: true })
  expect(project.features.filter((feature: { type: string }) => feature.type === 'wall').length).toBeGreaterThanOrEqual(4)
  expect(await page.locator('.canvas-frame').getAttribute('data-room-count')).toBe('1')
})

test('wall thickness edits persist, undo and render in 2D and 3D', async ({ page }) => {
  await build(page)
  const point = await gridPoint(page, 0, -2.5)
  await page.mouse.click(point.x, point.y)
  const thickness = page.getByLabel('Thickness', { exact: true })
  await expect(thickness).toHaveValue('0.120')
  await thickness.fill('0.45'); await thickness.press('Enter')
  expect((await save(page)).features[0].thickness).toBeCloseTo(0.45)
  await page.getByTitle('Undo').click()
  expect((await save(page)).features[0].thickness).toBeUndefined()
  await page.getByTitle('Redo').click()
  const saved = await save(page)
  await page.reload()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  expect((await save(page)).features).toEqual(saved.features)
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-wall-thickness-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByTitle('Collapse inspector').click()
  await page.getByTitle('Collapse tools').click()
  await frame(page)
  await page.screenshot({ path: '/tmp/forma-wall-thickness-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})

test('legacy saved rooms convert to editable walls without discarding products', async ({ page }) => {
  const old = { name: 'Existing design', roomType: 'Living room', width: 4, length: 5, ceilingHeight: 2.8, floorMaterial: 'Natural oak', wallMaterial: 'Warm white', objects: [{ id: 'old-sofa', productId: 'sofa-haven', x: 0, z: 0, rotation: 0 }], features: [] }
  await page.evaluate((p) => localStorage.setItem('forma-room-planner-project', JSON.stringify(p)), old)
  await page.reload()
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '20.00')
  const converted = await save(page)
  expect(converted.schemaVersion).toBe(3)
  expect(converted.objects).toEqual([{ ...old.objects[0], inBasket: false }])
  expect(converted.features).toHaveLength(4)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('forma-room-planner-project-before-custom-spaces')!).name)).toBe(old.name)
  await page.reload()
  expect((await save(page)).features).toHaveLength(4)
})

test('share links reopen user-drawn layouts', async ({ page, context }) => {
  await build(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Share project' }).click()
  await expect(page.getByRole('status')).toContainText('Project link copied')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  await page.goto(link)
  await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
  await save(page)
  expect(new URL(page.url()).hash).toBe('')
})

test('numeric editing, keyboard nudges and 3D dragging work inside a user-built room', async ({ page }) => {
  await build(page)
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  const x = page.getByLabel('X', { exact: true })
  await x.fill(''); await x.pressSequentially('-0.45'); await x.press('Enter')
  await expect(x).toHaveValue('-0.45')
  await x.fill('0.8'); await x.press('Escape')
  await expect(x).toHaveValue('-0.45')
  await page.keyboard.press('ArrowRight'); await expect(x).toHaveValue('-0.44')
  await page.keyboard.press('r'); await expect(page.getByLabel('Rotation', { exact: true })).toHaveValue('15')
  await x.fill('9'); await x.press('Enter')
  await expect(page.getByRole('status')).toContainText('inside a closed room')
  await expect(x).toHaveValue('-0.44')
  await x.fill('0'); await x.press('Enter')
  await page.getByLabel('Rotation', { exact: true }).fill('0'); await page.getByLabel('Rotation', { exact: true }).press('Enter')
  await page.getByRole('button', { name: '3D', exact: true }).click(); await frame(page)
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 25, { steps: 10 }); await page.mouse.up()
  const moved = (await save(page)).objects[0]
  expect(Math.abs(moved.x) + Math.abs(moved.z)).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  expect((await save(page)).objects).toHaveLength(0)
})

test('existing furniture can be added to the room without becoming a shoppable product', async ({ page }) => {
  await build(page)
  await page.getByRole('button', { name: 'Add existing furniture', exact: true }).click()
  await page.getByLabel('Name').fill('My old chair')
  await page.getByLabel('Width (cm)').fill('80')
  await page.getByLabel('Depth (cm)').fill('90')
  await page.getByLabel('Height (cm)').fill('85')
  await page.getByRole('button', { name: 'Place in room', exact: true }).click()
  const project = await save(page), item = project.objects[0]
  expect(item.custom).toMatchObject({ name: 'My old chair', width: 80, depth: 90, height: 85 })
  expect(item.productId).toBeUndefined()
  expect(item.inBasket).toBe(false)
  await expect(page.getByRole('heading', { name: 'My old chair' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add selected object to basket' })).toHaveCount(0)
  await page.getByRole('button', { name: '3D', exact: true }).click(); await frame(page)
  await page.screenshot({ path: '/tmp/forma-existing-furniture-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByTitle('Collapse inspector').click(); await page.getByTitle('Collapse tools').click(); await frame(page)
  await page.screenshot({ path: '/tmp/forma-existing-furniture-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  await expect(page.locator('.shopping-item')).toHaveCount(0)
})

test('furnishing a custom space still exports quote snapshots and accessible shopping dialogs', async ({ page }) => {
  await build(page)
  for (const name of ['Haven three-seat sofa', 'Arc coffee table', 'Loom wool rug', 'Halo floor lamp']) {
    await page.getByTitle(`Add ${name} to room`).click()
    await page.getByRole('button', { name: 'Add selected object to basket' }).click()
  }
  await page.getByRole('button', { name: '3D', exact: true }).click(); await frame(page)
  await page.screenshot({ path: '/tmp/forma-custom-furnished.png', fullPage: true })
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Shopping list' })
  await dialog.getByRole('button', { name: 'Request a quote' }).focus(); await page.keyboard.press('Tab')
  await expect(dialog.getByTitle('Close shopping list')).toBeFocused()
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Shopping list', exact: true }).click()
  await page.getByRole('button', { name: 'Request a quote' }).click()
  await page.getByLabel('Full name').fill('QA Example'); await page.getByLabel('Email').fill('qa@example.com'); await page.getByLabel('Delivery city').fill('Athens')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download request' }).click()
  const stream = await (await pending).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  const draft = JSON.parse(Buffer.concat(chunks).toString())
  expect(draft.status).toBe('draft')
  expect(draft.project.features).toHaveLength(4)
  expect(draft.items).toHaveLength(4)
  expect(draft.estimatedTotal).toBe(1466)
  await expect(page.getByText('Nothing has been sent to a retailer.', { exact: false })).toBeVisible()
})

test('malformed saved data stays recoverable', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('forma-room-planner-project', '{broken data'))
  await page.reload()
  await expect(page.getByText('Recovery mode · save manually', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => localStorage.getItem('forma-room-planner-project'))).toBe('{broken data')
  await save(page)
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('forma-room-planner-project-recovery-') && localStorage.getItem(key) === '{broken data'))).toBe(true)
})

test('mobile grid and panels stay accessible, and unfloored placement is explained', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.reload()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByText('Your space starts here')).toBeVisible()
  await page.getByRole('button', { name: 'Open catalogue', exact: true }).click()
  await page.getByTitle('Add Haven three-seat sofa to room').click()
  await expect(page.getByRole('status')).toContainText('Close a loop of walls first')
  await page.getByTitle('Collapse tools').click()
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Expand inspector details' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Space overview' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Expand inspector details' }).click()
  await expect(page.getByRole('heading', { name: 'Space overview' })).toBeVisible()
})

test.describe('touch room workflow', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })

  test('tap-to-chain walls previews lengths, closes rooms, and remains undoable', async ({ page }) => {
    await tapPoint(page, square[0])
    const firstEnd = await gridPoint(page, square[1][0], square[1][1])
    await page.mouse.move(firstEnd.x, firstEnd.y)
    await expect(page.locator('.dimension-tag')).toContainText('5.00 m')
    for (const point of square.slice(1)) await tapPoint(page, point)
    const closingEnd = await gridPoint(page, square[0][0], square[0][1])
    await page.mouse.move(closingEnd.x, closingEnd.y)
    await expect(page.locator('.dimension-tag')).toContainText('Room closes')
    await tapPoint(page, square[0])
    await expect(page.locator('.canvas-frame')).toHaveAttribute('data-wall-count', '4')
    await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
    await page.keyboard.press('Escape')
    await page.getByTitle('Undo').click()
    await expect(page.locator('.canvas-frame')).toHaveAttribute('data-wall-count', '3')
    await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '0.00')
    await page.getByTitle('Redo').click()
    await expect(page.locator('.canvas-frame')).toHaveAttribute('data-floor-area', '25.00')
  })

  test('selection keeps the inspector shut while touch controls move, rotate, replace, and basket items', async ({ page }) => {
    for (const point of [...square, square[0]]) await tapPoint(page, point)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open catalogue', exact: true }).tap()
    const sofa = page.getByTitle('Add Haven three-seat sofa to room')
    await sofa.scrollIntoViewIfNeeded()
    await sofa.tap()
    await expect(page.locator('.right-sidebar')).toBeHidden()
    await expect(page.locator('.selection-dock')).toBeVisible()
    const start = await gridPoint(page, 0, 0), end = await gridPoint(page, 0.5, 0.5)
    await touchDrag(page, start, end)
    await page.getByRole('button', { name: 'Rotate selected object 15 degrees' }).tap()
    await page.getByRole('button', { name: 'Add selected object to basket' }).tap()
    const before = (await save(page)).objects[0]
    expect(before.rotation).toBeCloseTo(Math.PI / 12)
    expect(before.inBasket).toBe(true)
    await page.getByTitle('Replace with Vancouver corner sofa').tap()
    const after = (await save(page)).objects[0]
    expect(after.productId).toBe('polihome-vancouver-162638009')
    expect(after.id).toBe(before.id)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.z).toBeCloseTo(before.z)
    expect(after.rotation).toBeCloseTo(before.rotation)
    expect(after.inBasket).toBe(true)
    await page.getByRole('button', { name: 'Flip sofa orientation' }).tap()
    expect((await save(page)).objects[0].mirrored).toBe(true)
    await page.getByRole('button', { name: 'Open detailed inspector' }).tap()
    await expect(page.locator('.right-sidebar')).toHaveClass(/inspector-expanded/)
    const handle = page.locator('.inspector-drag-handle')
    await handle.tap()
    await expect(page.locator('.right-sidebar')).toHaveClass(/inspector-collapsed/)
    const handleBox = await handle.boundingBox()
    await touchDrag(page, { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 }, { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 - 120 })
    await expect(page.locator('.right-sidebar')).toHaveClass(/inspector-expanded/)
    const canvas = (await page.locator('.canvas-frame').boundingBox())!
    await page.touchscreen.tap(canvas.x + 2, canvas.y + 10)
    await expect(page.locator('.right-sidebar')).toBeHidden()
  })
})
