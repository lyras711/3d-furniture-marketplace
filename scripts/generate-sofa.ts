import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { inspectGlb } from './validate-model'
import { uploadFile } from './firebase-store'
import type { ModelAsset, NormalizedProduct } from './product-types'

async function createComparison(artifactDir: string, product: NormalizedProduct, variantId: string, artifactRoot: string) {
  const variant = product.variants.find((item) => item.id === variantId)!
  const reference = product.sourceImages.find((image) => image.downloaded && image.localPath && image.role === 'gallery' && variant.sourceImageUrls.includes(image.sourceUrl))
  if (!reference?.localPath) throw new Error('No downloaded source image is associated with this variant.')
  const source = await readFile(path.resolve(artifactRoot, reference.localPath))
  const rendered = await readFile(path.join(artifactDir, 'thumbnail.png'))
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, channel: process.platform === 'darwin' ? 'chromium' : undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 1 })
    await page.setContent(`<html><body style="margin:0;background:#f5f5f2;font:16px system-ui;color:#30352f"><h1 style="padding:24px;margin:0">${product.localizedNames.en || product.name} · source / reconstruction review</h1><main style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:24px"><section><h2>Retailer reference</h2><img style="width:100%;height:460px;object-fit:contain;background:white" src="data:${reference.contentType || 'image/webp'};base64,${source.toString('base64')}" /></section><section><h2>Generated shared GLB geometry</h2><img style="width:100%;height:460px;object-fit:contain;background:white" src="data:image/png;base64,${rendered.toString('base64')}" /></section></main><p style="padding:0 24px">Human review pending. Measurements are sourced; component shapes and fabric are photo-inferred. Camera angles are not calibrated.</p></body></html>`)
    await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => (image as HTMLImageElement).decode())))
    await page.screenshot({ path: path.join(artifactDir, 'comparison.png'), fullPage: true })
  } finally {
    await browser.close()
  }
}

export interface ModelGenerationOptions {
  productPath: string
  artifactRoot: string
  publicRoot: string
  variantId?: string
}

export interface ModelGenerationResult {
  ok: boolean
  reportPath: string
  productPath: string
  product: NormalizedProduct
  report: Record<string, unknown>
}

const blenderCandidates = [process.env.BLENDER_PATH, '/Applications/Blender.app/Contents/MacOS/Blender', 'blender'].filter(Boolean) as string[]

function findBlender() {
  for (const candidate of blenderCandidates) {
    if (candidate !== 'blender' && !existsSync(candidate)) continue
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (!result.error && result.status === 0) return candidate
  }
  return null
}

function publicPrefix(publicRoot: string) {
  const absolute = path.resolve(publicRoot)
  const pieces = absolute.split(path.sep)
  const catalog = pieces.lastIndexOf('catalog')
  return catalog >= 0 ? `/${pieces.slice(catalog).join('/')}` : '/catalog/polihome/vancouver'
}

export async function runModelGeneration(options: ModelGenerationOptions): Promise<ModelGenerationResult> {
  const productPath = path.resolve(options.productPath)
  const artifactRoot = path.resolve(options.artifactRoot)
  const publicRoot = path.resolve(options.publicRoot)
  const product = JSON.parse(await readFile(productPath, 'utf8')) as NormalizedProduct
  const reportPath = path.join(artifactRoot, 'generation-report.json')
  const blender = findBlender()
  const variant = options.variantId ? product.variants.find((candidate) => candidate.id === options.variantId) : product.variants[0]
  if (!variant) {
    const report = { status: 'failed', stage: 'model-generation', error: 'No product variant was available for shared geometry generation.' }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, reportPath, productPath, product, report }
  }
  if (!blender) {
    const report = { status: 'failed', stage: 'model-generation', error: 'Blender was not found. Set BLENDER_PATH to a Blender executable.', attemptedPaths: blenderCandidates }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, reportPath, productPath, product, report }
  }
  const artifactDir = path.join(artifactRoot, 'model')
  await mkdir(artifactDir, { recursive: true })
  await mkdir(publicRoot, { recursive: true })
  await writeFile(path.join(artifactDir, 'model-reference.json'), JSON.stringify({ geometrySharedAcrossVariants: true, referenceVariantId: variant.id }, null, 2), 'utf8')
  const blenderScript = path.resolve('scripts/blender/generate-sofa.py')
  const args = ['--background', '--python-exit-code', '1', '--python', blenderScript, '--', '--product-json', productPath, '--variant-id', variant.id, '--image-dir', path.join(artifactRoot, 'source', 'images'), '--output-dir', artifactDir, '--output-name', 'shared.glb']
  const result = spawnSync(blender, args, { stdio: 'inherit', encoding: 'utf8' })
  const glbPath = path.join(artifactDir, 'shared.glb')
  const thumbnailPath = path.join(artifactDir, 'thumbnail.png')
  const metadataPath = path.join(artifactDir, 'model-metadata.json')
  if (result.status !== 0 || !existsSync(glbPath) || !existsSync(metadataPath)) {
    const report = { status: 'failed', stage: 'model-generation', error: result.error?.message || `Blender exited with status ${result.status}`, productPath }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, reportPath, productPath, product, report }
  }
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { generatedDimensionsCm: ModelAsset['dimensionsCm']; polygonCount: number; generationMethod: string; visualAccuracy?: 'pending-human-review'; materialStatus?: string; limitations?: string[] }
  const measured = await inspectGlb(await readFile(glbPath))
  const sourceDimensions = { length: product.dimensionsCm.length, depth: product.dimensionsCm.cornerDepth ?? product.dimensionsCm.depth, height: product.dimensionsCm.height }
  if (Math.abs(measured.floorY) > 0.001 || Object.entries(sourceDimensions).some(([axis, value]) => !value || Math.abs(measured.dimensionsCm[axis as keyof typeof sourceDimensions] - value) / value > 0.03)) {
    const report = { status: 'failed', stage: 'model-generation', error: 'Exported shared GLB orientation, dimensions or floor contact failed.', measured, productPath }
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    return { ok: false, reportPath, productPath, product, report }
  }
  metadata.generatedDimensionsCm = measured.dimensionsCm
  metadata.polygonCount = measured.polygonCount
  await copyFile(glbPath, path.join(publicRoot, 'shared.glb'))
  if (existsSync(thumbnailPath)) await copyFile(thumbnailPath, path.join(publicRoot, 'thumbnail.png'))
  const localPublicPath = `${publicPrefix(publicRoot)}/shared.glb`
  const localThumbnail = existsSync(thumbnailPath) ? `${publicPrefix(publicRoot)}/thumbnail.png` : null
  let publicPath = localPublicPath
  let publicThumbnail = localThumbnail
  try {
    publicPath = await uploadFile(glbPath, `catalog/${product.id}/shared.glb`)
    if (existsSync(thumbnailPath)) publicThumbnail = await uploadFile(thumbnailPath, `catalog/${product.id}/thumbnail.png`)
  } catch (error) {
    if (process.env.K_SERVICE) throw new Error(`Firebase Storage upload failed: ${error instanceof Error ? error.message : String(error)}`)
    console.warn(`Firebase Storage unavailable; using local public paths: ${error instanceof Error ? error.message : String(error)}`)
  }
  const asset: ModelAsset = {
    id: `model-${product.id}`,
    productId: product.id,
    variantId: null,
    format: 'glb',
    localPath: 'model/shared.glb',
    publicPathOrStorageKey: publicPath,
    thumbnailPath: publicThumbnail,
    dimensionsCm: measured.dimensionsCm,
    polygonCount: measured.polygonCount,
    generationMethod: metadata.generationMethod,
    visualAccuracy: metadata.visualAccuracy,
    materialStatus: metadata.materialStatus,
    generationWarnings: metadata.limitations,
    generationStatus: 'generated',
    validationStatus: 'pending',
    createdAt: new Date().toISOString(),
  }
  product.modelAssets = [asset]
  product.variants.forEach((item) => { item.modelAssetId = asset.id; item.materialReference = metadata.materialStatus || 'generated material; review required' })
  product.updatedAt = new Date().toISOString()
  await writeFile(`${productPath}.pending`, JSON.stringify(product, null, 2), 'utf8')
  await rename(`${productPath}.pending`, productPath)
  await createComparison(artifactDir, product, variant.id, artifactRoot)
  const report = { status: 'success', stage: 'model-generation', blender, geometrySharedAcrossVariants: true, stages: [{ variantIds: product.variants.map((item) => item.id), status: 'generated', glbPath, thumbnailPath, publicPath, metadata, comparisonPath: path.join(artifactDir, 'comparison.png'), visualReview: 'pending' }], assets: [asset], productPath }
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  return { ok: true, reportPath, productPath, product, report }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (flag: string, fallback = '') => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
  const productPath = valueAfter('--product', 'artifacts/products/polihome/vancouver/product.json')
  const artifactRoot = valueAfter('--out', path.dirname(productPath))
  const publicRoot = valueAfter('--public', 'public/catalog/polihome/vancouver')
  const variantId = valueAfter('--variant') || undefined
  const recovery = valueAfter('--recover-from')
  if (recovery) {
    if (existsSync(productPath) && (await readFile(productPath, 'utf8')).trim()) throw new Error('Recovery only replaces an empty or missing generated product file.')
    const snapshot = await readFile(recovery, 'utf8')
    const parsed = JSON.parse(snapshot) as NormalizedProduct
    if (!parsed.id || !parsed.sourceUrl || !Array.isArray(parsed.variants) || !parsed.dimensionsCm) throw new Error('Recovery snapshot is not a normalized product.')
    await writeFile(`${productPath}.pending`, snapshot, 'utf8')
    await rename(`${productPath}.pending`, productPath)
  }
  const result = await runModelGeneration({ productPath, artifactRoot, publicRoot, variantId })
  console.log(JSON.stringify(result.report, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
