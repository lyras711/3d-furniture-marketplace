import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractorFor } from './extractors'
import type { NormalizedProduct, SourceImage } from './product-types'

export const DEFAULT_PRODUCT_URL = 'https://www.polihome.gr/el/products/Goniakos-kanapes-Vancouver-Gkri-Skouro'
export const DEFAULT_ARTIFACT_ROOT = 'artifacts/products/polihome/vancouver'

export interface ScrapeOptions {
  url: string
  artifactRoot: string
}

export interface ScrapeResult {
  ok: boolean
  productPath: string
  reportPath: string
  manifestPath: string
  product: NormalizedProduct | null
  report: Record<string, unknown>
}

const extensionFor = (sourceUrl: string, contentType: string | null) => {
  const mime = (contentType || '').split(';')[0].toLowerCase()
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('avif')) return 'avif'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  const extension = path.extname(new URL(sourceUrl).pathname).replace('.', '').toLowerCase()
  return extension || 'bin'
}

function imageDimensions(buffer: Buffer, contentType: string | null) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    if (buffer.toString('ascii', 12, 16) === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    if (buffer.toString('ascii', 12, 16) === 'VP8 ') return null
  }
  if (buffer.length > 4 && (contentType || '').includes('jpeg')) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      offset += size + 2
    }
  }
  return null
}

async function downloadImages(product: NormalizedProduct, artifactRoot: string) {
  const imageDir = path.join(artifactRoot, 'source', 'images')
  await mkdir(imageDir, { recursive: true })
  const byHash = new Map<string, string>()
  const warnings: string[] = []
  let downloaded = 0
  for (const image of product.sourceImages) {
    try {
      const response = await fetch(image.sourceUrl, { headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type')
      const buffer = Buffer.from(await response.arrayBuffer())
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      const dimensions = imageDimensions(buffer, contentType)
      const previous = byHash.get(sha256)
      const localName = previous || `${image.id}.${extensionFor(image.sourceUrl, contentType)}`
      if (!previous) {
        await writeFile(path.join(imageDir, localName), buffer)
        byHash.set(sha256, localName)
      }
      image.localPath = path.posix.join('source', 'images', localName)
      image.contentType = contentType
      image.width = dimensions?.width || image.width
      image.height = dimensions?.height || image.height
      image.downloaded = true
      image.sha256 = sha256
      downloaded += 1
    } catch (error) {
      const message = `${image.sourceUrl}: ${error instanceof Error ? error.message : String(error)}`
      image.warning = message
      warnings.push(message)
    }
  }
  product.variants.forEach((variant) => {
    variant.localImagePaths = product.sourceImages.filter((image) => image.variantId === variant.id && image.localPath).map((image) => image.localPath!)
  })
  return { imageDir, warnings, downloaded }
}

export function missingFields(product: NormalizedProduct) {
  return [
    ['name', product.name],
    ['sourceProductCode', product.sourceProductCode],
    ['basePrice', product.basePrice],
    ['dimensionsCm.length', product.dimensionsCm.length],
    ['dimensionsCm.depth', product.dimensionsCm.cornerDepth ?? product.dimensionsCm.depth],
    ['dimensionsCm.height', product.dimensionsCm.height],
    ['variants', product.variants.length >= 1 ? product.variants : null],
  ].filter(([, value]) => value === null || value === undefined || value === '').map(([field]) => field)
}

export async function runScraper({ url, artifactRoot }: ScrapeOptions): Promise<ScrapeResult> {
  const root = path.resolve(artifactRoot)
  const sourceRoot = path.join(root, 'source')
  await mkdir(sourceRoot, { recursive: true })
  const productPath = path.join(root, 'product.json')
  const reportPath = path.join(root, 'extraction-report.json')
  const manifestPath = path.join(sourceRoot, 'image-manifest.json')
  const startedAt = new Date().toISOString()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: process.platform === 'darwin' ? 'chromium' : undefined }),
      args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'el-GR' })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!response || response.status() >= 400) throw new Error(`Product page returned HTTP ${response?.status() || 'no response'}`)
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])
    const extractor = extractorFor(url)
    const snapshot = await extractor.capture(page)
    await writeFile(path.join(sourceRoot, 'page.html'), snapshot.html, 'utf8')
    await page.screenshot({ path: path.join(sourceRoot, 'page.png'), fullPage: true })
    const product = extractor.extract(snapshot)
    const imageResult = await downloadImages(product, root)
    product.extractionMetadata.warnings.push(...imageResult.warnings)
    if (imageResult.downloaded < 3) product.extractionMetadata.warnings.push(`Only ${imageResult.downloaded} source images were downloaded; review the image manifest.`)
    product.validationStatus = missingFields(product).length ? 'warnings' : 'source-extracted'
    product.updatedAt = new Date().toISOString()
    await writeFile(productPath, JSON.stringify(product, null, 2), 'utf8')
    await writeFile(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), images: product.sourceImages }, null, 2), 'utf8')
    const report = {
      status: missingFields(product).length ? 'failed' : product.extractionMetadata.warnings.length ? 'warning' : 'success',
      stage: 'scrape',
      sourceUrl: url,
      canonicalUrl: product.extractionMetadata.canonicalUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      fields: product.extractionMetadata.provenance,
      missingFields: missingFields(product),
      warnings: product.extractionMetadata.warnings,
      strategies: product.extractionMetadata.sourceStrategies,
      sourceFiles: { html: path.join(sourceRoot, 'page.html'), screenshot: path.join(sourceRoot, 'page.png'), imageManifest: manifestPath },
      imageCount: product.sourceImages.length,
      downloadedImageCount: imageResult.downloaded,
      productPath,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: missingFields(product).length === 0, productPath, reportPath, manifestPath, product, report }
  } catch (error) {
    const report = {
      status: 'failed',
      stage: 'scrape',
      sourceUrl: url,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      nextStep: 'Review the saved source artifacts, then rerun the scraper after fixing the page or network condition.',
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, productPath, reportPath, manifestPath, product: null, report }
  } finally {
    await browser?.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (flag: string, fallback: string) => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
  const url = valueAfter('--url', DEFAULT_PRODUCT_URL)
  const out = valueAfter('--out', DEFAULT_ARTIFACT_ROOT)
  const result = await runScraper({ url, artifactRoot: out })
  console.log(JSON.stringify(result.report, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
