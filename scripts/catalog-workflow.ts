import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { extractorFor } from './extractors'
import { runModelGeneration } from './generate-sofa'
import { registerCatalog } from './register-catalog'
import { runScraper } from './scrape-product'
import { runModelValidation } from './validate-model'
import type { CatalogProductRecord, NormalizedProduct } from './product-types'
import { getStoredJob, listStoredJobs, persistJob, uploadArtifactTree } from './firebase-store'

export const JOB_ROOT = path.resolve('artifacts/jobs')
export const DEFAULT_MAX_PRODUCTS = 100
export const DEFAULT_DELAY_MS = 1000

export type CrawlStatus = 'queued' | 'discovering' | 'running' | 'completed' | 'cancelled' | 'failed'
export type CrawlItemStatus = 'queued' | 'scraping' | 'skipped-existing' | 'needs-model-recipe' | 'generated' | 'failed'

export interface CrawlItem {
  url: string
  status: CrawlItemStatus
  sku: string | null
  productId: string | null
  artifactRoot: string | null
  error: string | null
  updatedAt: string
}

export interface CrawlJob {
  id: string
  siteUrl: string
  retailerId: string
  maxProducts: number
  delayMs: number
  status: CrawlStatus
  discoveredUrls: string[]
  items: CrawlItem[]
  currentUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

const running = new Set<string>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function jobPath(id: string) {
  return path.join(JOB_ROOT, `${id}.json`)
}

async function writeJob(job: CrawlJob) {
  await mkdir(JOB_ROOT, { recursive: true })
  const filename = jobPath(job.id)
  await writeFile(`${filename}.pending`, JSON.stringify(job, null, 2), 'utf8')
  await rename(`${filename}.pending`, filename)
  try { await persistJob(job) } catch (error) { console.warn(`Firestore job persistence unavailable: ${error instanceof Error ? error.message : String(error)}`) }
}

export async function getJob(id: string) {
  try {
    const stored = await getStoredJob(id)
    if (stored) return stored
  } catch (error) { console.warn(`Firestore job read unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  return JSON.parse(await readFile(jobPath(id), 'utf8')) as CrawlJob
}

export async function listJobs() {
  try {
    const stored = await listStoredJobs()
    if (stored.length) return stored
  } catch (error) { console.warn(`Firestore job listing unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  await mkdir(JOB_ROOT, { recursive: true })
  const entries = await (await import('node:fs/promises')).readdir(JOB_ROOT)
  return Promise.all(entries.filter((entry) => entry.endsWith('.json')).map((entry) => readFile(path.join(JOB_ROOT, entry), 'utf8').then((value) => JSON.parse(value) as CrawlJob)))
}

function normalizeUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'product'
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': 'FormaCatalogAdmin/0.1 (+controlled internal catalog review)', accept: 'text/html,application/xml,text/plain;q=0.9,*/*;q=0.1' } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.text()
}

function locations(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim())
}

async function robotsPolicy(siteUrl: string) {
  const origin = new URL(siteUrl).origin
  try {
    const text = await fetchText(`${origin}/robots.txt`)
    const sitemaps = [...text.matchAll(/^sitemap:\s*(\S+)/gim)].map((match) => match[1])
    const disallowed = text.split(/^user-agent:/im).slice(1).find((block) => /^\s*\*/m.test(block))?.split(/\n\s*user-agent:/i)[0].match(/^disallow:\s*(\S+)/gim)?.map((line) => line.replace(/^disallow:\s*/i, '').trim()) || []
    return { sitemaps, disallowed }
  } catch {
    return { sitemaps: [], disallowed: [] }
  }
}

function allowed(url: string, disallowed: string[]) {
  const pathname = new URL(url).pathname
  return !disallowed.some((rule) => rule && pathname.startsWith(rule))
}

export async function discoverProductUrls(siteUrl: string, maxProducts = DEFAULT_MAX_PRODUCTS) {
  const base = new URL(siteUrl)
  const extractor = extractorFor(siteUrl)
  const policy = await robotsPolicy(siteUrl)
  const disallowed = policy.disallowed
  const sitemapQueue = [...new Set([...policy.sitemaps, `${base.origin}/sitemap.xml`, `${base.origin}/sitemap_index.xml`])]
  const seenSitemaps = new Set<string>()
  const products = new Set<string>()
  const submitted = normalizeUrl(siteUrl)
  if (/\/products?\//i.test(base.pathname) && allowed(submitted, disallowed)) products.add(submitted)
  while (sitemapQueue.length && products.size < maxProducts && seenSitemaps.size < 50) {
    const sitemap = sitemapQueue.shift()!
    if (seenSitemaps.has(sitemap)) continue
    seenSitemaps.add(sitemap)
    try {
      const xml = await fetchText(sitemap)
      for (const location of locations(xml)) {
        const candidate = normalizeUrl(location)
        if (/<sitemap|\.xml($|\?)/i.test(candidate)) sitemapQueue.push(candidate)
        else if (new URL(candidate).hostname === base.hostname && /\/products?\//i.test(new URL(candidate).pathname) && allowed(candidate, disallowed)) products.add(candidate)
        if (products.size >= maxProducts) break
      }
    } catch {}
  }
  if (!products.size) {
    const html = await fetchText(siteUrl)
    const origin = base.origin
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      try {
        const candidate = normalizeUrl(new URL(match[1], siteUrl).toString())
        if (new URL(candidate).hostname === base.hostname && /\/products?\//i.test(new URL(candidate).pathname) && allowed(candidate, disallowed)) products.add(candidate)
      } catch {}
      if (products.size >= maxProducts) break
    }
    void origin
  }
  if (!products.size) throw new Error(`No product URLs discovered for ${extractor.id}. Check the site URL, sitemap, robots.txt, or retailer adapter.`)
  return [...products].slice(0, maxProducts)
}

async function existingSkus() {
  try {
    const registry = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8')) as { products?: CatalogProductRecord[] }
    return new Set((registry.products || []).map((product) => product.sku).filter((sku): sku is string => Boolean(sku)))
  } catch {
    return new Set<string>()
  }
}

export async function createCrawlJob(siteUrl: string, maxProducts = DEFAULT_MAX_PRODUCTS, delayMs = DEFAULT_DELAY_MS) {
  const normalized = normalizeUrl(siteUrl)
  const extractor = extractorFor(normalized)
  const now = new Date().toISOString()
  const job: CrawlJob = { id: randomUUID(), siteUrl: normalized, retailerId: extractor.id, maxProducts: Math.max(1, Math.min(500, maxProducts)), delayMs: Math.max(250, Math.min(60000, delayMs)), status: 'queued', discoveredUrls: [], items: [], currentUrl: null, error: null, createdAt: now, updatedAt: now }
  await writeJob(job)
  return job
}

async function patchJob(job: CrawlJob, patch: Partial<CrawlJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  await writeJob(job)
}

export async function cancelCrawlJob(id: string) {
  const job = await getJob(id)
  if (job.status === 'queued' || job.status === 'discovering' || job.status === 'running') await patchJob(job, { status: 'cancelled', currentUrl: null })
  return getJob(id)
}

export async function runCrawlJob(id: string) {
  if (running.has(id)) return getJob(id)
  running.add(id)
  let job = await getJob(id)
  try {
    await patchJob(job, { status: 'discovering' })
    const urls = await discoverProductUrls(job.siteUrl, job.maxProducts)
    job = await getJob(id)
    job.discoveredUrls = urls
    job.items = urls.map((url) => ({ url, status: 'queued', sku: null, productId: null, artifactRoot: null, error: null, updatedAt: new Date().toISOString() }))
    await patchJob(job, { status: 'running', discoveredUrls: urls, items: job.items })
    const knownSkus = await existingSkus()
    for (let index = 0; index < job.items.length; index += 1) {
      job = await getJob(id)
      if (job.status === 'cancelled') break
      const item = job.items[index]
      await patchJob(job, { currentUrl: item.url, items: job.items })
      item.status = 'scraping'; item.updatedAt = new Date().toISOString()
      const productRoot = path.join(JOB_ROOT, job.id, 'products', `${String(index + 1).padStart(3, '0')}-${slug(item.url)}`)
      item.artifactRoot = path.relative(process.cwd(), productRoot)
      try {
        const scrape = await runScraper({ url: item.url, artifactRoot: productRoot })
        if (!scrape.product) throw new Error('Product extraction failed; inspect the item artifacts.')
        item.sku = scrape.product.sourceProductCode
        item.productId = scrape.product.id
        if (item.sku && knownSkus.has(item.sku)) {
          item.status = 'skipped-existing'
        } else if (scrape.product.id !== 'polihome-vancouver-162638009') {
          item.status = 'needs-model-recipe'
          item.error = `Extracted product ${scrape.product.id}; no product-specific model recipe is registered yet.`
        } else {
          const model = await runModelGeneration({ productPath: scrape.productPath, artifactRoot: productRoot, publicRoot: path.join('public/catalog', scrape.product.retailerId, 'vancouver') })
          const validation = model.ok ? await runModelValidation({ productPath: scrape.productPath, artifactRoot: productRoot }) : null
          if (!model.ok || !validation?.ok) throw new Error('Model generation or exported GLB validation failed; artifacts preserved.')
          await registerCatalog({ productPath: scrape.productPath, registryPath: 'public/catalog/catalog.json', generatedSourcePath: 'src/catalog.generated.ts' })
          item.status = 'generated'
          if (item.sku) knownSkus.add(item.sku)
        }
        try { await uploadArtifactTree(productRoot, `jobs/${job.id}/products/${String(index + 1).padStart(3, '0')}-${slug(item.url)}`) }
        catch (error) { if (process.env.K_SERVICE) throw error; item.error = `Artifact upload unavailable locally: ${error instanceof Error ? error.message : String(error)}` }
      } catch (error) {
        item.status = 'failed'
        item.error = error instanceof Error ? error.message : String(error)
      }
      item.updatedAt = new Date().toISOString()
      job = await getJob(id)
      job.items[index] = item
      await patchJob(job, { items: job.items, currentUrl: null })
      if (index < job.items.length - 1) await sleep(job.delayMs)
    }
    job = await getJob(id)
    await patchJob(job, { status: job.status === 'cancelled' ? 'cancelled' : 'completed', currentUrl: null })
  } catch (error) {
    job = await getJob(id)
    await patchJob(job, { status: 'failed', currentUrl: null, error: error instanceof Error ? error.message : String(error) })
  } finally {
    running.delete(id)
  }
  return getJob(id)
}
