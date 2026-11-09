import { GoogleAuth } from 'google-auth-library'

export type PlanVisionPoint = { x: number; y: number }
export type PlanVisionSegment = { a: PlanVisionPoint; b: PlanVisionPoint; thickness: number; confidence: number }
export type PlanVisionResult = {
  walls: PlanVisionSegment[]
  openings: (PlanVisionSegment & { type: 'door' | 'window' | 'unconfirmed'; height?: number; sillHeight?: number; verticalConfidence?: number })[]
  roomLabels: { name: string; x: number; y: number; confidence: number }[]
  knownDimensions: { a: PlanVisionPoint; b: PlanVisionPoint; meters: number; label: string; confidence: number }[]
  ceilingHeight?: number
  ceilingHeightConfidence?: number
  confidence: number
  warnings: string[]
}
export type PlanVisionElevation = { imageData: string; mimeType: 'image/png'; width: number; height: number }
export type PlanVisionImage = PlanVisionElevation & { elevationImage?: PlanVisionElevation }

export interface PlanVisionProvider {
  detect(image: PlanVisionImage): Promise<PlanVisionResult>
}

const pointSchema = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] }
const segmentSchema = { type: 'OBJECT', properties: { a: pointSchema, b: pointSchema, thickness: { type: 'NUMBER' }, confidence: { type: 'NUMBER' } }, required: ['a', 'b', 'thickness', 'confidence'] }
const openingSchema = { type: 'OBJECT', properties: { ...segmentSchema.properties, type: { type: 'STRING', enum: ['door', 'window', 'unconfirmed'] }, heightMeters: { type: 'NUMBER' }, sillHeightMeters: { type: 'NUMBER' }, verticalConfidence: { type: 'NUMBER' } }, required: [...segmentSchema.required, 'type', 'heightMeters', 'sillHeightMeters', 'verticalConfidence'] }
const responseSchema = {
  type: 'OBJECT',
  properties: {
    walls: { type: 'ARRAY', items: segmentSchema },
    openings: { type: 'ARRAY', items: openingSchema },
    roomLabels: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, confidence: { type: 'NUMBER' } }, required: ['name', 'x', 'y', 'confidence'] } },
    knownDimensions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { a: pointSchema, b: pointSchema, meters: { type: 'NUMBER' }, label: { type: 'STRING' }, confidence: { type: 'NUMBER' } }, required: ['a', 'b', 'meters', 'label', 'confidence'] } },
    ceilingHeightMeters: { type: 'NUMBER' },
    ceilingHeightConfidence: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['walls', 'openings', 'roomLabels', 'knownDimensions', 'ceilingHeightMeters', 'ceilingHeightConfidence', 'confidence', 'warnings'],
}
const clampConfidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5

function point(value: unknown, width: number, height: number): PlanVisionPoint {
  if (!value || typeof value !== 'object') throw new Error('The plan detector returned an invalid point.')
  const { x, y } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) throw new Error('The plan detector returned a point outside the image.')
  return { x, y }
}

function segment(value: unknown, width: number, height: number): PlanVisionSegment {
  if (!value || typeof value !== 'object') throw new Error('The plan detector returned an invalid segment.')
  const raw = value as Record<string, unknown>
  const a = point(raw.a, width, height), b = point(raw.b, width, height)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 8) throw new Error('The plan detector returned a segment shorter than 8 pixels.')
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y), reversed = horizontal ? a.x > b.x : a.y > b.y
  const thickness = typeof raw.thickness === 'number' && Number.isFinite(raw.thickness) ? Math.max(2, Math.min(200, raw.thickness)) : 8
  return { a: reversed ? b : a, b: reversed ? a : b, thickness, confidence: clampConfidence(raw.confidence) }
}

export function normalizePlanVisionResult(value: unknown, width: number, height: number): PlanVisionResult {
  if (!value || typeof value !== 'object') throw new Error('The plan detector returned no geometry.')
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.walls) || !raw.walls.length || raw.walls.length > 120) throw new Error('The plan detector did not return a usable set of walls.')
  if (!Array.isArray(raw.openings) || raw.openings.length > 200 || !Array.isArray(raw.roomLabels) || raw.roomLabels.length > 40 || !Array.isArray(raw.knownDimensions) || raw.knownDimensions.length > 20) throw new Error('The plan detector returned too many features.')
  const walls = raw.walls.map((wall) => segment(wall, width, height)), warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((warning): warning is string => typeof warning === 'string').map((warning) => warning.slice(0, 240)).slice(0, 12) : []
  const openings = raw.openings.map((opening) => {
    if (!opening || typeof opening !== 'object') throw new Error('The plan detector returned an invalid opening.')
    const item = opening as Record<string, unknown>, type: 'door' | 'window' | 'unconfirmed' = item.type === 'door' || item.type === 'window' ? item.type : 'unconfirmed'
    const openingHeight = typeof item.heightMeters === 'number' && Number.isFinite(item.heightMeters) && item.heightMeters >= 0.3 && item.heightMeters <= 6 ? item.heightMeters : undefined
    const openingSillHeight = typeof item.sillHeightMeters === 'number' && Number.isFinite(item.sillHeightMeters) && item.sillHeightMeters >= 0 && item.sillHeightMeters <= 6 ? item.sillHeightMeters : undefined
    if ((typeof item.heightMeters === 'number' && item.heightMeters !== 0 && openingHeight === undefined) || (typeof item.sillHeightMeters === 'number' && item.sillHeightMeters !== -1 && openingSillHeight === undefined)) warnings.push('Ignored an elevation measurement outside the supported height range.')
    const verticalConfidence = clampConfidence(item.verticalConfidence)
    return { ...segment(item, width, height), type, ...(openingHeight !== undefined ? { height: openingHeight } : {}), ...(openingSillHeight !== undefined ? { sillHeight: openingSillHeight } : {}), ...(openingHeight !== undefined || openingSillHeight !== undefined ? { verticalConfidence } : {}) }
  })
  const roomLabels = raw.roomLabels.map((label) => {
    if (!label || typeof label !== 'object') throw new Error('The plan detector returned an invalid room label.')
    const item = label as Record<string, unknown>, position = point({ x: item.x, y: item.y }, width, height)
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('The plan detector returned an invalid room name.')
    return { name: item.name.trim(), ...position, confidence: clampConfidence(item.confidence) }
  })
  const knownDimensions = raw.knownDimensions.map((dimension) => {
    if (!dimension || typeof dimension !== 'object') throw new Error('The plan detector returned an invalid scale reference.')
    const item = dimension as Record<string, unknown>, a = point(item.a, width, height), b = point(item.b, width, height)
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8 || typeof item.meters !== 'number' || !Number.isFinite(item.meters) || item.meters < 0.25 || item.meters > 38 || typeof item.label !== 'string' || !item.label.trim()) throw new Error('The plan detector returned an invalid scale reference.')
    return { a, b, meters: item.meters, label: item.label.slice(0, 80), confidence: clampConfidence(item.confidence) }
  })
  const rawCeilingHeight = raw.ceilingHeightMeters
  const ceilingHeight = typeof rawCeilingHeight === 'number' && Number.isFinite(rawCeilingHeight) && rawCeilingHeight >= 2 && rawCeilingHeight <= 6 ? rawCeilingHeight : undefined
  if (rawCeilingHeight !== undefined && rawCeilingHeight !== 0 && ceilingHeight === undefined) warnings.push('Ignored a ceiling-height estimate outside the supported range.')
  return { walls, openings, roomLabels, knownDimensions, ...(ceilingHeight !== undefined ? { ceilingHeight, ceilingHeightConfidence: clampConfidence(raw.ceilingHeightConfidence) } : {}), confidence: clampConfidence(raw.confidence), warnings: warnings.slice(0, 12) }
}

export class VertexPlanVisionProvider implements PlanVisionProvider {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })

  async detect(image: PlanVisionImage) {
    const project = process.env.PLAN_VISION_PROJECT || process.env.GCLOUD_PROJECT || 'forma-furniture-marketplace'
    const location = process.env.PLAN_VISION_LOCATION || 'eu'
    const model = process.env.PLAN_VISION_MODEL || 'gemini-3.5-flash'
    const endpoint = location === 'eu' || location === 'us' ? `https://aiplatform.${location}.rep.googleapis.com` : `https://${location}-aiplatform.googleapis.com`
    const token = await this.auth.getAccessToken()
    if (!token) throw new Error('Vertex AI credentials are not available to this service.')
    const prompt = `Analyze the first image as a single-floor architectural plan. Return editable plan geometry in that image's pixel coordinates (${image.width} by ${image.height}); never invent a bounding room or infer metres from unscaled proportions. Detect wall centerlines, room labels, and door/window openings supported by evidence. Read printed plan dimensions only when legible. Keep diagonal walls. Use confidence values from 0 to 1, mark ambiguous openings unconfirmed, and report uncertainty. ${image.elevationImage ? `A second elevation drawing is supplied (${image.elevationImage.width} by ${image.elevationImage.height} pixels). Use it only to read explicit vertical dimensions and match openings when the correspondence is clear.` : 'No elevation drawing is supplied.'} Return ceilingHeightMeters and opening heightMeters as 0 when no explicit, trustworthy measurement is available. Return sillHeightMeters as -1 when unknown; 0 is a valid floor-level sill. Do not guess heights from image proportions. Return verticalConfidence from 0 to 1. Use an 8-pixel wall-thickness estimate when unclear. Do not reconstruct furniture or create a room photograph. A human will review and calibrate all measurements.`
    const parts = [{ text: prompt }, { text: 'Floor plan: use this image for all geometry pixel coordinates.' }, { inlineData: { mimeType: image.mimeType, data: image.imageData } }]
    if (image.elevationImage) parts.push({ text: 'Optional elevation: use only for vertical measurements, not plan pixel coordinates.' }, { inlineData: { mimeType: image.elevationImage.mimeType, data: image.elevationImage.imageData } })
    const response = await fetch(`${endpoint}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema, maxOutputTokens: 8192 },
      }),
    })
    if (!response.ok) throw new Error(`Vertex AI request failed (${response.status}).`)
    const result = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
    if (!text) throw new Error('Vertex AI returned no plan geometry.')
    return normalizePlanVisionResult(JSON.parse(text), image.width, image.height)
  }
}
