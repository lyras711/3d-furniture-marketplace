import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: 'reduce' }, launchOptions: { executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' })
const url = (process.env.TEST_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')

test('root serves the B2B journey and the B2C showcase stays on a hidden shopper route', async ({ page }) => {
  await page.goto(url)
  await expect(page).toHaveTitle('Formivo for business — spatial shopping for furniture')
  await expect(page.getByRole('heading', { name: 'Let shoppers see it in their room.' })).toBeVisible()
  await expect(page.getByText('FOR ONLINE FURNITURE STORES')).toBeVisible()
  await expect(page.locator('.b2b')).toHaveCount(1)
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.goto(`${url}/for-shoppers`)
  await expect(page).toHaveTitle('Formivo — Make room for possibility.')
  await expect(page.getByRole('heading', { name: 'Make room for possibility.' })).toBeVisible()
  await expect(page.locator('.b2b')).toHaveCount(0)
})

test('planner direct route opens the editor', async ({ page }) => {
  await page.goto(`${url}/planner`)
  await expect(page).toHaveTitle('Formivo — room planner')
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-ready', 'true')
})

test('business contact links open a proposal email and keep the customer demo visible', async ({ page }) => {
  await page.goto(url)
  const contactHref = /mailto:info@formivo3d\.com\?subject=Formivo%20B2B%20pilot%20conversation/
  await expect(page.getByRole('link', { name: 'Open customer demo' })).toHaveAttribute('href', '/planner')
  await expect(page.getByRole('link', { name: 'Open customer demo' })).toHaveClass(/b2b-header-demo/)
  await expect(page.getByRole('link', { name: 'Contact us about a pilot' }).first()).toHaveAttribute('href', contactHref)
  await expect(page.getByRole('link', { name: 'Email us about a pilot' })).toHaveAttribute('href', contactHref)
})

test('business page stays within the viewport on desktop and mobile', async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(url)
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
