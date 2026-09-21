/**
 * Generic WooCommerce product scraper → NormalizedProduct JSON.
 *
 * Works against standard WooCommerce product pages (al2, HOMAD, GrecoStrom):
 * reads Yoast/schema JSON-LD, the `.product_title`, `.price`, the attribute
 * table, the gallery, and — for variable products — the embedded
 * `data-product_variations` JSON (per-variant price, SKU, dimensions, image).
 *
 * Usage:
 *   npx tsx scripts/scrape-woocommerce-product.ts \
 *     --url "https://www.homad.eu/product/canova/" \
 *     --retailer homad --brand HOMAD --category "Corner sofa" \
 *     --out artifacts/products/homad/canova/product.json
 */
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NormalizedProduct, SourceImage, Variant } from './product-types'

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const url = arg('url')
const retailer = arg('retailer')
const out = arg('out')
const brand = arg('brand') || ''
const category = arg('category') || 'Other'
const group = (arg('group') || 'Seating') as 'Seating' | 'Tables' | 'Lighting' | 'Decor' | 'Storage' | 'Bedroom'

if (!url || !retailer || !out) {
  console.error('Usage: --url <product-page> --retailer <id> --out <product.json> [--brand X] [--category Y] [--group Z]')
  process.exit(1)
}

interface CapturedVariation {
  variation_id: number
  attributes: Record<string, string>
  display_price?: number | string
  price?: number | string
  sku?: string
  is_in_stock?: boolean
  image?: { src?: string; full_src?: string }
  dimensions?: { length?: string; width?: string; height?: string }
  dimensions_html?: string
}

const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('body', { timeout: 30000 })
await page.waitForTimeout(2500)

// Passed as a string: esbuild's keepNames transform breaks function callbacks
// passed to page.evaluate ("__name is not defined").
const captureScript = `(() => {
  const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim()
  const stripSite = (value) => clean(value).replace(/\\s*[|\\-–—]\\s*[^|\\-–—]+$/, '')
  const title = clean(document.querySelector('h1.product_title, h1.entry-title, h1')?.textContent)
    || stripSite(document.querySelector('meta[property="og:title"]')?.content)
    || stripSite(document.title)
  const priceText = clean(document.querySelector('.summary .price, p.price, .product .price')?.textContent)
  const attributes = [...document.querySelectorAll('.woocommerce-product-attributes tr, table.shop_attributes tr')]
    .map((row) => ({ label: clean(row.querySelector('th')?.textContent), value: clean(row.querySelector('td')?.textContent) }))
    .filter((row) => row.label && row.value)
  let variations = []
  const variationsAttr = document.querySelector('form.variations_form')?.getAttribute('data-product_variations')
  if (variationsAttr) { try { variations = JSON.parse(variationsAttr) } catch (e) {} }
  const images = [...document.querySelectorAll('.woocommerce-product-gallery__image img, .woocommerce-product-gallery__image a')]
    .map((element) => element instanceof HTMLImageElement ? (element.dataset.large_src || element.src) : element.getAttribute('href'))
    .filter((source) => Boolean(source && source.startsWith('http')))
  const fallbackImage = document.querySelector('meta[property="og:image"]')?.content || null
  if (!images.length && fallbackImage) images.push(fallbackImage)
  const description = clean(document.querySelector('.woocommerce-product-details__short-description, #tab-description')?.textContent).slice(0, 2000)
  const jsonLd = [...document.scripts]
    .filter((script) => script.type === 'application/ld+json')
    .map((script) => { try { return script.textContent ? JSON.parse(script.textContent) : null } catch (e) { return null } })
    .filter(Boolean)
  const breadcrumbs = [...document.querySelectorAll('.woocommerce-breadcrumb a, nav.breadcrumb a')].map((a) => clean(a.textContent))
  return {
    title, priceText, attributes, variations, images: [...new Set(images)], description, jsonLd, breadcrumbs,
    canonical: document.querySelector('link[rel="canonical"]')?.href || null,
    pageTitle: document.title,
    html: document.documentElement.outerHTML,
    lang: document.documentElement.lang || 'el',
  }
})()`
const captured = await page.evaluate(captureScript) as {
  title: string; priceText: string; attributes: Array<{ label: string; value: string }>; variations: CapturedVariation[]
  images: string[]; description: string; jsonLd: unknown[]; breadcrumbs: string[]; canonical: string | null; pageTitle: string; html: string; lang: string
}
await browser.close()

const warnings: string[] = []
const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
const numberFrom = (value: unknown) => { const match = String(value ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/); return match ? Number(match[0]) : null }

function dimsFromText(text: string | null | undefined) {
  if (!text) return null
  const numbers = [...text.replace(',', '.').matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter((value) => value > 5 && value < 600)
  if (numbers.length < 2) return null
  const [a, b, c] = numbers
  return { length: a, depth: b, height: c ?? null }
}

function dimsFromAttributes(rows: Array<{ label: string; value: string }>) {
  const row = rows.find((entry) => /διαστάσ|dimension|μέγεθ|size|διάστασ/i.test(entry.label))
  if (!row) return null
  const labeled = { length: null as number | null, depth: null as number | null, height: null as number | null }
  const segments = row.value.split(/[,;·]/)
  for (const segment of segments) {
    const value = numberFrom(segment)
    if (value === null) continue
    if (/μήκος|length|μηκος/i.test(segment)) labeled.length = value
    else if (/πλάτος|width|βάθος|βαθος|depth|πλατος/i.test(segment)) labeled.depth = value
    else if (/ύψος|height|υψος/i.test(segment)) labeled.height = value
  }
  if (labeled.length || labeled.depth || labeled.height) return labeled
  return dimsFromText(row.value)
}

function dimsFromVariation(variation: CapturedVariation) {
  const dims = variation.dimensions
  if (!dims) return null
  const length = numberFrom(dims.length)
  const depth = numberFrom(dims.width)
  const height = numberFrom(dims.height)
  return length || depth || height ? { length, depth, height } : null
}

const attrDims = dimsFromAttributes(captured.attributes)
const varDims = captured.variations.map(dimsFromVariation).find(Boolean)
const dims = attrDims || varDims || { length: null, depth: null, height: null }
if (!dims.length || !dims.depth || !dims.height) warnings.push('Product dimensions were incomplete on the source page; catalog footprint may be approximate.')

const basePrice = numberFrom(captured.priceText) ?? numberFrom(captured.variations.find((v) => numberFrom(v.display_price) !== null)?.display_price)
if (basePrice === null) warnings.push('No public price found on the source page.')

const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || 'product'
const productId = `${retailer}-${slug.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
const now = new Date().toISOString()

const variants: Variant[] = captured.variations.length
  ? captured.variations.map((variation) => {
      const variantName = clean(Object.values(variation.attributes).join(' · ')) || `Variation ${variation.variation_id}`
      const variantDims = dimsFromVariation(variation)
      return {
        id: `${slug}-${variation.variation_id}`,
        productId,
        sourceVariantName: variantName,
        normalizedVariantName: variantName,
        colorName: null,
        materialName: null,
        sourceImageUrls: variation.image?.full_src || variation.image?.src ? [variation.image.full_src || variation.image.src!] : [],
        localImagePaths: [],
        materialReference: '',
        modelAssetId: null,
        sourceAvailability: variation.is_in_stock === false ? 'out-of-stock' : 'available',
        sourcePrice: numberFrom(variation.display_price ?? variation.price),
        extractionWarnings: variantDims ? [] : ['Variant has no source dimensions.'],
      }
    })
  : [{
      id: `${slug}-default`,
      productId,
      sourceVariantName: 'Default',
      normalizedVariantName: 'Default',
      colorName: null,
      materialName: null,
      sourceImageUrls: [],
      localImagePaths: [],
      materialReference: '',
      modelAssetId: null,
      sourceAvailability: 'available',
      sourcePrice: basePrice,
      extractionWarnings: [],
    }]

const sourceImages: SourceImage[] = captured.images.slice(0, 12).map((sourceUrl, index) => ({
  id: `img-${index + 1}`,
  sourceUrl,
  localPath: null,
  contentType: null,
  width: null,
  height: null,
  role: index === 0 ? 'hero' : 'gallery',
  variantId: null,
  altText: captured.title,
  downloaded: false,
  sha256: null,
  warning: null,
}))

const sku = captured.variations[0]?.sku || captured.attributes.find((row) => /κωδικός|sku|code|κωδ/i.test(row.label))?.value || null

const product: NormalizedProduct = {
  id: productId,
  retailerId: retailer,
  sourceUrl: captured.canonical || url,
  sourceProductCode: sku,
  name: captured.title,
  localizedNames: { [captured.lang.split('-')[0] || 'el']: captured.title },
  brand: brand || null,
  category,
  description: captured.description || null,
  currency: 'EUR',
  basePrice,
  availabilityStatus: 'available',
  dimensionsCm: {
    length: dims.length,
    width: null,
    depth: dims.depth,
    height: dims.height,
    cornerDepth: null,
    seatHeight: null,
    feetHeight: null,
    bedLength: null,
    bedWidth: null,
  },
  materials: { frame: null, seat: null, upholstery: null, feet: null },
  packageCount: null,
  weightKg: null,
  packageDimensions: [],
  variants,
  sourceImages,
  modelAssets: [],
  extractionMetadata: {
    extractedAt: now,
    extractor: 'woocommerce-product-page-v1',
    pageTitle: captured.pageTitle,
    canonicalUrl: captured.canonical,
    provenance: [
      { field: 'name', value: captured.title, source: 'product_title', confidence: 'high' },
      { field: 'price', value: basePrice, source: 'price/variations', confidence: basePrice === null ? 'low' : 'high' },
      { field: 'dimensions', value: dims, source: attrDims ? 'attribute-table' : varDims ? 'variations' : 'missing', confidence: dims.length ? 'high' : 'low' },
    ],
    warnings,
    sourceStrategies: ['dom', 'json-ld', 'variations-json'],
  },
  validationStatus: warnings.length ? 'warnings' : 'source-extracted',
  catalog: { retailerName: brand || retailer, group, category },
  createdAt: now,
  updatedAt: now,
}

await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(product, null, 2), 'utf8')
await writeFile(path.join(path.dirname(out), 'raw-page.html'), captured.html, 'utf8')
const summary = { status: warnings.length ? 'warning' : 'success', productId, name: captured.title, price: basePrice, dims, variants: variants.length, images: sourceImages.length, group, warnings }
await writeFile(path.join(path.dirname(out), 'scrape-report.json'), JSON.stringify(summary, null, 2), 'utf8')
console.log(JSON.stringify(summary, null, 2))
