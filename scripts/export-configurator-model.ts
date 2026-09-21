/**
 * Export a GLB from an Exact3D/ExactADV Unity WebGL configurator.
 *
 * These configurators (al2, HOMAD, GrecoStrom) load a model selected by a
 * public `?model=` parameter and expose a client-side GLB export:
 * Unity `SendMessage("GameAssetsHandler","SimpleExport")` → the page's
 * `DownloadGlbFile` creates a blob download.
 *
 * Usage:
 *   npx tsx scripts/export-configurator-model.ts \
 *     --url "https://configurator.homad.eu/?model=kan_canova" \
 *     --out artifacts/products/homad/canova/model/shared.glb
 */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const url = arg('url')
const out = arg('out')
const waitAfterLoadMs = Number(arg('settle-ms', '8000'))
const timeoutMs = Number(arg('timeout', '240000'))

if (!url || !out) {
  console.error('Usage: npx tsx scripts/export-configurator-model.ts --url <configurator-url> --out <glb-path>')
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=metal'] })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
page.on('console', (message) => { if (message.type() === 'error') console.error(`[console] ${message.text().slice(0, 200)}`) })

console.log(`Loading ${url}`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

// Wait for the Unity instance to exist and the scene to settle.
await page.waitForFunction(() => Boolean((window as unknown as { configuratorInstance?: unknown }).configuratorInstance), null, { timeout: timeoutMs })
console.log('Unity instance ready; letting the scene settle')
await page.waitForTimeout(waitAfterLoadMs)

const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs })
await page.evaluate(() => {
  const instance = (window as unknown as { configuratorInstance?: { SendMessage: (target: string, method: string, arg?: string) => void } }).configuratorInstance
  if (!instance) throw new Error('configuratorInstance unavailable')
  instance.SendMessage('GameAssetsHandler', 'SimpleExport')
})
const download = await downloadPromise
const filename = download.suggestedFilename()
const downloadPath = await download.path()
if (!downloadPath) throw new Error('Download produced no file path')
const { readFile } = await import('node:fs/promises')
const buffer = await readFile(downloadPath)

if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`Downloaded ${filename || 'file'} is not a GLB (${buffer.length} bytes)`)

await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, buffer)
console.log(`Exported ${filename || 'model.glb'} → ${out} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`)
await browser.close()
