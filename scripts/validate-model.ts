import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { NormalizedProduct } from './product-types'

export interface ModelValidationOptions {
  productPath: string
  artifactRoot: string
  variantId?: string
}

export interface ModelValidationResult {
  ok: boolean
  reportPath: string
  productPath: string
  product: NormalizedProduct
  report: Record<string, unknown>
}

export function readGlb(buffer: Buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB magic header.')
  const version = buffer.readUInt32LE(4)
  const declaredLength = buffer.readUInt32LE(8)
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}.`)
  if (declaredLength !== buffer.length) throw new Error('GLB byte length does not match its header.')
  let offset = 12
  let json: Record<string, unknown> | null = null
  while (offset + 8 <= declaredLength) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    if (chunkLength % 4 || offset + 8 + chunkLength > declaredLength) throw new Error('GLB chunk is truncated or unaligned.')
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength)
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/\u0000+$/g, ' ').trim())
    offset += 8 + chunkLength
  }
  if (!json) throw new Error('GLB JSON chunk is missing.')
  return json
}

export async function inspectGlb(buffer: Buffer) {
  const json = readGlb(buffer)
  const geometryJson = structuredClone(json)
  delete geometryJson.images
  delete geometryJson.textures
  delete geometryJson.materials
  for (const mesh of (geometryJson.meshes || []) as Array<{ primitives: Array<{ material?: number }> }>) for (const primitive of mesh.primitives) delete primitive.material
  if (((geometryJson.buffers || []) as Array<{ uri?: string }>).some((entry) => entry.uri)) throw new Error('Expected a self-contained GLB, not external buffers.')
  const text = Buffer.from(JSON.stringify(geometryJson))
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32)
  text.copy(padded)
  const originalJsonLength = buffer.readUInt32LE(12)
  const binaryChunks = buffer.subarray(20 + originalJsonLength)
  const rebuilt = Buffer.alloc(20 + padded.length + binaryChunks.length)
  rebuilt.write('glTF', 0)
  rebuilt.writeUInt32LE(2, 4)
  rebuilt.writeUInt32LE(rebuilt.length, 8)
  rebuilt.writeUInt32LE(padded.length, 12)
  rebuilt.writeUInt32LE(0x4e4f534a, 16)
  padded.copy(rebuilt, 20)
  binaryChunks.copy(rebuilt, 20 + padded.length)
  const { scene } = await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset, rebuilt.byteOffset + rebuilt.byteLength), '')
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene, true)
  const size = box.getSize(new Vector3())
  if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) throw new Error('GLB has no finite mesh bounds.')
  let polygonCount = 0
  const components: Array<{ name: string; min: number[]; max: number[] }> = []
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    polygonCount += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3
    const bounds = new Box3().setFromObject(object, true)
    components.push({ name: object.name, min: bounds.min.toArray(), max: bounds.max.toArray() })
    object.geometry.dispose()
  })
  return { json, dimensionsCm: { length: size.x * 100, height: size.y * 100, depth: size.z * 100 }, floorY: box.min.y, centerXZ: [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2], polygonCount, components }
}

function difference(actual: number | null, expected: number | null) {
  if (actual === null || expected === null || expected === 0) return null
  return Math.abs(actual - expected) / expected * 100
}

export async function runModelValidation(options: ModelValidationOptions): Promise<ModelValidationResult> {
  const productPath = path.resolve(options.productPath)
  const artifactRoot = path.resolve(options.artifactRoot)
  const product = JSON.parse(await readFile(productPath, 'utf8')) as NormalizedProduct
  const model = product.modelAssets.find((asset) => asset.variantId === null) || product.modelAssets[0]
  const modelPath = path.join(artifactRoot, 'model', 'shared.glb')
  const validationPath = path.join(artifactRoot, 'model', 'validation.json')
  const source = product.dimensionsCm
  const result: Record<string, unknown> = { variantIds: product.variants.map((variant) => variant.id), modelPath, status: 'failed', sourceDimensionsCm: { length: source.length, depth: source.cornerDepth ?? source.depth, height: source.height }, differencesPercent: {}, warnings: [] }
  try {
    if (!model || !existsSync(modelPath)) throw new Error('Shared GLB file does not exist.')
    const measured = await inspectGlb(await readFile(modelPath))
    const gltf = measured.json
    const sourceDimensions = { length: source.length, depth: source.cornerDepth ?? source.depth, height: source.height }
    if (![source.length, source.cornerDepth ?? source.depth, source.height].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Error('Required source dimensions are missing or invalid.')
    if (Math.abs(measured.floorY) > 0.001) throw new Error(`GLB floor contact failed: Y=${measured.floorY} m.`)
    if (measured.centerXZ.some((value) => Math.abs(value) > 0.005)) throw new Error('GLB footprint is not centered on its placement origin.')
    const differences = { length: difference(measured.dimensionsCm.length, source.length), depth: difference(measured.dimensionsCm.depth, source.cornerDepth ?? source.depth), height: difference(measured.dimensionsCm.height, source.height) }
    const failedDimensions = Object.entries(differences).filter(([, value]) => value !== null && value > 3).map(([field, value]) => `${field} differs by ${Number(value).toFixed(2)}%`)
    const materials = Array.isArray(gltf.materials) ? gltf.materials.map((material) => (material as Record<string, unknown>).name).filter((name): name is string => typeof name === 'string') : []
    result.status = failedDimensions.length ? 'failed' : 'validated'
    result.measurementSource = 'exported GLB vertices and node transforms via Three.js GLTFLoader'
    result.generatedDimensionsCm = measured.dimensionsCm
    result.differencesPercent = differences
    result.floorY = measured.floorY
    result.centerXZ = measured.centerXZ
    result.components = measured.components
    result.polygonCount = measured.polygonCount
    result.materials = materials
    result.visualAccuracy = model?.visualAccuracy || 'pending-human-review'
    result.requiredMaterialsPresent = ['Vancouver_Upholstery', 'Vancouver_Cushion_Fabric', 'Vancouver_Plastic_Feet'].every((name) => materials.some((material) => material.includes(name)))
    if (!result.requiredMaterialsPresent) (result.warnings as string[]).push('One or more named material groups are missing from the exported GLB.')
    ;(result.warnings as string[]).push(...failedDimensions)
    if (model) {
      model.validationStatus = result.status === 'validated' ? 'validated' : 'failed'
      model.dimensionsCm = measured.dimensionsCm
      model.polygonCount = measured.polygonCount
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    if (model) model.validationStatus = 'failed'
  }
  await mkdir(path.dirname(validationPath), { recursive: true })
  await writeFile(validationPath, JSON.stringify(result, null, 2), 'utf8')
  const ok = result.status === 'validated'
  product.updatedAt = new Date().toISOString()
  product.validationStatus = ok ? 'source-extracted' : 'warnings'
  await writeFile(`${productPath}.pending`, JSON.stringify(product, null, 2), 'utf8')
  await rename(`${productPath}.pending`, productPath)
  const reportPath = path.join(artifactRoot, 'validation-report.json')
  const report = { status: ok ? 'success' : 'failed', stage: 'model-validation', results: [result], productPath }
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  return { ok, reportPath, productPath, product, report }
}

async function main() {
  const args = process.argv.slice(2)
  const valueAfter = (flag: string, fallback = '') => { const index = args.indexOf(flag); return index >= 0 && args[index + 1] ? args[index + 1] : fallback }
  const productPath = valueAfter('--product', 'artifacts/products/polihome/vancouver/product.json')
  const artifactRoot = valueAfter('--out', path.dirname(productPath))
  const variantId = valueAfter('--variant') || undefined
  const result = await runModelValidation({ productPath, artifactRoot, variantId })
  console.log(JSON.stringify(result.report, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
