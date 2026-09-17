import { chromium } from '@playwright/test'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => { throw error })
  for (const art of ['room', 'sofa-haven', 'table-arc', 'lamp-halo', 'rug-loom']) {
    await page.setViewportSize(art === 'room' ? { width: 1400, height: 1250 } : { width: 900, height: 720 })
    await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5174'}/?art=${art}`)
    await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.samples) >= 384, undefined, { timeout: 240000 })
    await page.locator('canvas').screenshot({ path: `public/showcase-${art}.jpg`, type: 'jpeg', quality: 92 })
    console.log(`Rendered public/showcase-${art}.jpg`)
  }
} finally {
  await browser.close()
}
