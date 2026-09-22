import { attachOpening, clamp, emptyProject, isProject, wallFromPoints, type Point, type ProjectState } from './editor'

export type PixelPoint = { x: number; y: number }
type PixelBounds = { minX: number; minY: number; maxX: number; maxY: number }
export type PixelWall = { a: PixelPoint; b: PixelPoint; horizontal: boolean; thickness: number }
export type PixelOpening = PixelWall & { type: 'door' | 'window' | 'unconfirmed' | 'ignore'; suggestedType?: 'door' | 'window' }
type Band = { coordinate: number; last: number; start: number; end: number }

export type PlanAnalysis = {
  previewUrl: string
  sourceWidth: number
  sourceHeight: number
  pageCount: number
  bounds: PixelBounds
  walls: PixelWall[]
  openings: PixelOpening[]
  warnings: string[]
}

async function fileCanvas(file: File) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a drawing smaller than 25 MB.')
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    try {
      const pdf = await task.promise, page = await pdf.getPage(1), base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 1800 / base.width, 1400 / base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport }).promise
      return { canvas, pageCount: pdf.numPages }
    } finally { await task.destroy() }
  }
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) throw new Error('Choose a PNG, JPG, WebP, SVG, or PDF drawing.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 1800 / image.naturalWidth, 1400 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { canvas, pageCount: 1 }
  } finally { URL.revokeObjectURL(url) }
}

const along = (wall: PixelWall, p: PixelPoint) => wall.horizontal ? p.x : p.y
const across = (wall: PixelWall) => wall.horizontal ? wall.a.y : wall.a.x
const length = (wall: PixelWall) => along(wall, wall.b) - along(wall, wall.a)
const point = (horizontal: boolean, coordinate: number, value: number): PixelPoint => horizontal ? { x: value, y: coordinate } : { x: coordinate, y: value }
const segment = (horizontal: boolean, coordinate: number, start: number, end: number, thickness: number): PixelWall => ({ a: point(horizontal, coordinate, start), b: point(horizontal, coordinate, end), horizontal, thickness })

function extractBands(mask: Uint8Array, width: number, height: number, horizontal: boolean, minThickness = 4): PixelWall[] {
  const span = horizontal ? width : height, rows = horizontal ? height : width
  const bands: Band[] = []
  let active: Band[] = []
  for (let row = 0; row < rows; row++) {
    const next: Band[] = []
    let start = -1
    for (let col = 0; col <= span; col++) {
      const ink = col < span && mask[horizontal ? row * width + col : col * width + row]
      if (ink && start < 0) start = col
      if ((!ink || col === span) && start >= 0) {
        const end = col - 1
        if (end - start >= 12) {
          const existing = active.find((band) => Math.abs(band.start - start) <= 2 && Math.abs(band.end - end) <= 2 && !next.includes(band))
          const band = existing || { coordinate: row, last: row, start, end }
          band.last = row
          next.push(band)
        }
        start = -1
      }
    }
    bands.push(...active.filter((band) => !next.includes(band)))
    active = next
  }
  bands.push(...active)
  return bands.filter((band) => {
    const thickness = band.last - band.coordinate + 1
    return thickness >= minThickness && thickness <= Math.max(40, Math.min(width, height) * 0.06) && band.end - band.start >= Math.max(12, thickness * 1.25)
  }).map((band) => segment(horizontal, (band.coordinate + band.last) / 2, band.start, band.end, band.last - band.coordinate + 1))
}

function joinSolidBands(walls: PixelWall[]) {
  const result: PixelWall[] = []
  for (const wall of walls.sort((a, b) => b.thickness - a.thickness)) {
    const existing = result.find((other) => other.horizontal === wall.horizontal && Math.min(other.thickness, wall.thickness) / Math.max(other.thickness, wall.thickness) >= 0.65 && Math.abs(across(other) - across(wall)) <= (other.thickness + wall.thickness) / 2 && along(wall, wall.a) <= along(other, other.b) + 2 && along(wall, wall.b) >= along(other, other.a) - 2)
    if (existing) {
      const start = Math.min(along(existing, existing.a), along(wall, wall.a)), end = Math.max(along(existing, existing.b), along(wall, wall.b))
      existing.a = point(existing.horizontal, across(existing), start); existing.b = point(existing.horizontal, across(existing), end)
    } else result.push({ ...wall })
  }
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    const a = result[i], b = result[j]
    if (a.horizontal !== b.horizontal || Math.min(a.thickness, b.thickness) / Math.max(a.thickness, b.thickness) < 0.65 || Math.abs(across(a) - across(b)) > (a.thickness + b.thickness) / 2 || along(a, a.a) > along(b, b.b) + 2 || along(a, a.b) < along(b, b.a) - 2) continue
    result[i] = segment(a.horizontal, across(a), Math.min(along(a, a.a), along(b, b.a)), Math.max(along(a, a.b), along(b, b.b)), Math.max(a.thickness, b.thickness))
    result.splice(j, 1)
    j = i
  }
  for (const wall of result) {
    for (const end of ['a', 'b'] as const) {
      const candidates = result.filter((other) => other.horizontal !== wall.horizontal).map((other) => ({ other, intersection: point(wall.horizontal, across(wall), across(other)) })).filter(({ other, intersection }) => {
        const value = along(other, intersection)
        return value >= along(other, other.a) - wall.thickness / 2 - 2 && value <= along(other, other.b) + wall.thickness / 2 + 2 && Math.abs(along(wall, intersection) - along(wall, wall[end])) <= (other.thickness + wall.thickness) / 2 + 2
      }).sort((a, b) => Math.abs(along(wall, a.intersection) - along(wall, wall[end])) - Math.abs(along(wall, b.intersection) - along(wall, wall[end])))
      if (candidates[0]) wall[end] = candidates[0].intersection
    }
  }
  return result.filter((wall) => length(wall) >= 8)
}

function openingEvidence(gap: PixelWall, gray: Uint8Array, width: number, height: number): PixelOpening['type'] {
  const start = along(gap, gap.a), end = along(gap, gap.b), coordinate = across(gap), size = end - start
  const ink = (a: number, c: number) => {
    const p = point(gap.horizontal, c, a), x = Math.round(p.x), y = Math.round(p.y)
    return x >= 0 && x < width && y >= 0 && y < height && gray[y * width + x] < 247
  }
  let parallelLines = 0, inLine = false
  for (let c = Math.floor(coordinate - gap.thickness / 2 - 3); c <= coordinate + gap.thickness / 2 + 3; c++) {
    let count = 0
    for (let a = start + size * 0.12; a < end - size * 0.12; a++) if (ink(a, c)) count++
    const line = count / (size * 0.76) > 0.75
    if (line && !inLine) parallelLines++
    inLine = line
  }
  for (const inset of [0, gap.thickness / 3]) for (const hinge of [start + inset, end - inset]) for (const side of [-1, 1]) for (const radius of [size - inset * 2, (size - inset * 2) / 2]) for (const face of [-gap.thickness / 2, 0, gap.thickness / 2]) {
    let hits = 0
    for (let i = 2; i < 18; i++) {
      const angle = i / 20 * Math.PI / 2, a = hinge + (hinge < (start + end) / 2 ? 1 : -1) * radius * Math.cos(angle), c = coordinate + face + side * radius * Math.sin(angle)
      if ([-1, 0, 1].some((delta) => ink(a, c + delta))) hits++
    }
    if (hits >= 14) return 'door'
  }
  return parallelLines >= 2 ? 'window' : 'unconfirmed'
}

export function analyzePlanPixels(image: Pick<ImageData, 'data' | 'width' | 'height'>): Pick<PlanAnalysis, 'walls' | 'openings' | 'bounds' | 'warnings'> {
  const { width, height, data } = image, mask = new Uint8Array(width * height), gray = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4, alpha = data[p + 3] / 255
    gray[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) * alpha + 255 * (1 - alpha)
    mask[i] = gray[i] < 210 ? 1 : 0
  }
  const solid = new Uint8Array(mask.length)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let neighbours = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighbours += mask[(y + dy) * width + x + dx]
    solid[y * width + x] = neighbours >= 5 ? 1 : 0
  }
  const strong = joinSolidBands([...extractBands(solid, width, height, true), ...extractBands(solid, width, height, false)])
  const faint = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) faint[i] = gray[i] < 242 ? 1 : 0
  const thin = [...extractBands(faint, width, height, true, 2), ...extractBands(faint, width, height, false, 2)].filter((wall) => {
    if (length(wall) < Math.max(30, Math.min(width, height) * 0.06)) return false
    if (strong.some((other) => other.horizontal === wall.horizontal && Math.abs(across(other) - across(wall)) <= (other.thickness + wall.thickness) / 2 && along(other, other.a) <= along(wall, wall.a) + 3 && along(other, other.b) >= along(wall, wall.b) - 3)) return false
    return [wall.a, wall.b].every((end) => strong.some((other) => {
      const value = clamp(along(other, end), along(other, other.a), along(other, other.b)), nearest = point(other.horizontal, across(other), value)
      return Math.hypot(end.x - nearest.x, end.y - nearest.y) <= (wall.thickness + other.thickness) / 2 + 3
    }))
  })
  const bands = joinSolidBands([...strong, ...thin])
  const walls = bands.filter((wall) => !bands.some((other) => other.horizontal !== wall.horizontal && length(wall) < other.thickness * 3 && Math.abs((along(wall, wall.a) + along(wall, wall.b)) / 2 - across(other)) < other.thickness / 2 && across(wall) > along(other, other.a) + other.thickness && across(wall) < along(other, other.b) - other.thickness))
  if (!walls.length) throw new Error('No solid wall bands detected. Use a clearer, axis-aligned plan with filled walls. No replacement room has been generated.')
  if (walls.length > 120) throw new Error('Too many wall candidates. Crop the drawing to one floor and remove legends before importing.')
  const openings: PixelOpening[] = []
  for (const wall of walls) for (const direction of [-1, 1]) {
    const end = direction === 1 ? along(wall, wall.b) : along(wall, wall.a)
    const supports = walls.filter((other) => other !== wall).flatMap((other) => {
      if (other.horizontal === wall.horizontal) return Math.abs(across(other) - across(wall)) <= Math.min(wall.thickness, other.thickness) / 2 + 1 ? [direction === 1 ? along(other, other.a) : along(other, other.b)] : []
      return across(wall) >= along(other, other.a) - 2 && across(wall) <= along(other, other.b) + 2 ? [across(other)] : []
    }).filter((value) => (value - end) * direction > 5).sort((a, b) => Math.abs(a - end) - Math.abs(b - end))
    if (!supports.length) continue
    const gap = segment(wall.horizontal, across(wall), Math.min(end, supports[0]), Math.max(end, supports[0]), wall.thickness)
    if (length(gap) > Math.min(width, height) * 0.3 || length(gap) < Math.max(8, wall.thickness * 1.5)) continue
    if (openings.some((other) => other.horizontal === gap.horizontal && Math.abs(across(other) - across(gap)) < gap.thickness && Math.abs(along(other, other.a) - along(gap, gap.a)) < 3 && Math.abs(along(other, other.b) - along(gap, gap.b)) < 3)) continue
    if (walls.some((other) => other.horizontal === gap.horizontal && Math.abs(across(other) - across(gap)) < gap.thickness && along(other, other.a) < along(gap, gap.b) - 5 && along(other, other.b) > along(gap, gap.a) + 5)) continue
    const evidence = openingEvidence(gap, gray, width, height)
    openings.push({ ...gap, type: 'unconfirmed', suggestedType: evidence === 'door' || evidence === 'window' ? evidence : undefined })
  }
  const points = walls.flatMap((wall) => [wall.a, wall.b])
  const bounds = { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) }
  return { walls, openings, bounds, warnings: ['WIP: import the detected result as-is, or optionally adjust the overlay. Thin, faint partitions are recovered when connected to detected walls; diagonal and outline-only walls can still be missed.', 'Suggested doors/windows are used automatically. Gaps without a suggestion stay open. Tiny fragments are skipped, and openings are fitted to their supporting walls.', 'Enter the measured width between the dashed guides. Wall thickness is estimated from pixels at that scale (supported range 2–200 cm). Heights and sills use defaults. Furniture is excluded.'] }
}

export async function analyzePlanFile(file: File): Promise<PlanAnalysis> {
  const { canvas, pageCount } = await fileCanvas(file)
  const result = analyzePlanPixels(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height))
  return { ...result, previewUrl: canvas.toDataURL('image/png'), sourceWidth: canvas.width, sourceHeight: canvas.height, pageCount, warnings: [...result.warnings, ...(pageCount > 1 ? ['Only the first PDF page was analyzed.'] : [])] }
}

export function createProjectFromPlan(analysis: PlanAnalysis, realWidth: number, name: string): ProjectState {
  const planWidth = analysis.bounds.maxX - analysis.bounds.minX, planHeight = analysis.bounds.maxY - analysis.bounds.minY
  if (!Number.isFinite(realWidth) || realWidth < 2 || realWidth > 38 || planWidth <= 0 || planHeight <= 0) throw new Error('Enter a measured plan width between 2 and 38 metres.')
  if (!analysis.walls.length || [...analysis.walls, ...analysis.openings].some((wall) => ![wall.a.x, wall.a.y, wall.b.x, wall.b.y, wall.thickness].every(Number.isFinite) || length(wall) < 8)) throw new Error('Every segment needs ordered endpoints at least 8 pixels apart.')
  const scale = realWidth / planWidth, project = emptyProject(name || 'Imported plan')
  if (planHeight * scale > 38) throw new Error('The scaled drawing exceeds the 40 m build grid. Import a smaller area.')
  const toPoint = (p: PixelPoint): Point => ({ x: (p.x - (analysis.bounds.minX + analysis.bounds.maxX) / 2) * scale, z: (p.y - (analysis.bounds.minY + analysis.bounds.maxY) / 2) * scale })
  project.width = Math.max(12, realWidth + 2); project.length = Math.max(12, planHeight * scale + 2)
  const accepted = analysis.openings.map((opening) => ({ ...opening, type: opening.type === 'unconfirmed' ? opening.suggestedType || 'ignore' : opening.type })).filter((opening) => opening.type === 'door' || opening.type === 'window')
  const walls = joinSolidBands([...analysis.walls.map((wall) => ({ ...wall, a: { ...wall.a }, b: { ...wall.b } })), ...accepted.map((opening) => ({ ...opening }))]).filter((wall) => length(wall) * scale >= 0.25)
  project.features = walls.map((wall, index) => ({ ...wallFromPoints(`imported-wall-${index}`, toPoint(wall.a), toPoint(wall.b), project.ceilingHeight), thickness: clamp(wall.thickness * scale, 0.02, 2) }))
  for (const [index, opening] of accepted.entries()) {
    const wallIndex = walls.findIndex((wall) => wall.horizontal === opening.horizontal && Math.abs(across(wall) - across(opening)) <= wall.thickness && along(opening, opening.a) >= along(wall, wall.a) - 1 && along(opening, opening.b) <= along(wall, wall.b) + 1)
    if (wallIndex < 0 || project.features[wallIndex].width < 0.5 || project.features.length >= 200) continue
    const wall = project.features[wallIndex], centre = toPoint({ x: (opening.a.x + opening.b.x) / 2, y: (opening.a.y + opening.b.y) / 2 })
    const feature = attachOpening({ id: `imported-opening-${index}`, type: opening.type as 'door' | 'window', wallId: wall.id, x: centre.x, z: centre.z, rotation: wall.rotation, width: length(opening) * scale, height: opening.type === 'door' ? 2.1 : 1.35, sillHeight: opening.type === 'window' ? 0.85 : 0 }, project)
    project.features.push(feature)
  }
  if (!isProject(project) || walls.some((wall) => [wall.a, wall.b].some((p) => { const v = toPoint(p); return Math.abs(v.x) > project.width / 2 || Math.abs(v.z) > project.length / 2 }))) throw new Error('The detected geometry exceeds editor limits. Check the scale or use a clearer drawing.')
  return project
}
