import { test, expect, type Page } from '@playwright/test'
import { emptyProject, fitsFloor, getFloorRegions, isProject } from './src/editor'

test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: 'reduce' }, launchOptions: { executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' })
const url = (process.env.TEST_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')
const saved = JSON.stringify(emptyProject('My existing project'))
async function start(page: Page) {
  await page.goto(url)
  await page.evaluate((data) => localStorage.setItem('forma-room-planner-project', data), saved)
  await page.getByRole('button', { name: 'Draw my room' }).click()
}
async function readDownload(page: Page, click: () => Promise<unknown>) {
  const downloaded = page.waitForEvent('download')
  await click()
  const file = await downloaded
  const stream = await file.createReadStream()
  const buffers = []
  for await (const chunk of stream!) buffers.push(chunk)
  return { filename: file.suggestedFilename(), data: JSON.parse(Buffer.concat(buffers).toString()) }
}

test('showcase loads original local imagery without loading the 3D editor', async ({ page }) => {
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Make room for possibility.' })).toBeVisible()
  await expect(page.locator('.s-hero-art > img')).toHaveJSProperty('complete', true)
  expect(await page.locator('.s-hero-art > img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1400)
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(requests.some((request) => request.includes('forest.hdr') || /\/App[-.]/.test(request))).toBe(false)
  expect(errors).toEqual([])
})

test('showcase room-to-quote journey calculates exact totals, removes items, and preserves saved work', async ({ page }) => {
  await start(page)
  const demo = page.locator('.s-demo')
  await expect(demo).toHaveAttribute('data-stage', '1')
  await expect(demo.getByRole('button', { name: 'Review 0 pieces' })).toBeDisabled()
  for (const name of ['Haven sofa', 'Arc coffee table', 'Halo floor lamp', 'Loom rug']) await demo.getByRole('button', { name: new RegExp(name) }).click()
  await expect(demo.locator('.s-demo-total strong')).toHaveText('€1,466')
  await demo.getByRole('button', { name: /Halo floor lamp/ }).click()
  await expect(demo.locator('.s-demo-total strong')).toHaveText('€1,327')
  await demo.getByRole('button', { name: /Halo floor lamp/ }).click()
  await demo.getByRole('button', { name: 'Review 4 pieces' }).click()
  await expect(demo.locator('.s-demo-basket > div')).toHaveCount(4)
  const { filename, data } = await readDownload(page, () => demo.getByRole('button', { name: 'Download quote draft' }).click())
  expect(filename).toBe('forma-demo-quote.json')
  expect(data.estimatedTotal).toBe(1466)
  expect(data.status).toBe('draft-not-submitted')
  expect(data.retailers).toHaveLength(4)
  expect(isProject(data.project)).toBe(true)
  expect(getFloorRegions(data.project.features)[0].area).toBe(27)
  for (const object of data.project.objects) expect(fitsFloor(object, data.project)).toBe(true)
  await expect(demo).toHaveAttribute('data-stage', '3')
  await expect(demo.getByText(/No order was placed/)).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('forma-room-planner-project'))).toBe(saved)
  await demo.getByRole('link', { name: 'Open the full planner' }).click()
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  expect(await page.evaluate(() => localStorage.getItem('forma-room-planner-project'))).toBe(saved)
})

test('showcase walkthrough can be interrupted and reset without downloading', async ({ page }) => {
  await page.goto(url)
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.getByRole('button', { name: 'Or, play the walkthrough' }).click()
  await expect(page.locator('.s-demo')).toHaveAttribute('data-stage', '1')
  await page.getByRole('button', { name: 'Stop & take over' }).click()
  await expect(page.locator('.s-tour-status')).toHaveCount(0)
  await page.getByRole('button', { name: /Reset demo/ }).click()
  await expect(page.locator('.s-demo')).toHaveAttribute('data-stage', '0')
  await page.getByRole('button', { name: 'Or, play the walkthrough' }).click()
  await expect(page.locator('.s-demo')).toHaveAttribute('data-stage', '2', { timeout: 15000 })
  await expect(page.locator('.s-demo-total strong')).toHaveText('€1,466')
  expect(downloads).toEqual([])
})

test('showcase partnership and investor briefs are honest local downloads with accessible dialogs', async ({ page }) => {
  await page.goto(url)
  const outbound: string[] = []
  page.on('request', (request) => { if (request.method() !== 'GET') outbound.push(request.url()) })
  for (const [button, filename] of [['Explore a retail partnership', 'forma-retailer-brief.json'], ['Explore the investment thesis', 'forma-investor-brief.json']]) {
    const trigger = page.getByRole('button', { name: button, exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Company or organisation').fill('Example studio')
    await dialog.getByLabel('Email', { exact: true }).fill('owner@example.test')
    await dialog.getByLabel('What would you like to explore?').fill('A small catalogue pilot.')
    const result = await readDownload(page, () => dialog.getByRole('button', { name: 'Download conversation brief' }).click())
    expect(result.filename).toBe(filename)
    expect(result.data.status).toBe('local-draft-not-submitted')
    expect(result.data.company).toBe('Example studio')
    await expect(dialog.getByRole('status')).toContainText('Nothing has been submitted')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
  }
  expect(outbound).toEqual([])
})

test('showcase 3D demo uses real furniture and returns to a usable plan', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await start(page)
  await page.getByRole('button', { name: /Haven sofa/ }).click()
  await page.getByRole('button', { name: '3D view', exact: true }).click()
  await expect(page.locator('.s-demo canvas')).toBeVisible({ timeout: 30000 })
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('/materials/forest.hdr')))).toBe(true)
  await page.locator('.s-demo').screenshot({ path: '/tmp/forma-showcase-demo-3d.png' })
  await page.getByRole('button', { name: '2D plan', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Top-down room plan with 1 selected products' })).toBeVisible()
  await expect(page.locator('.s-demo-total strong')).toHaveText('€899')
  expect(errors).toEqual([])
})

test('showcase keeps the guided demo usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...options: unknown[]) {
      if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
      return original.apply(this, [contextId, ...options] as Parameters<typeof original>)
    } as typeof original
  })
  await start(page)
  await page.getByRole('button', { name: /Haven sofa/ }).click()
  await page.getByRole('button', { name: '3D view', exact: true }).click()
  await expect(page.getByText('3D unavailable on this device. Your 2D demo still works.')).toBeVisible()
  await expect(page.locator('.s-demo-total strong')).toHaveText('€899')
  await page.getByRole('button', { name: '2D plan', exact: true }).click()
  await page.getByRole('button', { name: 'Review 1 piece', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download quote draft' })).toBeEnabled()
})

test('showcase preserves legacy shared-project URLs', async ({ page }) => {
  await page.goto(`${url}/#project=${encodeURIComponent(JSON.stringify(emptyProject('Shared legacy link')))}`)
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
  await expect(page.locator('.showcase')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Shared legacy link/ })).toBeVisible()
})

test('showcase desktop and mobile screenshots have no overflow, broken images, or hidden content', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Make room for possibility.' })).toBeVisible()
    for (const section of await page.locator('.s-reveal').all()) await section.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 375) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.getByRole('navigation').getByRole('link', { name: 'For retailers' }).click()
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
      await page.locator('summary').filter({ hasText: 'Can I buy the furniture here?' }).click()
      await expect(page.getByText(/Not yet. The current journey/)).toBeVisible()
    }
    await page.locator('.s-header').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/forma-showcase-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.locator('.s-header').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/forma-showcase-hero-${width}.png`, animations: 'disabled' })
  }
})
