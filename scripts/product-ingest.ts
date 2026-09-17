import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runModelGeneration } from './generate-sofa'
import { registerCatalog } from './register-catalog'
import { DEFAULT_ARTIFACT_ROOT, DEFAULT_PRODUCT_URL, missingFields as missingSourceFields, runScraper } from './scrape-product'
import { runModelValidation } from './validate-model'
import type { NormalizedProduct } from './product-types'

async function readProduct(productPath: string) {
  return JSON.parse(await readFile(productPath, 'utf8')) as NormalizedProduct
}

export async function runProductIngest({ url, artifactRoot, fromExtraction }: { url: string; artifactRoot: string; fromExtraction?: string }) {
  const root = path.resolve(artifactRoot)
  const scrape = fromExtraction
    ? { ok: true, product: await readProduct(fromExtraction), productPath: path.resolve(fromExtraction), reportPath: path.join(path.dirname(path.resolve(fromExtraction)), 'extraction-report.json') }
    : await runScraper({ url, artifactRoot: root })
  if (fromExtraction && scrape.product) {
    url = scrape.product.sourceUrl
    scrape.ok = missingSourceFields(scrape.product).length === 0 && scrape.product.sourceImages.filter((image) => image.downloaded).length >= 3
  }
  const stages: Record<string, unknown>[] = [{ name: 'scrape', status: scrape.ok ? 'success' : scrape.product ? 'warning' : 'failed', report: scrape.reportPath }]
  if (!scrape.product) {
    const report = { status: 'failed', sourceUrl: url, artifactRoot: root, stages, finalReport: 'Scraping did not produce normalized product data. Intermediate scrape artifacts were preserved.' }
    await writeFile(path.join(root, 'final-report.json'), JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, report }
  }
  const model = await runModelGeneration({ productPath: scrape.productPath, artifactRoot: root, publicRoot: path.resolve('public/catalog/polihome/vancouver') })
  stages.push({ name: 'model-generation', status: model.ok ? 'success' : 'failed', report: model.reportPath })
  const validation = await runModelValidation({ productPath: scrape.productPath, artifactRoot: root })
  stages.push({ name: 'model-validation', status: validation.ok ? 'success' : 'failed', report: validation.reportPath })
  if (!model.ok || !validation.ok) {
    stages.push({ name: 'catalog-registration', status: 'blocked', reason: 'Generation or exported GLB validation failed; existing catalog preserved.' })
    const report = { status: 'failed', sourceUrl: url, artifactRoot: root, stages, visualAccuracy: 'not-approved' }
    await writeFile(path.join(root, 'final-report.json'), JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, report }
  }
  const registration = await registerCatalog({ productPath: scrape.productPath, registryPath: 'public/catalog/catalog.json', generatedSourcePath: 'src/catalog.generated.ts' })
  stages.push({ name: 'catalog-registration', status: registration.ok ? 'success' : 'warning', report: registration.registryPath })
  const product = await readProduct(scrape.productPath)
  const missingFields = [
    ['name', product.name],
    ['sourceProductCode', product.sourceProductCode],
    ['basePrice', product.basePrice],
    ['dimensionsCm.length', product.dimensionsCm.length],
    ['dimensionsCm.depth', product.dimensionsCm.cornerDepth ?? product.dimensionsCm.depth],
    ['dimensionsCm.height', product.dimensionsCm.height],
    ['variants', product.variants.length >= 1 ? product.variants : null],
    ['sourceImages', product.sourceImages.length >= 3 ? product.sourceImages : null],
  ].filter(([, value]) => value === null || value === undefined || value === '').map(([field]) => field)
  const validationResults = (Array.isArray(validation.report.results) ? validation.report.results : []) as Array<Record<string, unknown>>
  const finalReport = {
    status: scrape.ok && model.ok && validation.ok && registration.ok ? 'success' : 'warning',
    statusScope: 'Technical pipeline only; does not certify visual fidelity or hyperrealism.',
    visualAccuracy: 'pending-human-review',
    sourceUrl: url,
    artifactRoot: root,
    stages,
    extractedProduct: {
      id: product.id,
      name: product.name,
      sku: product.sourceProductCode,
      price: product.basePrice,
      currency: product.currency,
      availability: product.availabilityStatus,
      dimensionsCm: product.dimensionsCm,
      variants: product.variants.map((variant) => ({ id: variant.id, name: variant.sourceVariantName, sourceImages: variant.sourceImageUrls })),
      imageCount: product.sourceImages.length,
    },
    missingFields,
    warnings: [...new Set([...product.extractionMetadata.warnings, ...registration.records.flatMap((record) => record.verification.warnings)])],
    modelDimensions: product.modelAssets.map((asset) => {
      const result = validationResults.find((candidate) => candidate.variantId === asset.variantId)
      return { variantId: asset.variantId, sourceDimensionsCm: result?.sourceDimensionsCm, generatedDimensionsCm: asset.dimensionsCm, differencesPercent: result?.differencesPercent, validationStatus: asset.validationStatus }
    }),
    generatedFiles: {
      rawHtml: path.join(root, 'source/page.html'),
      sourceScreenshot: path.join(root, 'source/page.png'),
      imageManifest: path.join(root, 'source/image-manifest.json'),
      normalizedProduct: scrape.productPath,
      modelReport: model.reportPath,
      validationReport: validation.reportPath,
      catalogRegistry: registration.registryPath,
      generatedCatalogSource: registration.generatedSourcePath,
      models: product.modelAssets.map((asset) => ({ variantId: asset.variantId, glb: asset.publicPathOrStorageKey, thumbnail: asset.thumbnailPath })),
    },
    nextManualReviewSteps: [
      'Confirm the source dimensions and variant imagery against the retailer page.',
      'Review the approximate silhouette, materials, and corner orientation in the generated GLB.',
      'Confirm product-data and image/model usage permissions before any commercial publication.',
    ],
  }
  await writeFile(path.join(root, 'final-report.json'), JSON.stringify(finalReport, null, 2), 'utf8')
  return { ok: finalReport.status === 'success', report: finalReport }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (flag: string, fallback: string) => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
  const url = valueAfter('--url', DEFAULT_PRODUCT_URL)
  const artifactRoot = valueAfter('--out', DEFAULT_ARTIFACT_ROOT)
  const fromExtraction = valueAfter('--from-extraction', '') || undefined
  const result = await runProductIngest({ url, artifactRoot, fromExtraction })
  console.log(JSON.stringify(result.report, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
