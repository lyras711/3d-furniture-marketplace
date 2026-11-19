import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { products as bundledProducts, type Product, type ProductMetadata } from '../src/catalog'
import { applyCatalogMetadataOverrides, duplicateSkuProduct, readCatalogMetadataOverrides } from './catalog-admin'
import { discoverProductUrls, robotsPolicy, validatePublicUrl } from './catalog-workflow'
import { firebaseStore, uploadBuffer } from './firebase-store'

export type MetadataCrawlStatus = 'queued' | 'discovering' | 'running' | 'completed' | 'failed'
export type MetadataCrawlItem = { url: string; productId: string | null; status: 'queued' | 'scraping' | 'saved' | 'duplicate' | 'failed'; error: string | null; updatedAt: string }
export type MetadataCrawlJob = {
  id: string; brandName: string; retailerId: string; website: string; maxProducts: number; delayMs: number
  status: MetadataCrawlStatus; discoveredUrls: string[]; items: MetadataCrawlItem[]
  currentUrl: string | null; error: string | null; createdAt: string; updatedAt: string
}

const collection = () => firebaseStore().db.collection('catalogCrawlJobs')
const finishedStatuses = new Set<MetadataCrawlStatus>(['completed', 'failed'])
const now = () => new Date().toISOString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const slug = (value: string) => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)
  if (!/[^\x00-\x7f]/.test(value) && normalized) return normalized
  return `${normalized.slice(0, 59) || 'item'}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

export function metadataProductBelongsToCrawl(product: { importedBy?: unknown }, edit: { importedFromCrawlId?: unknown }, crawlId: string) {
  return product.importedBy === 'metadata-crawl' && edit.importedFromCrawlId === crawlId
}

const setJob = async (job: MetadataCrawlJob) => { job.updatedAt = now(); await collection().doc(job.id).update(job) }

export function metadataProductId(retailerId: string, sku: string | null, name: string, url: string) {
  const path = new URL(url).pathname.split('/').filter(Boolean).pop()
  return `${retailerId}-${slug(sku || name || path || 'product')}`.slice(0, 128)
}

const comparableName = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

export function isProductName(value: unknown, brandName: string) {
  if (typeof value !== 'string') return false
  const name = comparableName(value.trim())
  return Boolean(name && name !== comparableName(brandName.trim()))
}

export async function createMetadataCrawl(input: { brandName: string; retailerId: string; website: string; maxProducts: number; delayMs: number }) {
  const website = await validatePublicUrl(input.website)
  const brandName = input.brandName.trim()
  const retailerId = slug(input.retailerId || brandName)
  if (!brandName || brandName.length > 100) throw new Error('Brand name must be 1–100 characters.')
  const maxProducts = Number.isFinite(input.maxProducts) ? Math.max(1, Math.min(500, Math.floor(input.maxProducts))) : 100
  const delayMs = Number.isFinite(input.delayMs) ? Math.max(1000, Math.min(60000, Math.floor(input.delayMs))) : 1000
  const job: MetadataCrawlJob = { id: randomUUID(), brandName, retailerId, website: website.origin, maxProducts, delayMs, status: 'queued', discoveredUrls: [], items: [], currentUrl: null, error: null, createdAt: now(), updatedAt: now() }
  await collection().doc(job.id).create(job)
  return job
}

export async function getMetadataCrawl(id: string) {
  const snapshot = await collection().doc(id).get()
  return snapshot.exists ? snapshot.data() as MetadataCrawlJob : null
}

export async function listMetadataCrawls() {
  const snapshot = await collection().orderBy('createdAt', 'desc').limit(100).get()
  return snapshot.docs.map((doc) => doc.data() as MetadataCrawlJob)
}

export async function deleteMetadataCrawl(id: string, deleteImportedData = false) {
  const db = firebaseStore().db, ref = collection().doc(id)
  const job = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const job = snapshot.data() as MetadataCrawlJob
    if (!finishedStatuses.has(job.status)) throw new Error('Only finished crawl history can be deleted.')
    return job
  })
  if (!job) return null
  let productsDeleted = 0, productsSkipped = 0, imagesDeleted = 0
  if (deleteImportedData) {
    const productIds = [...new Set(job.items.map((item) => item.productId).filter((productId): productId is string => Boolean(productId)))]
    for (const productId of productIds) {
      if (!/^[a-z0-9-]{1,128}$/.test(productId)) { productsSkipped += 1; continue }
      const prefix = `catalog/${slug(job.brandName)}/${productId}/crawls/${job.id}/images/`
      const [files] = await firebaseStore().storage.bucket().getFiles({ prefix })
      for (let index = 0; index < files.length; index += 25) await Promise.all(files.slice(index, index + 25).map((file) => file.delete({ ignoreNotFound: true })))
      imagesDeleted += files.length
      const productRef = db.collection('catalogProducts').doc(productId), editRef = db.collection('catalogEdits').doc(productId)
      const result = await db.runTransaction(async (transaction) => {
        const [latestJob, productSnapshot, editSnapshot] = await Promise.all([transaction.get(ref), transaction.get(productRef), transaction.get(editRef)])
        if (!latestJob.exists || !productSnapshot.exists) return 'missing'
        const latest = latestJob.data() as MetadataCrawlJob
        if (!finishedStatuses.has(latest.status)) throw new Error('Only finished crawl history can be deleted.')
        if (!latest.items.some((item) => item.productId === productId)) return 'unlinked'
        const product = productSnapshot.data() as { importedBy?: string }, edit = editSnapshot.data() || {}
        if (!metadataProductBelongsToCrawl(product, edit, job.id)) return 'unlinked'
        const textures = edit.variantTextures && typeof edit.variantTextures === 'object' ? edit.variantTextures as Record<string, unknown> : {}
        transaction.delete(productRef)
        if (typeof edit.modelPath !== 'string' && !Object.keys(textures).length) transaction.delete(editRef)
        else transaction.set(editRef, { importedFromCrawlId: null }, { merge: true })
        return 'deleted'
      })
      if (result === 'deleted') productsDeleted += 1
      if (result === 'unlinked') productsSkipped += 1
    }
  }
  const deletedJob = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const latest = snapshot.data() as MetadataCrawlJob
    if (!finishedStatuses.has(latest.status)) throw new Error('Only finished crawl history can be deleted.')
    transaction.delete(ref)
    return latest
  })
  return deletedJob ? { job: deletedJob, productsDeleted, productsSkipped, imagesDeleted } : null
}

export async function clearFinishedMetadataCrawls() {
  const db = firebaseStore().db, snapshot = await collection().get()
  let deleted = 0, skippedActive = 0
  for (const doc of snapshot.docs) {
    const result = await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(doc.ref)
      if (!latest.exists) return 'missing'
      const job = latest.data() as MetadataCrawlJob
      if (!finishedStatuses.has(job.status)) return 'active'
      transaction.delete(doc.ref)
      return 'deleted'
    })
    if (result === 'deleted') deleted += 1
    if (result === 'active') skippedActive += 1
  }
  return { deleted, skippedActive }
}

export const captureMetadata = readFileSync(new URL('./extractors/capture-metadata.browser.js', import.meta.url), 'utf8')

type RawImage = { url: string; altText?: string; width?: number | null; height?: number | null; source?: string }
type RawMetadata = Record<string, unknown> & { images?: RawImage[] }
type Dimensions = { width: number | null; depth: number | null; height: number | null; source: string | null }

/** Parses machine (`1690.00`) and localized (`1.690,00 €`, `1,690`) prices. */
export function parsePrice(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value < 1e8 ? value : null
  const match = String(value ?? '').replace(/[\s\u00a0]/g, '').match(/\d[\d.,]*/)
  if (!match) return null
  let text = match[0].replace(/[.,]+$/, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '')
  else if (/^\d+,\d+$/.test(text)) text = text.replace(',', '.')
  else if (!/^\d+(\.\d+)?$/.test(text)) text = text.replace(/[.,](?=.*[.,])/g, '').replace(',', '.')
  const amount = Number(text)
  return Number.isFinite(amount) && amount > 0 && amount < 1e8 ? amount : null
}

const plainText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const dimensionText = (value: string) => plainText(value).replace(/(\d),(\d)/g, '$1.$2').replace(/[×χ*]/g, 'x')
const unitFactor = (unit: string | undefined) => !unit ? null : /^mm/.test(unit) ? 0.1 : /^(?:cm|εκ)/.test(unit) ? 1 : /^m/.test(unit) ? 100 : null
const textUnit = (text: string) => /\d\s*mm\b|χιλιοστ|millimet/.test(text) ? 0.1 : /\d\s*(?:cm|εκ)|εκατοστ|centimet/.test(text) ? 1 : /\d\s*m\b|\bμετρ|\bmeter|\bmetre/.test(text) ? 100 : null
const inferredUnit = (values: number[]) => values.every((value) => value < 10) && values.some((value) => !Number.isInteger(value)) ? 100 : values.some((value) => value > 600) ? 0.1 : 1
const metresWrittenAsCm = (factor: number, values: number[]) => factor === 1 && values.every((value) => value < 10) && values.some((value) => !Number.isInteger(value)) ? 100 : factor
const fieldLabels = {
  width: 'πλατος|μηκος|φαρδος|width|length|πλ|μηκ|w|l|π|μ',
  depth: 'βαθος|depth|βαθ|d|β',
  height: 'υψος|height|υψ|h|υ',
} as const

/** Reads furniture dimensions in centimetres from labelled values or `W x D x H` text, in priority order. */
export function parseDimensions(texts: string[]): Dimensions {
  const result: Dimensions = { width: null, depth: null, height: null, source: null }
  const valid = (value: number) => value >= 1 && value <= 2000 ? Math.round(value * 10) / 10 : null
  const sources: string[] = []
  for (const original of texts) {
    const text = dimensionText(original), unit = textUnit(text)
    for (const [field, labels] of Object.entries(fieldLabels) as [keyof typeof fieldLabels, string][]) {
      if (result[field] !== null) continue
      const match = text.match(new RegExp(`(?:^|[^a-zα-ω]|x)(?:${labels})\\.?\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)\\s*(mm|cm|εκ|m)?(?![a-zα-ω0-9])`))
      if (!match) continue
      const amount = Number(match[1]), factor = metresWrittenAsCm(unitFactor(match[2]) ?? unit ?? inferredUnit([amount]), [amount])
      const value = valid(amount * factor)
      if (value !== null) { result[field] = value; sources.push(original) }
    }
  }
  if (result.width === null || result.depth === null || result.height === null) {
    for (const original of texts) {
      const text = dimensionText(original)
      const match = text.match(/(\d+(?:\.\d+)?)\s*(?:mm|cm|εκ\.?|m)?\s*x\s*[a-zα-ω]{0,2}\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|εκ\.?|m)?(?:\s*x\s*[a-zα-ω]{0,2}\s*(\d+(?:\.\d+)?))?/)
      if (!match) continue
      const values = [match[1], match[2], match[3]].filter(Boolean).map(Number)
      const factor = metresWrittenAsCm(textUnit(text) ?? inferredUnit(values), values)
      const [width, depth, height] = values.map((value) => valid(value * factor))
      if (result.width === null) result.width = width ?? null
      if (result.depth === null) result.depth = depth ?? null
      if (result.height === null && values.length === 3) result.height = height ?? null
      sources.push(original)
      if (values.length === 3) break
    }
  }
  result.source = sources.length ? [...new Set(sources)].join(' · ').slice(0, 300) : null
  return result
}

const groupTerms: [Product['group'], RegExp][] = [
  ['Seating', /sofa|couch|armchair|chair|stool|bench|pouf|recliner|καναπ|πολυθρον|καρεκλ|σκαμπ|μπερζερ|καθισμ|ανακλιντρ|πουφ|μπανκετ/],
  ['Tables', /table|desk|console|τραπεζ|γραφει|κονσολ/],
  ['Bedroom', /bed|mattress|nightstand|κρεβατ|στρωμ|κομοδιν|κρεβατοκαμαρ|παιδικ/],
  ['Lighting', /lamp|light|chandelier|pendant|φωτιστ|λαμπ|φαναρ|πολυφωτ|πορτατιφ/],
  ['Storage', /cabinet|shelf|shelving|bookcase|wardrobe|sideboard|buffet|dresser|storage|tv unit|\btv\b|συνθετ|ντουλαπ|βιβλιοθηκ|ραφι|συρταριερ|μπουφε|παπουτσοθηκ|βιτριν|τηλεορασ|ραφιερ/],
  ['Kitchen', /kitchen|κουζιν/],
  ['Bathroom', /bath|μπανι/],
]

/** Picks the group whose term appears first; Greek and English product nouns lead the phrase. */
export function productGroupFor(...texts: string[]): Product['group'] {
  for (const text of texts.map(plainText)) {
    const matches = groupTerms.map(([group, pattern]) => ({ group, index: text.search(pattern) })).filter((item) => item.index >= 0).sort((left, right) => left.index - right.index)
    if (matches.length) return matches[0].group
  }
  return 'Decor'
}

const stripSiteSuffix = (value: string, sites: string[]) => {
  const parts = value.split(/\s+[|–—-]\s+/)
  if (parts.length < 2) return value
  const last = comparableName(parts.at(-1) || '')
  return sites.some((site) => { const key = comparableName(site); return key && (last.includes(key) || key.includes(last)) }) || parts.at(-1)!.includes('|') ? parts.slice(0, -1).join(' - ') : value
}

const attributeList = (raw: RawMetadata) => (Array.isArray(raw.attributes) ? raw.attributes as { label: string; value: string }[] : []).filter((item) => item && typeof item.label === 'string' && typeof item.value === 'string')
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const pairList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is [string, unknown] => Array.isArray(item) && typeof item[0] === 'string') : []

export function safeProduct(raw: RawMetadata, job: MetadataCrawlJob, url: string, images: ProductMetadata['images'], imageUrls: string[], options: { id?: string; warnings?: string[] } = {}): Product {
  const attrs = attributeList(raw)
  const attributeTexts = (pattern: RegExp) => attrs.filter((item) => pattern.test(plainText(item.label))).map((item) => `${item.label}: ${item.value}`)
  const structured = (['width', 'depth', 'height'] as const).flatMap((field) => {
    const value = raw[field] as unknown
    if (typeof value === 'number') return [`${field}: ${value} cm`]
    if (!value || typeof value !== 'object') return []
    const unit = String((value as { unit?: unknown }).unit || '').toUpperCase(), amount = (value as { value?: unknown }).value
    return amount == null ? [] : [`${field}: ${amount} ${unit === 'MMT' || unit === 'MM' ? 'mm' : unit === 'MTR' || unit === 'M' ? 'm' : 'cm'}`]
  })
  const dimensionTexts = [...structured, ...attributeTexts(/διαστασ|dimension|μεγεθ|size/), ...attributeTexts(/^(?:πλατος|βαθος|υψος|μηκος|width|depth|height|length)/), ...stringList(raw.dimensionTexts)]
  const dimensions = parseDimensions(dimensionTexts)
  const sites = [job.brandName, String(raw.siteName || ''), String(raw.sourceBrand || '')]
  const nameCandidates = [...stringList(raw.nameCandidates), String(raw.name || '')].map((value) => stripSiteSuffix(value.trim(), sites))
  const name = (nameCandidates.find((value) => isProductName(value, job.brandName)) || '').slice(0, 160)
  const category = String(raw.category || '').trim().slice(0, 80) || 'Furniture'
  const group = productGroupFor(category, stringList(raw.breadcrumbs).slice(1).join(' '), name)
  const sku = typeof raw.sku === 'string' && raw.sku.trim() ? raw.sku.trim().slice(0, 100) : null
  const priceCandidates = pairList(raw.priceCandidates)
  const priceMatch = priceCandidates.map(([source, value]) => ({ source, value: parsePrice(value) })).find((item) => item.value !== null)
  const price = priceMatch?.value ?? parsePrice(raw.price)
  const width = dimensions.width || 0, depth = dimensions.depth || 0, height = dimensions.height || 0
  const id = options.id || metadataProductId(job.retailerId, sku, name, url)
  const attribute = (pattern: RegExp) => attrs.find((item) => pattern.test(plainText(item.label)))
  const weight = attribute(/^(?:βαρος|weight)/)
  const weightValue = weight ? parsePrice(weight.value) : null
  const weightKg = weightValue === null ? null : /\d\s*(?:g|gr|γρ)\b/i.test(weight!.value) && !/kg|κιλ/i.test(weight!.value) ? weightValue / 1000 : weightValue
  const packages = attribute(/δεμα|κιβωτ|package|parcel/)
  const materials = Object.fromEntries(attrs.filter((item) => /υλικ|material|υφασμα|fabric|δερμα|leather|ξυλ|wood|μεταλλ|metal|χρωμα|colou?r|φινιρισμα|finish|επενδυσ|σκελετ|frame|ποδι|legs|αφρο|foam|γεμισ|filling/.test(plainText(item.label))).slice(0, 20).map((item) => [item.label.slice(0, 80), item.value.slice(0, 300)]))
  const missingFields = [['name', name], ['SKU', sku], ['price', price], ['width', width], ['depth', depth], ['height', height], ['images', images.length]].filter(([, value]) => !value).map(([field]) => String(field))
  const skuSource = typeof raw.skuSource === 'string' ? raw.skuSource : 'product page'
  const warnings = [
    ...stringList(raw.warnings), ...(options.warnings || []), ...missingFields.map((field) => `Missing ${field}.`),
    ...(sku && skuSource === 'product URL number' ? ['SKU was inferred from the number in the product URL; confirm it with the retailer.'] : []),
    ...(dimensions.source && (!width || !depth || !height) ? [`Dimensions are incomplete; source text: ${dimensions.source}`] : []),
    'No 3D model was generated; upload a reviewed GLB from the product detail page.',
  ]
  const fieldSources: ProductMetadata['fieldSources'] = {
    name: { source: 'product page heading or structured data', confidence: name ? 'high' : 'low' },
    sku: { source: skuSource, confidence: !sku ? 'low' : skuSource.startsWith('json-ld') || skuSource.startsWith('microdata') || skuSource === 'page sku' ? 'high' : 'medium' },
    price: { source: priceMatch?.source || 'not found', confidence: !priceMatch ? 'low' : priceMatch.source === 'page price' ? 'medium' : 'high' },
    dimensions: { source: dimensions.source || 'not found', confidence: width && depth && height ? 'medium' : 'low' },
    category: { source: stringList(raw.breadcrumbs).length ? `breadcrumbs: ${stringList(raw.breadcrumbs).join(' › ')}`.slice(0, 300) : 'product page', confidence: raw.category ? 'medium' : 'low' },
    images: { source: [...new Set(images.map((image) => image.role))].join(', ') || 'not found', confidence: images.length ? 'medium' : 'low' },
  }
  const metadata: ProductMetadata = {
    sourceBrand: typeof raw.sourceBrand === 'string' && raw.sourceBrand ? raw.sourceBrand.slice(0, 120) : null,
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle.slice(0, 240) : null,
    canonicalUrl: typeof raw.canonicalUrl === 'string' && /^https:\/\//.test(raw.canonicalUrl) ? raw.canonicalUrl : url,
    description: typeof raw.description === 'string' && raw.description ? raw.description.slice(0, 4000) : null,
    availabilityStatus: typeof raw.availability === 'string' && raw.availability ? raw.availability.slice(0, 80) : null,
    attributes: attrs.slice(0, 80), materials, packageCount: packages ? parsePrice(packages.value) : null, weightKg, packageDimensions: [],
    extractedAt: now(), extractor: 'generic-jsonld-dom-v2', warnings, missingFields, fieldSources, images,
  }
  return {
    id, retailerId: job.retailerId, retailerName: job.brandName, retailer: job.brandName, sourceUrl: metadata.canonicalUrl || url, sku, name: name || 'Untitled product',
    brand: job.brandName, group, category, width, depth, height, price, currency: typeof raw.currency === 'string' && raw.currency ? raw.currency.slice(0, 3).toUpperCase() : 'EUR',
    tone: '#c9c6bd', accent: '#857b6b', status: `${missingFields.length ? 'Metadata incomplete' : 'Metadata captured'} · 3D model missing`, thumbnailPath: imageUrls[0] || null, modelPath: null,
    variants: [], sourceImages: imageUrls, metadata, verification: { productData: missingFields.length ? 'partial' : 'extracted', model: 'pending', dimensions: width && depth && height ? 'pending' : 'failed', generatedAsset: 'failed', humanReview: 'pending', warnings },
  } as Product
}

const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }

function sniffImage(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (bytes.subarray(4, 12).toString('latin1').startsWith('ftypavi')) return 'image/avif'
  return null
}

/** Downloads one public product image with the crawler browser's request context and manual, validated redirects. */
export async function readImage(url: string, request?: APIRequestContext, referer?: string) {
  const context = request || await playwrightRequest.newContext()
  try {
    let target = url
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await validatePublicUrl(target)
      const response = await context.get(target, { maxRedirects: 0, timeout: 20000, failOnStatusCode: false, headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', ...(referer ? { referer } : {}) } })
      const status = response.status(), headers = response.headers()
      if (status >= 300 && status < 400 && headers.location) { target = new URL(headers.location, target).toString(); continue }
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      if (Number(headers['content-length'] || 0) > 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB.')
      const bytes = Buffer.from(await response.body())
      if (bytes.length > 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB.')
      if (bytes.length < 2048) throw new Error('Image is too small to be a product photo.')
      const declared = (headers['content-type'] || '').split(';')[0].trim().toLowerCase(), type = sniffImage(bytes)
      if (!type || (imageTypes[declared] && imageTypes[declared] !== imageTypes[type])) throw new Error(`Unsupported image type ${declared || 'unknown'}.`)
      return { bytes, type, ext: imageTypes[type] }
    }
    throw new Error('Too many image redirects.')
  } finally { if (!request) await context.dispose() }
}

async function storeImages(rawImages: RawImage[], job: MetadataCrawlJob, productId: string, request?: APIRequestContext, referer?: string) {
  const images: ProductMetadata['images'] = [], imageUrls: string[] = [], warnings: string[] = [], hashes = new Set<string>()
  for (const item of rawImages) {
    if (images.length >= 10) break
    try {
      const image = await readImage(item.url, request, referer)
      const hash = createHash('sha256').update(image.bytes).digest('hex')
      if (hashes.has(hash)) continue
      hashes.add(hash)
      const key = `catalog/${slug(job.brandName)}/${productId}/crawls/${job.id}/images/${hash}.${image.ext}`
      const storedUrl = await uploadBuffer(image.bytes, key, image.type, { public: true })
      imageUrls.push(storedUrl)
      images.push({ url: storedUrl, sourceUrl: item.url, role: images.length === 0 ? 'hero' : 'gallery', altText: item.altText || null, width: item.width ?? null, height: item.height ?? null })
    } catch (error) {
      warnings.push(`Image not stored (${item.url.slice(0, 160)}): ${error instanceof Error ? error.message : String(error)}`.slice(0, 300))
    }
  }
  return { images, imageUrls, warnings: warnings.slice(0, 8) }
}

export class DuplicateProductError extends Error {
  constructor(public productId: string, message: string) { super(message) }
}

async function extractProduct(page: Page, job: MetadataCrawlJob, url: string, options: { id?: string; duplicateOf?: (candidate: { id: string; sku: string | null; url: string }) => Record<string, unknown> | null } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
  await page.evaluate('window.scrollTo(0, Math.min(document.body.scrollHeight, 1600))').catch(() => {})
  await page.waitForTimeout(1200)
  const raw = await page.evaluate(captureMetadata) as RawMetadata
  const sites = [job.brandName, String(raw.siteName || '')]
  const names = [...stringList(raw.nameCandidates), String(raw.name || '')].map((value) => stripSiteSuffix(value.trim(), sites))
  const name = names.find((value) => isProductName(value, job.brandName))
  if (!name || !Array.isArray(raw.images)) throw new Error('No product-specific name or image data found on page.')
  const sku = typeof raw.sku === 'string' && raw.sku.trim() ? raw.sku.trim().slice(0, 100) : null
  const id = options.id || metadataProductId(job.retailerId, sku, name, url)
  const duplicate = options.duplicateOf?.({ id, sku, url: typeof raw.canonicalUrl === 'string' ? raw.canonicalUrl : url })
  if (duplicate) throw new DuplicateProductError(String(duplicate.id), `Already in the catalogue as "${String(duplicate.name || duplicate.id)}" (${String(duplicate.id)})${sku ? ` with SKU ${sku}` : ''}; not imported. Use Refetch metadata on that product to update it.`)
  const stored = await storeImages(raw.images, job, id, page.context().request, page.url())
  if (raw.images.length && !stored.images.length) stored.warnings.unshift(`None of the ${raw.images.length} product images could be stored.`)
  return safeProduct(raw, job, url, stored.images, stored.imageUrls, { id, warnings: stored.warnings })
}

async function withCrawlerPage<T>(website: string, run: (page: Page) => Promise<T>) {
  const browser: Browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  try {
    const page = await browser.newPage({ locale: 'el-GR', viewport: { width: 1366, height: 900 } })
    const originHost = new URL(website).hostname
    await page.route('**/*', async (route) => {
      try {
        const request = route.request()
        await validatePublicUrl(request.url(), request.isNavigationRequest() && request.frame() === page.mainFrame() ? originHost : undefined)
        await route.continue()
      } catch { await route.abort() }
    })
    return await run(page)
  } finally { await browser.close() }
}

const urlKey = (value: unknown) => {
  try { const url = new URL(String(value)); return `${url.hostname.replace(/^www\./, '')}${decodeURI(url.pathname).replace(/\/+$/, '')}`.toLowerCase() } catch { return '' }
}

/** Effective catalogue (bundled, imported, and admin SKU/retailer overrides) used for duplicate checks. */
async function catalogForDuplicates() {
  const db = firebaseStore().db
  const [productsSnapshot, editsSnapshot] = await Promise.all([db.collection('catalogProducts').get(), db.collection('catalogEdits').get()])
  const byId = new Map<string, Record<string, unknown>>(bundledProducts.map((product) => [product.id, { ...product } as Record<string, unknown>]))
  for (const doc of productsSnapshot.docs) byId.set(doc.id, { ...byId.get(doc.id), ...doc.data(), id: doc.id })
  for (const doc of editsSnapshot.docs) {
    const product = byId.get(doc.id)
    if (product) byId.set(doc.id, applyCatalogMetadataOverrides(product, readCatalogMetadataOverrides(doc.data().overrides)))
  }
  return [...byId.values()]
}

export async function runMetadataCrawl(id: string) {
  const job = await getMetadataCrawl(id)
  if (!job || job.status === 'completed') return job
  try {
    if (!job.discoveredUrls.length) {
      job.status = 'discovering'; await setJob(job)
      const policy = await robotsPolicy(job.website)
      job.delayMs = Math.max(job.delayMs, policy.crawlDelayMs)
      job.discoveredUrls = await discoverProductUrls(job.website, job.maxProducts, policy, job.delayMs)
      job.items = job.discoveredUrls.map((url) => ({ url, productId: null, status: 'queued', error: null, updatedAt: now() }))
    }
    job.status = 'running'; await setJob(job)
    const catalog = await catalogForDuplicates()
    const duplicateOf = ({ id, sku, url }: { id: string; sku: string | null; url: string }) =>
      duplicateSkuProduct(catalog, { sku, retailerId: job.retailerId, retailer: job.brandName })
      || catalog.find((product) => product.id === id || (urlKey(product.sourceUrl) && urlKey(product.sourceUrl) === urlKey(url))) || null
    await withCrawlerPage(job.website, async (page) => {
      for (const item of job.items) {
        if (item.status === 'saved' || item.status === 'duplicate') continue
        job.currentUrl = item.url; item.status = 'scraping'; await setJob(job)
        try {
          const product = await extractProduct(page, job, item.url, { duplicateOf })
          const db = firebaseStore().db, productRef = db.collection('catalogProducts').doc(product.id), editRef = db.collection('catalogEdits').doc(product.id)
          item.productId = product.id
          await db.runTransaction(async (transaction) => {
            const [previous, edit] = await Promise.all([transaction.get(productRef), transaction.get(editRef)])
            if (previous.exists) throw new DuplicateProductError(product.id, `Already in the catalogue as ${product.id}; not imported.`)
            transaction.create(productRef, { ...product, createdAt: now(), updatedAt: now(), importedBy: 'metadata-crawl' })
            transaction.set(editRef, { importedFromCrawlId: job.id, ...(!edit.exists ? { hidden: true, review: 'pending', updatedAt: now() } : {}) }, { merge: true })
          })
          catalog.push(product as unknown as Record<string, unknown>)
          item.status = 'saved'; item.error = product.metadata?.warnings.filter((warning) => warning.startsWith('Image not stored') || warning.startsWith('None of the')).slice(0, 2).join(' ') || null
        } catch (error) {
          if (error instanceof DuplicateProductError) { item.status = 'duplicate'; item.productId = error.productId }
          else item.status = 'failed'
          item.error = error instanceof Error ? error.message : String(error)
        }
        item.updatedAt = now(); await setJob(job); await sleep(job.delayMs)
      }
    })
    job.status = 'completed'; job.currentUrl = null; await setJob(job)
  } catch (error) {
    job.status = 'failed'; job.currentUrl = null; job.error = error instanceof Error ? error.message : String(error); await setJob(job)
  }
  return job
}

/** Re-crawls one imported product's source page in place, keeping its id, brand, variants, and admin edits. */
export async function refetchMetadataProduct(id: string) {
  const db = firebaseStore().db, ref = db.collection('catalogProducts').doc(id), snapshot = await ref.get()
  if (!snapshot.exists || bundledProducts.some((product) => product.id === id)) throw new Error('Only imported or manually added catalogue products can be refetched.')
  const existing = snapshot.data() as Record<string, unknown>
  const sourceUrl = typeof existing.sourceUrl === 'string' ? existing.sourceUrl : ''
  if (!/^https:\/\//i.test(sourceUrl)) throw new Error('This product has no HTTPS source page to refetch.')
  await validatePublicUrl(sourceUrl)
  const brandName = String(existing.retailer || existing.brand || new URL(sourceUrl).hostname).trim()
  const job: MetadataCrawlJob = { id: `refetch-${Date.now()}`, brandName, retailerId: String(existing.retailerId || slug(brandName)), website: new URL(sourceUrl).origin, maxProducts: 1, delayMs: 0, status: 'running', discoveredUrls: [sourceUrl], items: [], currentUrl: sourceUrl, error: null, createdAt: now(), updatedAt: now() }
  const product = await withCrawlerPage(job.website, (page) => extractProduct(page, job, sourceUrl, { id }))
  const duplicate = duplicateSkuProduct(await catalogForDuplicates(), { sku: product.sku, retailerId: job.retailerId, retailer: job.brandName }, id)
  if (duplicate) product.metadata?.warnings.unshift(`SKU ${product.sku} is also used by "${String(duplicate.name)}" (${String(duplicate.id)}).`)
  const previousImages = stringList(existing.sourceImages)
  const keepImages = !product.sourceImages?.length && previousImages.length > 0
  if (keepImages) product.metadata?.warnings.unshift('No new images were stored; the previous images were kept.')
  const record = {
    ...product, id,
    brand: typeof existing.brand === 'string' && existing.brand ? existing.brand : product.brand,
    tone: existing.tone || product.tone, accent: existing.accent || product.accent,
    variants: Array.isArray(existing.variants) && existing.variants.length ? existing.variants : product.variants,
    modelPath: typeof existing.modelPath === 'string' ? existing.modelPath : null,
    ...(keepImages ? { sourceImages: previousImages, thumbnailPath: existing.thumbnailPath || previousImages[0], metadata: { ...product.metadata, images: (existing.metadata as ProductMetadata | undefined)?.images || product.metadata?.images || [] } } : {}),
    importedBy: existing.importedBy || 'metadata-crawl', createdAt: existing.createdAt || now(), updatedAt: now(), refetchedAt: now(),
  }
  await ref.set(JSON.parse(JSON.stringify(record)))
  return record
}
