import { createHash, randomUUID } from 'node:crypto'
import { chromium, type Browser } from '@playwright/test'
import type { Product, ProductMetadata } from '../src/catalog'
import { discoverProductUrls, robotsPolicy, validatePublicUrl } from './catalog-workflow'
import { firebaseStore, uploadBuffer } from './firebase-store'

export type MetadataCrawlStatus = 'queued' | 'discovering' | 'running' | 'completed' | 'failed'
export type MetadataCrawlItem = { url: string; productId: string | null; status: 'queued' | 'scraping' | 'saved' | 'failed'; error: string | null; updatedAt: string }
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

export function safeProduct(raw: Record<string, unknown>, job: MetadataCrawlJob, url: string, images: ProductMetadata['images'], imageUrls: string[]): Product {
  const attrs = Array.isArray(raw.attributes) ? raw.attributes as { label: string; value: string }[] : []
  const dimensionText = attrs.find((item) => /dimension|size|διαστάσ|διάστασ|μέγεθ/i.test(item.label))?.value || ''
  const unitFactor = /mm\b/i.test(dimensionText) ? 0.1 : /\bm\b/i.test(dimensionText) && !/\bcm\b/i.test(dimensionText) ? 100 : 1
  const values = [...dimensionText.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((item) => Number(item[1].replace(',', '.')) * unitFactor).filter((item) => item > 0 && item < 2000)
  const category = String(raw.category || 'Furniture').slice(0, 80)
  const group: Product['group'] = /sofa|chair|armchair|stool|καναπ|καρεκλ/i.test(category) ? 'Seating'
    : /table|desk|τραπεζ/i.test(category) ? 'Tables'
    : /bed|mattress|κρεβατ/i.test(category) ? 'Bedroom'
    : /lamp|light|φωτισ/i.test(category) ? 'Lighting'
    : /cabinet|shelf|storage|ντουλαπ/i.test(category) ? 'Storage' : 'Decor'
  const sku = typeof raw.sku === 'string' && raw.sku.trim() ? raw.sku.trim().slice(0, 100) : null
  const name = String(raw.name || '').trim().slice(0, 160)
  const width = Number(raw.width) || values[0] || 0, depth = Number(raw.depth) || values[1] || 0, height = Number(raw.height) || values[2] || 0
  const price = Number.isFinite(Number(raw.price)) && Number(raw.price) > 0 ? Number(raw.price) : null
  const id = metadataProductId(job.retailerId, sku, name, url)
  const missingFields = [['name', name], ['SKU', sku], ['price', price], ['width', width], ['depth', depth], ['height', height], ['images', images.length]].filter(([, value]) => !value).map(([field]) => String(field))
  const warnings = [...(Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === 'string') : []), ...missingFields.map((field) => `Missing ${field}.`), 'No 3D model was generated; upload a reviewed GLB from the product detail page.']
  const metadata: ProductMetadata = {
    sourceBrand: typeof raw.sourceBrand === 'string' ? raw.sourceBrand.slice(0, 120) : null,
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle.slice(0, 240) : null,
    canonicalUrl: typeof raw.canonicalUrl === 'string' ? raw.canonicalUrl : url,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 4000) : null,
    availabilityStatus: typeof raw.availability === 'string' ? raw.availability.slice(0, 80) : null,
    attributes: attrs.slice(0, 60), materials: {}, packageCount: null, weightKg: null, packageDimensions: [],
    extractedAt: now(), extractor: 'generic-jsonld-dom-v1', warnings, missingFields,
    fieldSources: Object.fromEntries(['name', 'price', 'sku', 'dimensions', 'images'].map((field) => [field, { source: 'product page metadata', confidence: 'medium' as const }])),
    images,
  }
  return {
    id, retailerId: job.retailerId, retailerName: job.brandName, retailer: job.brandName, sourceUrl: metadata.canonicalUrl || url, sku, name: name || 'Untitled product',
    brand: job.brandName, group, category, width, depth, height, price, currency: typeof raw.currency === 'string' ? raw.currency : 'EUR',
    tone: '#c9c6bd', accent: '#857b6b', status: `${missingFields.length ? 'Metadata incomplete' : 'Metadata captured'} · 3D model missing`, thumbnailPath: imageUrls[0] || null, modelPath: null,
    variants: [], sourceImages: imageUrls, metadata, verification: { productData: missingFields.length ? 'partial' : 'extracted', model: 'pending', dimensions: width && depth && height ? 'pending' : 'failed', generatedAsset: 'failed', humanReview: 'pending', warnings },
  } as Product
}

export const captureMetadata = `(() => {
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim()
  const json = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(node => { try { const value = JSON.parse(node.textContent || 'null'); return Array.isArray(value) ? value : [value] } catch { return [] } })
  const flatten = values => values.flatMap(value => value && typeof value === 'object' ? [value, ...(Array.isArray(value['@graph']) ? flatten(value['@graph']) : [])] : [])
  const product = flatten(json).find(value => String(value['@type'] || '').toLowerCase().includes('product')) || {}
  const productNode = [...document.querySelectorAll('[itemscope][itemtype]')].find(node => /schema\\.org\\/product/i.test(node.getAttribute('itemtype') || '') && node.querySelector('h1[itemprop="name"]'))
  const property = (scope, name) => scope?.querySelector('[itemprop="' + name + '"]')
  const valueOf = node => node?.getAttribute('content') || node?.getAttribute('href') || node?.getAttribute('src') || clean(node?.textContent)
  const productValue = name => valueOf(property(productNode, name))
  const offerNode = property(productNode, 'offers')
  const offerValue = name => valueOf(property(offerNode, name))
  const meta = selector => document.querySelector(selector)?.content || ''
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers || {}
  const number = value => { const match = String(value || '').replace(',', '.').match(/[0-9]+(?:\\.[0-9]+)?/); return match ? Number(match[0]) : null }
  const absoluteUrl = value => { try { return new URL(value, location.href).href } catch { return '' } }
  const scope = productNode || document
  const rows = [...scope.querySelectorAll('table tr, .woocommerce-product-attributes tr, dl')].map(row => {
    const labelNode = row.querySelector('th,dt,.data-label') || row.querySelector('td[data-label]')
    const cells = [...row.querySelectorAll('td')]
    const label = clean(labelNode?.textContent || labelNode?.getAttribute('data-label'))
    const value = clean(row.querySelector('dd')?.textContent || cells.find(cell => cell !== labelNode)?.textContent)
    return label && value ? { label, value } : null
  }).filter(Boolean)
  const dimension = key => { const value = product[key] || productValue(key); if (!value) return null; return number(typeof value === 'object' ? value.value : value) }
  const visibleText = document.body.innerText || ''
  const skuFromText = visibleText.match(/(?:sku|product\\s*(?:code|id)|κωδικός προϊόντος)\\s*[:#]?\\s*([a-z0-9_-]+)/i)?.[1]
  const urlSlug = new URL(location.href).pathname.split('/').filter(Boolean).pop() || ''
  const skuFromUrl = urlSlug.match(/^(\\d+)(?:-|$)|(?:^|-)(\\d+)$/)
  const name = clean(product.name || productValue('name') || document.querySelector('h1')?.textContent || meta('meta[property="og:title"]')).slice(0, 160)
  const brand = typeof product.brand === 'string' ? product.brand : product.brand?.name || productValue('brand')
  const categoryLink = [...document.querySelectorAll('a[href]')].map(link => clean(link.textContent)).find(text => text.toLowerCase().includes('επιστροφ') || text.toLowerCase().startsWith('back to:')) || ''
  const category = Array.isArray(product.category) ? product.category.at(-1) : product.category || productValue('category') || categoryLink.slice(categoryLink.indexOf(':') + 1).trim()
  const productImages = (Array.isArray(product.image) ? product.image : [product.image]).map(image => {
    const source = typeof image === 'string' ? image : image && typeof image === 'object' ? image.url || image.contentUrl || image['@id'] || '' : ''
    return { url: absoluteUrl(source), altText: image && typeof image === 'object' ? clean(String(image.caption || image.name || '')) : '', width: Number(image?.width) || null, height: Number(image?.height) || null }
  })
  const imageNodes = [...scope.querySelectorAll('[itemprop="image"]')]
  const pageImages = (imageNodes.length ? imageNodes : [...scope.querySelectorAll('img')]).map(image => ({ url: absoluteUrl(image.dataset?.src || image.dataset?.lazySrc || image.getAttribute('data-lazy-src') || image.currentSrc || image.src || image.getAttribute('href')), altText: clean(image.alt || image.getAttribute('alt')), width: image.naturalWidth || null, height: image.naturalHeight || null }))
  const seenImages = new Set()
  const images = [...productImages, ...pageImages].filter(image => {
    if (!/^https?:/i.test(image.url) || new URL(image.url).pathname === location.pathname && new URL(image.url).hostname === location.hostname || /logo|icon|sprite|avatar/i.test(image.url) || seenImages.has(image.url)) return false
    seenImages.add(image.url)
    return true
  }).slice(0, 12)
  return { name, category: clean(category), sku: String(product.sku || product.gtin || productValue('sku') || skuFromText || skuFromUrl?.[1] || skuFromUrl?.[2] || ''), price: number(offer.price || offer.lowPrice || offerValue('price') || meta('meta[property="product:price:amount"]')), currency: offer.priceCurrency || offerValue('priceCurrency') || meta('meta[property="product:price:currency"]') || 'EUR', description: clean(product.description || productValue('description') || meta('meta[name="description"]')).slice(0, 4000), availability: String(offer.availability || offerValue('availability') || '').split('/').pop(), width: dimension('width'), depth: dimension('depth'), height: dimension('height'), sourceBrand: brand, pageTitle: document.title, canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null, attributes: rows.slice(0,60).map(item => ({ label: item.label.slice(0, 200), value: item.value.slice(0, 500) })), images }
})()`

function imageExtension(type: string) {
  const mime = type.split(';')[0].toLowerCase()
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[mime]
  if (!ext) throw new Error('Image type is not supported.')
  return ext
}

async function readImage(url: string) {
  let target = url, response: Response | null = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await validatePublicUrl(target)
    response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { accept: 'image/avif,image/webp,image/png,image/jpeg' } })
    if (response.status < 300 || response.status >= 400) break
    const location = response.headers.get('location')
    if (!location) break
    target = new URL(location, target).toString()
  }
  if (!response) throw new Error('Image request failed.')
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
  const type = response.headers.get('content-type') || ''
  const ext = imageExtension(type)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB.')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Image exceeds 8 MB.')
  return { bytes, type: type.split(';')[0], ext }
}

async function extractProduct(page: import('@playwright/test').Page, job: MetadataCrawlJob, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(800)
  const raw = await page.evaluate(captureMetadata) as Record<string, unknown> & { images?: { url: string; altText: string; width: number | null; height: number | null }[] }
  if (!isProductName(raw.name, job.brandName) || !Array.isArray(raw.images)) throw new Error('No product-specific name or image data found on page.')
  const sku = typeof raw.sku === 'string' && raw.sku.trim() ? raw.sku.trim().slice(0, 100) : null
  const id = metadataProductId(job.retailerId, sku, String(raw.name), url)
  const images: ProductMetadata['images'] = [], imageUrls: string[] = [], seen = new Set<string>()
  for (const [index, item] of raw.images.entries()) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    try {
      const image = await readImage(item.url)
      const hash = createHash('sha256').update(image.bytes).digest('hex')
      const key = `catalog/${slug(job.brandName)}/${id}/crawls/${job.id}/images/${hash}.${image.ext}`
      const storedUrl = await uploadBuffer(image.bytes, key, image.type, { public: true })
      imageUrls.push(storedUrl)
      images.push({ url: storedUrl, sourceUrl: item.url, role: index === 0 ? 'hero' : 'gallery', altText: item.altText || null, width: item.width, height: item.height })
    } catch { /* Keep the product and other images if one remote image is unavailable. */ }
    if (images.length >= 8) break
  }
  return safeProduct(raw, job, url, images, imageUrls)
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
    const browser: Browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
    try {
      const page = await browser.newPage()
      const originHost = new URL(job.website).hostname
      await page.route('**/*', async (route) => {
        try {
          const request = route.request()
          await validatePublicUrl(request.url(), request.isNavigationRequest() ? originHost : undefined)
          await route.continue()
        } catch { await route.abort() }
      })
      for (const item of job.items) {
        if (item.status === 'saved') continue
        job.currentUrl = item.url; item.status = 'scraping'; await setJob(job)
        try {
          const product = await extractProduct(page, job, item.url)
          const db = firebaseStore().db, productRef = db.collection('catalogProducts').doc(product.id), editRef = db.collection('catalogEdits').doc(product.id)
          item.productId = product.id
          await db.runTransaction(async (transaction) => {
            const [previous, edit] = await Promise.all([transaction.get(productRef), transaction.get(editRef)])
            transaction.set(productRef, { ...product, createdAt: previous.data()?.createdAt || now(), updatedAt: now(), importedBy: 'metadata-crawl' }, { merge: true })
            transaction.set(editRef, { importedFromCrawlId: job.id, ...(!edit.exists ? { hidden: true, updatedAt: now() } : {}) }, { merge: true })
          })
          item.status = 'saved'; item.error = null
        } catch (error) { item.status = 'failed'; item.error = error instanceof Error ? error.message : String(error) }
        item.updatedAt = now(); await setJob(job); await sleep(job.delayMs)
      }
      await page.close()
    } finally { await browser.close() }
    job.status = 'completed'; job.currentUrl = null; await setJob(job)
  } catch (error) {
    job.status = 'failed'; job.currentUrl = null; job.error = error instanceof Error ? error.message : String(error); await setJob(job)
  }
  return job
}
