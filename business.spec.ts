import { test, expect, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: 'reduce' }, launchOptions: { executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' })
const url = (process.env.TEST_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')

async function readDownload(page: Page, click: () => Promise<unknown>) {
  const downloaded = page.waitForEvent('download')
  await click()
  const file = await downloaded
  const stream = await file.createReadStream()
  const buffers = []
  for await (const chunk of stream!) buffers.push(chunk)
  return { filename: file.suggestedFilename(), data: JSON.parse(Buffer.concat(buffers).toString()) }
}

test('business subpage is a separate B2B journey and keeps the editor lazy', async ({ page }) => {
  await page.goto(`${url}/for-business`)
  await expect(page).toHaveTitle('Forma for business — spatial shopping for furniture')
  await expect(page.getByRole('heading', { name: 'Let shoppers see it in their room.' })).toBeVisible()
  await expect(page.getByText('FOR ONLINE FURNITURE STORES')).toBeVisible()
  await expect(page.locator('.b2b')).toHaveCount(1)
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('link', { name: 'For shoppers' }).click()
  await expect(page.getByRole('heading', { name: 'Make room for possibility.' })).toBeVisible()
  await expect(page.locator('.b2b')).toHaveCount(0)
})

test('business pilot brief stays a local download', async ({ page }) => {
  await page.goto(`${url}/for-business`)
  const outbound: string[] = []
  page.on('request', (request) => { if (request.method() !== 'GET') outbound.push(request.url()) })
  await page.getByRole('button', { name: 'Talk through a pilot' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Company or organisation').fill('Example furniture store')
  await dialog.getByLabel('Email').fill('owner@example.test')
  await dialog.getByLabel('What catalogue would you start with?').fill('A focused sofa range.')
  const result = await readDownload(page, () => dialog.getByRole('button', { name: 'Download local pilot brief' }).click())
  expect(result.filename).toBe('forma-business-pilot-brief.json')
  expect(result.data.status).toBe('local-draft-not-submitted')
  expect(result.data.company).toBe('Example furniture store')
  expect(result.data.opportunity).toContain('reduces uncertainty')
  expect(outbound).toEqual([])
  await expect(dialog.getByRole('status')).toContainText('Nothing was submitted')
})

test('business page stays within the viewport on desktop and mobile', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`${url}/for-business`)
    await expect(page.getByRole('heading', { name: 'Let shoppers see it in their room.' })).toBeVisible()
    for (const section of await page.locator('section').all()) await section.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 375) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page.getByRole('navigation').getByRole('link', { name: 'How it works' }).click()
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible()
      await page.locator('summary').filter({ hasText: 'Can shoppers upload a room photo?' }).click()
      await expect(page.getByText(/Image-based layout import is a pilot feature/)).toBeVisible()
    }
  }
})
