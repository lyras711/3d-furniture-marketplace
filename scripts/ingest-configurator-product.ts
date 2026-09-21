/**
 * Ingest one product from a retailer with an Exact3D/ExactADV configurator.
 *
 * Pipeline: WooCommerce scrape → Unity GLB export → postprocess (unit scale,
 * floor snap, XZ centering) → optional measured-dim fill → public Storage
 * upload → dimension validation → catalog registration.
 *
 * Usage:
 *   npx tsx scripts/ingest-configurator-product.ts \
 *     --product-url "https://www.homad.eu/product/canova/" \
 *     --configurator-url "https://configurator.homad.eu/?model=kan_canova" \
 *     --retailer homad --brand HOMAD --group Seating --category "Modular sofa" \
 *     --root artifacts/products/homad/canova
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { uploadFile } from './firebase-store'
import { runModelValidation } from './validate-model'
import { registerCatalog } from './register-catalog'
import type { ModelAsset, NormalizedProduct } from './product-types'

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const productUrl = arg('product-url')
const configuratorUrl = arg('configurator-url')
const retailer = arg('retailer')
const brand = arg('brand') || ''
const group = arg('group') || 'Seating'
const category = arg('category') || 'Other'
const skipUpload = process.argv.includes('--skip-upload')

if (!productUrl || !configuratorUrl || !retailer) {
  console.error('Usage: --product-url <page> --configurator-url <url> --retailer <id> [--brand X] [--group Y] [--category Z] [--root dir] [--skip-upload]')
  process.exit(1)
}

const slug = new URL(productUrl).pathname.split('/').filter(Boolean).pop() || 'product'
const root = path.resolve(arg('root') || path.join('artifacts/products', retailer, slug))
const tsx = (script: string, args: string[]) => execFileSync('npx', ['tsx', script, ...args], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

console.log(`[1/6] Scraping ${productUrl}`)
tsx('scripts/scrape-woocommerce-product.ts', ['--url', productUrl, '--retailer', retailer, '--brand', brand, '--category', category, '--group', group, '--out', path.join(root, 'product.json')])

console.log(`[2/6] Exporting configurator GLB`)
tsx('scripts/export-configurator-model.ts', ['--url', configuratorUrl, '--out', path.join(root, 'model', 'raw-export.glb')])

console.log(`[3/6] Postprocessing (units, floor snap, centering)`)
const post = JSON.parse(tsx('scripts/postprocess-configurator-glb.ts', ['--in', path.join(root, 'model', 'raw-export.glb'), '--out', path.join(root, 'model', 'shared.glb')])) as { dimsCm: { length: number; depth: number; height: number }; polygonCount?: number; scale?: number }

console.log(`[4/6] Normalizing product record`)
const productPath = path.join(root, 'product.json')
const product = JSON.parse(await readFile(productPath, 'utf8')) as NormalizedProduct
const measured = { length: Math.round(post.dimsCm.length), depth: Math.round(post.dimsCm.depth), height: Math.round(post.dimsCm.height) }
if (!product.dimensionsCm.length || !product.dimensionsCm.depth || !product.dimensionsCm.height) {
  product.dimensionsCm.length = measured.length
  product.dimensionsCm.depth = measured.depth
  product.dimensionsCm.height = measured.height
  product.extractionMetadata.warnings.push('Product dimensions were measured from the retailer 3D model, not product specifications.')
}

let modelUrl = `catalog/${product.id}/shared.glb`
let thumbnailUrl: string | null = null
const hero = product.sourceImages.find((image) => image.role === 'hero' && image.sourceUrl) || product.sourceImages[0]
if (hero?.sourceUrl) {
  const response = await fetch(hero.sourceUrl)
  if (response.ok) {
    const ext = path.extname(new URL(hero.sourceUrl).pathname) || '.jpg'
    const thumbPath = path.join(root, 'model', `thumbnail${ext}`)
    await mkdir(path.dirname(thumbPath), { recursive: true })
    await writeFile(thumbPath, Buffer.from(await response.arrayBuffer()))
    if (!skipUpload) thumbnailUrl = await uploadFile(thumbPath, `catalog/${product.id}/thumbnail${ext}`, { public: true })
    else thumbnailUrl = thumbPath
  }
}
if (!skipUpload) modelUrl = await uploadFile(path.join(root, 'model', 'shared.glb'), `catalog/${product.id}/shared.glb`, { public: true })

const now = new Date().toISOString()
const asset: ModelAsset = {
  id: `${product.id}-shared`,
  productId: product.id,
  variantId: null,
  format: 'glb',
  localPath: 'model/shared.glb',
  publicPathOrStorageKey: modelUrl,
  thumbnailPath: thumbnailUrl,
  dimensionsCm: measured,
  polygonCount: post.polygonCount ?? null,
  generationMethod: `retailer-configurator-export (${new URL(configuratorUrl).hostname})`,
  visualAccuracy: 'pending-human-review',
  generationWarnings: ['Retailer configurator export; visual fidelity is the retailer\'s own approximation, not verified against the physical product.'],
  generationStatus: 'generated',
  validationStatus: 'pending',
  createdAt: now,
}
product.modelAssets = [asset]
product.updatedAt = now
await writeFile(productPath, JSON.stringify(product, null, 2), 'utf8')

console.log(`[5/6] Validating exported model`)
const validation = await runModelValidation({ productPath, artifactRoot: root })
if (!validation.ok) {
  console.error('Validation failed; catalog registration skipped. Artifacts preserved.')
  process.exit(1)
}

console.log(`[6/6] Registering catalog entry`)
const registration = await registerCatalog({ productPath, registryPath: 'public/catalog/catalog.json', generatedSourcePath: 'src/catalog.generated.ts' })
console.log(JSON.stringify(registration.report, null, 2))
