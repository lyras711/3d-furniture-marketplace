import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { firebaseStore } from './firebase-store'
import type { CatalogProductRecord, NormalizedProduct } from './product-types'

export interface CatalogRegistrationOptions {
  productPath: string
  registryPath: string
  generatedSourcePath: string
}

export interface CatalogRegistrationResult {
  ok: boolean
  registryPath: string
  generatedSourcePath: string
  records: CatalogProductRecord[]
  report: Record<string, unknown>
}

function colorFor(variantId: string) {
  return variantId.endsWith('light') ? { tone: '#b8b7b3', accent: '#85837d' } : { tone: '#505256', accent: '#292b2e' }
}

function toCatalogRecord(product: NormalizedProduct): CatalogProductRecord {
  const length = product.dimensionsCm.length
  const depth = product.dimensionsCm.cornerDepth ?? product.dimensionsCm.depth
  const height = product.dimensionsCm.height
  const sharedAsset = product.modelAssets.find((asset) => asset.variantId === null) || product.modelAssets[0]
  const variants = product.variants.map((variant) => {
    const color = colorFor(variant.id)
    return {
      id: variant.id.replace(/^vancouver-/, ''),
      name: variant.normalizedVariantName,
      sourceVariantName: variant.sourceVariantName,
      colorName: variant.colorName,
      tone: color.tone,
      accent: color.accent,
      modelPath: sharedAsset?.publicPathOrStorageKey || null,
      thumbnailPath: sharedAsset?.thumbnailPath || null,
      materialReference: variant.materialReference,
      sourceAvailability: variant.sourceAvailability,
    }
  })
  const selectedColor = colorFor(product.variants[0]?.id || 'dark')
  const warnings = [...new Set([...product.extractionMetadata.warnings, ...product.modelAssets.flatMap((asset) => asset.generationWarnings || []), 'Visual likeness and generated fabric await human review; dimension validation does not verify appearance.'])]
  if (length === null || depth === null || height === null) warnings.push('Catalog footprint is incomplete because a required source dimension is missing.')
  if (!product.modelAssets.length || product.modelAssets.some((asset) => asset.generationStatus !== 'generated')) warnings.push('One or more generated model assets are unavailable.')
  const modelComplete = product.modelAssets.some((asset) => asset.variantId === null && asset.generationStatus === 'generated')
  const dimensionsValidated = modelComplete && product.modelAssets.some((asset) => asset.variantId === null && asset.validationStatus === 'validated')
  return {
    id: product.id,
    retailerId: product.retailerId,
    retailerName: 'Polihome',
    retailer: 'Polihome',
    sourceUrl: product.sourceUrl,
    sku: product.sourceProductCode,
    name: product.localizedNames.en || product.name || 'Vancouver corner sofa',
    localizedNames: product.localizedNames,
    brand: product.brand || 'Unknown brand',
    group: 'Seating',
    category: 'Corner sofa',
    width: length ?? 0,
    depth: depth ?? 0,
    height: height ?? 0,
    cornerDepth: product.dimensionsCm.cornerDepth,
    seatHeight: product.dimensionsCm.seatHeight,
    feetHeight: product.dimensionsCm.feetHeight,
    price: product.basePrice ?? null,
    currency: product.currency || 'EUR',
    tone: selectedColor.tone,
    accent: selectedColor.accent,
    status: warnings.length ? `Source extracted · ${warnings.length} review warning${warnings.length === 1 ? '' : 's'}` : 'Source extracted · model dimensions validated',
    thumbnailPath: sharedAsset?.thumbnailPath || null,
    modelPath: sharedAsset?.publicPathOrStorageKey || null,
    variants,
    sourceImages: product.sourceImages.filter((image) => image.downloaded && image.localPath).map((image) => image.localPath!),
    verification: {
      productData: product.extractionMetadata.warnings.length ? 'partial' : 'extracted',
      model: modelComplete ? 'generated' : 'pending',
      dimensions: dimensionsValidated ? 'validated' : 'pending',
      generatedAsset: modelComplete ? 'approximate' : 'failed',
      humanReview: 'pending',
      warnings,
    },
  }
}

export async function registerCatalog(options: CatalogRegistrationOptions): Promise<CatalogRegistrationResult> {
  const product = JSON.parse(await readFile(path.resolve(options.productPath), 'utf8')) as NormalizedProduct
  if (!product.variants.length || !product.modelAssets.some((asset) => asset.variantId === null && asset.generationStatus === 'generated' && asset.validationStatus === 'validated')) throw new Error('Catalog registration requires one dimension-validated shared GLB. Existing catalog was preserved.')
  const root = path.dirname(path.resolve(options.productPath))
  for (const asset of product.modelAssets) {
    const file = path.resolve(root, asset.localPath)
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Model asset must be inside the product artifact directory.')
    const revision = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 12)
    const versioned = (url: string) => `${url}${url.includes('?') ? '&' : '?'}v=${revision}`
    asset.publicPathOrStorageKey = versioned(asset.publicPathOrStorageKey)
    if (asset.thumbnailPath) asset.thumbnailPath = versioned(asset.thumbnailPath)
  }
  const record = toCatalogRecord(product)
  const registryPath = path.resolve(options.registryPath)
  const generatedSourcePath = path.resolve(options.generatedSourcePath)
  let existing: CatalogProductRecord[] = []
  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as { products?: CatalogProductRecord[] }
    existing = Array.isArray(parsed.products) ? parsed.products : []
  } catch {}
  const products = [...existing.filter((item) => item.id !== record.id && item.sku !== record.sku), record]
  const registry = { generatedAt: new Date().toISOString(), sourceProductPath: path.relative(process.cwd(), path.resolve(options.productPath)), products }
  await writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8')
  const source = `import type { Product } from './catalog'\n\nexport const generatedProducts: Product[] = ${JSON.stringify(products, null, 2)}\n`
  await writeFile(generatedSourcePath, source, 'utf8')
  try { await firebaseStore().db.collection('catalogProducts').doc(record.id).set({ ...record, updatedAt: new Date().toISOString() }, { merge: true }) }
  catch (error) { if (process.env.K_SERVICE) throw error; console.warn(`Firestore catalog persistence unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  const report = { status: record.verification.model === 'generated' ? 'success' : 'warning', stage: 'catalog-registration', registryPath, generatedSourcePath, productId: record.id, warnings: record.verification.warnings, productCount: products.length }
  return { ok: report.status === 'success', registryPath, generatedSourcePath, records: [record], report }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (flag: string, fallback: string) => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
  const productPath = valueAfter('--product', 'artifacts/products/polihome/vancouver/product.json')
  const registryPath = valueAfter('--registry', 'public/catalog/catalog.json')
  const generatedSourcePath = valueAfter('--source', 'src/catalog.generated.ts')
  const result = await registerCatalog({ productPath, registryPath, generatedSourcePath })
  console.log(JSON.stringify(result.report, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
