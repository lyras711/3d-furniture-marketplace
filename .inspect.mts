import { readFile } from 'node:fs/promises'
import { inspectGlb } from './scripts/validate-model'
const file = process.argv[2]
const r = await inspectGlb(await readFile(file))
console.log('dims cm:', JSON.stringify(r.dimensionsCm), 'floorY:', r.floorY.toFixed(3), 'polys:', r.polygonCount, 'meshes:', r.components.length)
console.log('materials:', ((r.json.materials || []) as Array<{name?:string}>).map(m=>m.name).join(', ') || 'none')
console.log('first meshes:', r.components.slice(0,8).map(c=>c.name).join(', '))
