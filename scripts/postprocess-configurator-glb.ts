/**
 * Normalize a configurator-exported GLB for the room planner.
 *
 * - Detects implausible unit scales (e.g. GrecoStrom exports read ~10x large)
 *   and wraps the scene in a scale node.
 * - Snaps the lowest mesh point to floor Y = 0.
 *
 * Implemented as a glTF JSON edit (a wrapper node on the scene roots) so the
 * binary payload and materials are untouched.
 *
 * Usage:
 *   npx tsx scripts/postprocess-configurator-glb.ts --in raw.glb --out shared.glb [--scale 0.1]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readGlb, inspectGlb } from './validate-model'

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const input = arg('in')
const out = arg('out')
const forcedScale = arg('scale')
if (!input || !out) {
  console.error('Usage: --in <glb> --out <glb> [--scale N]')
  process.exit(1)
}

const buffer = await readFile(input)
const json = readGlb(buffer)

// Measure with the real loader so the decision uses actual mesh bounds.
const measured = await inspectGlb(buffer)
const maxDim = Math.max(measured.dimensionsCm.length, measured.dimensionsCm.depth, measured.dimensionsCm.height)

function chooseScale(maxCm: number) {
  if (forcedScale) return Number(forcedScale)
  // Configurator exports have been seen in metres and in mm-as-metres.
  // Furniture pieces are assumed to fit within 0.3m–6m on their longest axis.
  for (const factor of [1, 0.1, 0.01, 10, 100]) if (maxCm * factor >= 30 && maxCm * factor <= 600) return factor
  return 1
}
const scale = chooseScale(maxDim)
const floorY = measured.floorY
const ty = -(scale * floorY)
const tx = -(scale * measured.centerXZ[0])
const tz = -(scale * measured.centerXZ[1])

interface GltfNode { name?: string; children?: number[]; scale?: number[]; translation?: number[] }
const nodes = (json.nodes || []) as GltfNode[]
const scenes = (json.scenes || []) as Array<{ nodes: number[] }>
const sceneIndex = typeof json.scene === 'number' ? json.scene as number : 0
const roots = scenes[sceneIndex]?.nodes || []

if (scale === 1 && Math.abs(ty) < 0.001 && Math.abs(tx) < 0.001 && Math.abs(tz) < 0.001) {
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, buffer)
  console.log(JSON.stringify({ status: 'unchanged', scale, floorY, dimsCm: measured.dimensionsCm }, null, 2))
  process.exit(0)
}

const wrapper: GltfNode = { name: 'forma-normalize', children: roots, scale: [scale, scale, scale], translation: [tx, ty, tz] }
nodes.push(wrapper)
json.nodes = nodes
scenes[sceneIndex] = { ...(scenes[sceneIndex] || { nodes: [] }), nodes: [nodes.length - 1] }
json.scenes = scenes

// Rebuild the GLB: header + JSON chunk (4-byte aligned) + unchanged BIN chunk.
const jsonLength = buffer.readUInt32LE(12)
const binChunk = buffer.subarray(20 + jsonLength)
const jsonText = Buffer.from(JSON.stringify(json))
const jsonPadded = Buffer.alloc(Math.ceil(jsonText.length / 4) * 4, 32)
jsonText.copy(jsonPadded)
const rebuilt = Buffer.alloc(20 + jsonPadded.length + binChunk.length)
rebuilt.write('glTF', 0)
rebuilt.writeUInt32LE(2, 4)
rebuilt.writeUInt32LE(rebuilt.length, 8)
rebuilt.writeUInt32LE(jsonPadded.length, 12)
rebuilt.writeUInt32LE(0x4e4f534a, 16)
jsonPadded.copy(rebuilt, 20)
binChunk.copy(rebuilt, 20 + jsonPadded.length)

await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, rebuilt)
const after = await inspectGlb(rebuilt)
console.log(JSON.stringify({ status: 'normalized', scale, snappedFromY: floorY, dimsCm: after.dimensionsCm, floorY: after.floorY, polygonCount: after.polygonCount }, null, 2))
