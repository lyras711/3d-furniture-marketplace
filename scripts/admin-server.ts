import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadEnvFile } from 'node:process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

try { loadEnvFile('.env.local') } catch {}
import { CloudTasksClient } from '@google-cloud/tasks'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { getAppCheck } from 'firebase-admin/app-check'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { cancelCrawlJob, clearFinishedCrawlJobs, createCrawlJob, deleteCrawlJob, getJob, listJobs, runCrawlJob } from './catalog-workflow'
import { activePurchaseStatuses, adminTransitionAllowed, decidePurchaseItems, estimatePurchase, purchaseItemId, purchaseStatuses, reviewPurchaseItems, type AdminNote, type AdminPurchaseRequest, type AdminStatusChange, type AvailabilityUpdate, type PurchaseHistoryEntry, type PurchaseItem, type PurchaseRequest } from '../src/purchase'
import { getFloorRegions, isProject, migrateProject, productById, type ProjectState } from '../src/editor'
import { catalogReviews, products, type CatalogReview } from '../src/catalog'
import { partnerFields, type Partner, type PartnerNote } from '../src/partners'
import { applyCatalogMetadataOverrides, catalogAssetPrefixFromUrl, catalogReviewState, duplicateSkuProduct, normalizedSku, catalogHasDimensions, catalogIsDeleted, catalogIsHidden, parseCatalogArchiveIds, parseCatalogMetadataOverrides, parseCatalogPermanentDeleteIds, parseManualCatalogProduct, readCatalogMetadataOverrides } from './catalog-admin'
import { VertexPlanVisionProvider } from './plan-vision'
import { clearFinishedMetadataCrawls, createMetadataCrawl, refetchMetadataProduct, deleteMetadataCrawl, getMetadataCrawl, listMetadataCrawls, runMetadataCrawl } from './catalog-metadata-crawl'
import { firebaseStore, uploadBuffer } from './firebase-store'
import { validateGlb, validateTexture } from './catalog-asset'

type Role = 'viewer' | 'editor' | 'admin' | 'owner'
const roleRank: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }
const port = Number(process.env.PORT || process.env.ADMIN_PORT || 8787)
const host = process.env.ADMIN_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')
const workers = new Set<string>()
const tasks = new CloudTasksClient()
const planVision = new VertexPlanVisionProvider()

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function firebase() {
  const { app } = firebaseStore()
  return { auth: getAuth(app), appCheck: getAppCheck(app), db: getFirestore(app) }
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,x-firebase-appcheck' })
  response.end(body)
}

async function body(request: IncomingMessage, limit = 2 * 1024 * 1024) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw new ApiError(413, 'Request body is too large.')
    chunks.push(bytes)
  }
  const value = Buffer.concat(chunks).toString('utf8')
  if (!value) return {}
  try { return JSON.parse(value) as Record<string, unknown> } catch { throw new ApiError(400, 'Request body must be valid JSON.') }
}

function jobId(pathname: string) {
  return pathname.match(/^\/api\/admin\/jobs\/([^/]+)(?:\/(?:cancel|retry))?$/)?.[1] || null
}

function userId(pathname: string) {
  return pathname.match(/^\/api\/admin\/users\/([^/]+)$/)?.[1] || null
}

function catalogId(pathname: string) {
  return pathname.match(/^\/api\/admin\/catalog\/([^/]+)$/)?.[1] || null
}

function roleFromValue(value: unknown): Role | null {
  return value === 'viewer' || value === 'editor' || value === 'admin' || value === 'owner' ? value : null
}

async function context(request: IncomingMessage, minimum: Role = 'viewer') {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) throw new ApiError(401, 'Admin authentication is required.')
  let decoded: DecodedIdToken
  try { decoded = await firebase().auth.verifyIdToken(token) } catch { throw new ApiError(401, 'The Firebase ID token is invalid or expired.') }
  const email = decoded.email?.toLowerCase() || ''
  const listedOwner = (process.env.ADMIN_EMAILS || '').split(',').map((item) => item.trim().toLowerCase()).includes(email)
  // An unverified address proves nothing: anyone can register an ADMIN_EMAILS address first.
  const configuredOwner = listedOwner && decoded.email_verified === true
  let role = configuredOwner ? 'owner' as Role : roleFromValue(decoded.role) || (decoded.admin === true ? 'admin' as Role : null)
  try {
    const userDoc = await firebase().db.collection('adminUsers').doc(decoded.uid).get()
    const storedRole = roleFromValue(userDoc.data()?.role)
    if (storedRole) role = storedRole
    if (userDoc.data()?.status === 'revoked') role = null
  } catch (error) {
    if (!role) throw new ApiError(503, `Firebase Admin is not configured: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!role && listedOwner) throw new ApiError(403, 'Confirm your email address before using the admin dashboard. Open /profile to resend the confirmation link.')
  if (!role || roleRank[role] < roleRank[minimum]) throw new ApiError(403, 'This account does not have the required admin role.')
  return { uid: decoded.uid, email, role, token: decoded }
}

async function audit(actor: Awaited<ReturnType<typeof context>>, action: string, target: string, data: Record<string, unknown> = {}) {
  const { db } = firebase()
  await db.collection('adminAudit').add({ actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role, action, target, data, createdAt: FieldValue.serverTimestamp() })
}

async function catalogEdits() {
  const snapshot = await firebase().db.collection('catalogEdits').get()
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]))
}

async function allCatalogProducts() {
  const productsById = new Map(products.map((product) => [product.id, { ...product, _catalogSource: 'bundled' } as unknown as Record<string, unknown>]))
  try {
    const snapshot = await firebase().db.collection('catalogProducts').get()
    for (const doc of snapshot.docs) productsById.set(doc.id, { ...productsById.get(doc.id), ...doc.data(), id: doc.id, _catalogSource: 'firestore' })
  } catch {}
  return [...productsById.values()]
}

function catalogStorageBrand(product: Record<string, unknown>) {
  return String(product.brand || product.retailer || 'brand').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'brand'
}

async function deleteCatalogAssets(id: string, product: Record<string, unknown>, edit: Record<string, unknown>) {
  const bucket = firebaseStore().storage.bucket(), prefixes = new Set([`catalog/${catalogStorageBrand(product)}/${id}/`])
  const paths: unknown[] = [product.modelPath, product.thumbnailPath, edit.modelPath, ...(Array.isArray(product.sourceImages) ? product.sourceImages : [])]
  const variants = Array.isArray(product.variants) ? product.variants as Record<string, unknown>[] : []
  for (const variant of variants) paths.push(variant.modelPath, variant.texturePath, variant.thumbnailPath)
  const textureOverrides = edit.variantTextures && typeof edit.variantTextures === 'object' ? Object.values(edit.variantTextures as Record<string, unknown>) : []
  for (const texture of textureOverrides) if (texture && typeof texture === 'object') paths.push((texture as Record<string, unknown>).texturePath)
  const metadata = product.metadata && typeof product.metadata === 'object' ? product.metadata as Record<string, unknown> : {}
  const images = Array.isArray(metadata.images) ? metadata.images as Record<string, unknown>[] : []
  for (const image of images) paths.push(image.url)
  for (const value of paths) {
    const prefix = catalogAssetPrefixFromUrl(value, id, bucket.name)
    if (prefix) prefixes.add(prefix)
  }
  const files = new Map<string, ReturnType<typeof bucket.file>>()
  for (const prefix of prefixes) {
    const [found] = await bucket.getFiles({ prefix })
    for (const file of found) files.set(file.name, file)
  }
  const ownedFiles = [...files.values()]
  for (let index = 0; index < ownedFiles.length; index += 25) {
    await Promise.all(ownedFiles.slice(index, index + 25).map((file) => file.delete({ ignoreNotFound: true })))
  }
  return ownedFiles.length
}

function catalogVariants(product: Record<string, unknown>, edit: Record<string, unknown>, modelPath: unknown) {
  const variants = Array.isArray(product.variants) ? product.variants as Record<string, unknown>[] : []
  const textures = edit.variantTextures && typeof edit.variantTextures === 'object' ? edit.variantTextures as Record<string, unknown> : {}
  return variants.map((variant) => {
    const texture = textures[String(variant.id)]
    const override = texture && typeof texture === 'object' ? texture as Record<string, unknown> : {}
    return {
      ...variant,
      ...(typeof modelPath === 'string' ? { modelPath } : {}),
      ...(typeof override.texturePath === 'string' ? { texturePath: override.texturePath } : {}),
      ...(Object.hasOwn(override, 'textureMaterial') ? { textureMaterial: typeof override.textureMaterial === 'string' ? override.textureMaterial : null } : {}),
    }
  })
}

function catalogProductView(source: Record<string, unknown>, edit: Record<string, unknown>) {
  const { _catalogSource, ...sourceProduct } = source
  const overrides = readCatalogMetadataOverrides(edit.overrides), product = applyCatalogMetadataOverrides(sourceProduct, overrides)
  const modelPath = typeof edit.modelPath === 'string' ? edit.modelPath : product.modelPath
  const metadata = product.metadata as { missingFields?: string[] } | undefined
  const resolved: Record<string, boolean> = {
    name: Boolean(product.name), sku: Boolean(product.sku), price: product.price != null,
    width: Number(product.width) > 0, depth: Number(product.depth) > 0, height: Number(product.height) > 0,
    images: Array.isArray(product.sourceImages) && product.sourceImages.length > 0,
  }
  const missing = (metadata?.missingFields || []).filter((field) => !Object.hasOwn(resolved, field.toLowerCase()) || !resolved[field.toLowerCase()])
  const missingFields = [
    ...missing,
    ...(!resolved.sku ? ['SKU'] : []),
    ...(!resolved.price ? ['Price'] : []),
    ...(!resolved.width ? ['Width'] : []),
    ...(!resolved.depth ? ['Depth'] : []),
    ...(!resolved.height ? ['Height'] : []),
    ...(!resolved.images ? ['Images'] : []),
    ...(!modelPath ? ['3D model'] : []),
  ]
  const updatedAt = typeof edit.updatedAt === 'object' && edit.updatedAt && 'toDate' in edit.updatedAt
    ? (edit.updatedAt as { toDate(): Date }).toDate().toISOString()
    : (product.updatedAt || null)
  return {
    ...product,
    id: source.id,
    permanentlyDeletable: _catalogSource === 'firestore' && !products.some((item) => item.id === source.id),
    modelPath,
    variants: catalogVariants(product, edit, modelPath),
    missingFields: [...new Set(missingFields)],
    hidden: catalogIsHidden(edit),
    deleted: catalogIsDeleted(edit),
    hasOverrides: Object.keys(overrides).length > 0,
    overrides,
    review: catalogReviewState(edit),
    updatedAt,
  }
}

async function catalogView() {
  let edits = new Map<string, Record<string, unknown>>()
  try { edits = await catalogEdits() } catch {}
  return { products: (await allCatalogProducts()).map((product) => catalogProductView(product, edits.get(String(product.id)) || {})) }
}

async function hiddenProductIds() {
  return new Set([...(await catalogEdits())].filter(([, data]) => catalogIsHidden(data)).map(([id]) => id))
}

async function enqueueJob(jobId: string) {
  const workerUrl = process.env.WORKER_URL
  const workerSecret = process.env.WORKER_TASK_SECRET?.trim()
  if (!workerUrl || !workerSecret) return false
  const project = process.env.GCLOUD_PROJECT || 'forma-furniture-marketplace'
  const region = process.env.CLOUD_TASKS_REGION || 'europe-west1'
  const queue = process.env.CLOUD_TASKS_QUEUE || 'forma-ingestion'
  const parent = tasks.queuePath(project, region, queue)
  await tasks.createTask({ parent, task: { httpRequest: { httpMethod: 'POST', url: `${workerUrl.replace(/\/$/, '')}/api/worker/jobs`, headers: { 'content-type': 'application/json', 'x-forma-worker-secret': workerSecret }, body: Buffer.from(JSON.stringify({ jobId })).toString('base64') } } })
  return true
}

async function enqueueMetadataCrawl(jobId: string) {
  const workerUrl = process.env.WORKER_URL, secret = process.env.WORKER_TASK_SECRET?.trim()
  if (!workerUrl || !secret) return false
  const project = process.env.GCLOUD_PROJECT || 'forma-furniture-marketplace'
  const parent = tasks.queuePath(project, process.env.CLOUD_TASKS_REGION || 'europe-west1', process.env.CLOUD_TASKS_QUEUE || 'forma-ingestion')
  await tasks.createTask({ parent, task: { dispatchDeadline: { seconds: 1800 }, httpRequest: { httpMethod: 'POST', url: `${workerUrl.replace(/\/$/, '')}/api/worker/catalog-crawls`, headers: { 'content-type': 'application/json', 'x-forma-worker-secret': secret }, body: Buffer.from(JSON.stringify({ jobId })).toString('base64') } } })
  return true
}

async function runJob(job: Awaited<ReturnType<typeof createCrawlJob>>, actor: Awaited<ReturnType<typeof context>>) {
  await audit(actor, 'crawl.started', job.id, { siteUrl: job.siteUrl, maxProducts: job.maxProducts })
  try {
    if (await enqueueJob(job.id)) { await audit(actor, 'crawl.enqueued', job.id); return }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Cloud Tasks enqueue failed; running job in-process: ${message}`)
    await audit(actor, 'crawl.enqueue_failed', job.id, { error: message })
  }
  if (!workers.has(job.id)) { workers.add(job.id); void runCrawlJob(job.id).finally(() => workers.delete(job.id)) }
}

async function plannerUser(request: IncomingMessage) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, ''), appCheckToken = request.headers['x-firebase-appcheck']
  if (!token || typeof appCheckToken !== 'string') throw new ApiError(401, 'Firebase Auth and App Check tokens are required for AI plan processing.')
  try {
    const decoded = await firebase().auth.verifyIdToken(token)
    await firebase().appCheck.verifyToken(appCheckToken)
    return decoded.uid
  } catch {
    throw new ApiError(401, 'Firebase Auth and App Check tokens are invalid or expired.')
  }
}

async function consumePlanQuota(uid: string) {
  const { db } = firebase(), ref = db.collection('plannerUsage').doc(uid), day = new Date().toISOString().slice(0, 10)
  const configuredLimit = Number(process.env.PLAN_DETECTION_DAILY_LIMIT || 10)
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(50, Math.floor(configuredLimit))) : 10
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref), data = snapshot.data(), count = data?.day === day ? Number(data.count) || 0 : 0
    if (count >= limit) throw new ApiError(429, 'Daily AI plan detection limit reached. Use the local fallback or try again tomorrow.')
    transaction.set(ref, { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() })
  })
}

async function accountContext(request: IncomingMessage) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) throw new ApiError(401, 'Sign in to access your account.')
  let decoded: DecodedIdToken
  try { decoded = await firebase().auth.verifyIdToken(token) } catch { throw new ApiError(401, 'The Firebase ID token is invalid or expired.') }
  if (decoded.firebase?.sign_in_provider === 'anonymous' || !decoded.email) throw new ApiError(401, 'A signed-in account with an email address is required.')
  return { uid: decoded.uid, email: decoded.email.toLowerCase() }
}

function recordId(raw: string) {
  let id: string
  try { id = decodeURIComponent(raw) } catch { throw new ApiError(400, 'Record id is invalid.') }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError(400, 'Record id is invalid.')
  return id
}

function projectPayload(value: unknown): ProjectState {
  if (!isProject(value) || !value.name.trim() || value.name.trim().length > 80) throw new ApiError(400, 'A valid project is required; project names must be 1–80 characters.')
  const project = migrateProject({ ...value, name: value.name.trim() })
  const serialized = JSON.stringify(project)
  if (Buffer.byteLength(serialized) > 850_000) throw new ApiError(413, 'This project is too large to save to your profile.')
  // Editor helpers clear fields by setting them to undefined; Firestore rejects undefined, so store the JSON form.
  return JSON.parse(serialized) as ProjectState
}

function projectSummary(id: string, data: Record<string, unknown>) {
  const project = data.project as ProjectState
  return { id, name: project.name, createdAt: data.createdAt, updatedAt: data.updatedAt, objectCount: project.objects.length, roomCount: getFloorRegions(project.features).length }
}

async function ownedProject(uid: string, id: string) {
  const ref = firebase().db.collection('userProjects').doc(id), snapshot = await ref.get(), data = snapshot.data()
  if (!data || data.ownerUid !== uid) throw new ApiError(404, 'Saved project not found.')
  return { ref, data }
}

function storedPurchaseRequest(id: string, data: Record<string, unknown>): PurchaseRequest {
  return { id, projectId: String(data.projectId), projectName: String(data.projectName), customer: data.customer as PurchaseRequest['customer'], items: data.items as PurchaseItem[], estimatedTotal: typeof data.estimatedTotal === 'number' ? data.estimatedTotal : null, currency: 'EUR', status: data.status as PurchaseRequest['status'], createdAt: String(data.createdAt), updatedAt: String(data.updatedAt), ...Object.fromEntries((['placedAt', 'deliveredAt', 'cancelledAt', 'cancelReason'] as const).filter((key) => typeof data[key] === 'string').map((key) => [key, data[key]])), history: Array.isArray(data.history) ? data.history as PurchaseHistoryEntry[] : [] }
}

function adminPurchaseRequest(id: string, data: Record<string, unknown>): AdminPurchaseRequest {
  return { ...storedPurchaseRequest(id, data), adminNotes: Array.isArray(data.adminNotes) ? data.adminNotes as AdminNote[] : [] }
}

const historyEntry = (status: PurchaseRequest['status'], at: string, by: PurchaseHistoryEntry['by'], note?: string): PurchaseHistoryEntry => ({ status, at, by, ...(note ? { note } : {}) })

function storedPartner(id: string, data: Record<string, unknown>): Partner {
  const fields = partnerFields(data, true)
  return { website: '', country: '', contactName: '', contactEmail: '', contactPhone: '', retailerId: '', company: '', stage: 'lead', ...('fields' in fields ? fields.fields : {}), id, notes: Array.isArray(data.notes) ? data.notes as PartnerNote[] : [], stageHistory: Array.isArray(data.stageHistory) ? data.stageHistory as Partner['stageHistory'] : [], createdAt: String(data.createdAt), updatedAt: String(data.updatedAt) }
}

function requestText(value: unknown, label: string, max: number, required = true) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new ApiError(400, `${label} must be text.`)
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if ((required && !text) || text.length > max) throw new ApiError(400, `${label} must be ${required ? '1–' : 'at most '}${max} characters.`)
  return text
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || host}`)
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-firebase-appcheck' }); response.end(); return }
    if (request.method === 'POST' && url.pathname === '/api/planner/detect-floor-plan') {
      const uid = await plannerUser(request), input = await body(request, 18 * 1024 * 1024)
      const validBase64 = (value: unknown): value is string => typeof value === 'string' && /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
      if (input.mimeType !== 'image/png' || !validBase64(input.imageData)) throw new ApiError(400, 'A base64 PNG floor plan is required.')
      if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || Number(input.width) < 1 || Number(input.width) > 1800 || Number(input.height) < 1 || Number(input.height) > 1400) throw new ApiError(400, 'Image dimensions are outside supported limits.')
      const imageBytes = Buffer.from(input.imageData, 'base64')
      if (!imageBytes.length || imageBytes.length > 8 * 1024 * 1024 || imageBytes.toString('base64') !== input.imageData) throw new ApiError(400, 'Image data is invalid or too large.')
      let elevationImage: { imageData: string; mimeType: 'image/png'; width: number; height: number } | undefined
      if (input.elevationImage !== undefined) {
        if (!input.elevationImage || typeof input.elevationImage !== 'object' || Array.isArray(input.elevationImage)) throw new ApiError(400, 'Elevation image data is invalid.')
        const elevation = input.elevationImage as Record<string, unknown>
        if (elevation.mimeType !== 'image/png' || !validBase64(elevation.imageData) || !Number.isInteger(elevation.width) || !Number.isInteger(elevation.height) || Number(elevation.width) < 1 || Number(elevation.width) > 1800 || Number(elevation.height) < 1 || Number(elevation.height) > 1400) throw new ApiError(400, 'Elevation image dimensions or format are invalid.')
        const elevationBytes = Buffer.from(elevation.imageData, 'base64')
        if (!elevationBytes.length || elevationBytes.length > 4 * 1024 * 1024 || elevationBytes.toString('base64') !== elevation.imageData || imageBytes.length + elevationBytes.length > 12 * 1024 * 1024) throw new ApiError(400, 'Elevation image data is invalid or too large.')
        elevationImage = { imageData: elevation.imageData, mimeType: 'image/png', width: Number(elevation.width), height: Number(elevation.height) }
      }
      try { await consumePlanQuota(uid) } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, 'AI plan quota service is unavailable.') }
      try {
        const result = await planVision.detect({ imageData: input.imageData, mimeType: 'image/png', width: Number(input.width), height: Number(input.height), ...(elevationImage ? { elevationImage } : {}) })
        json(response, 200, result); return
      } catch {
        throw new ApiError(503, 'Vertex AI plan detection is unavailable. Use the local fallback or try again later.')
      }
    }
    if (request.method === 'POST' && (url.pathname === '/api/worker/jobs' || url.pathname === '/api/worker/catalog-crawls')) {
      if (!process.env.WORKER_TASK_SECRET?.trim() || request.headers['x-forma-worker-secret'] !== process.env.WORKER_TASK_SECRET.trim()) throw new ApiError(401, 'Worker task authentication is required.')
      const input = await body(request)
      if (typeof input.jobId !== 'string') throw new ApiError(400, 'jobId is required.')
      if (url.pathname.endsWith('/catalog-crawls')) { const job = await runMetadataCrawl(input.jobId); if (!job) throw new ApiError(404, 'Catalog crawl not found.'); json(response, 200, job); return }
      const job = await runCrawlJob(input.jobId)
      if (job.status === 'failed') throw new ApiError(500, job.error || 'Ingestion job failed.')
      json(response, 200, job); return
    }
    if (url.pathname.startsWith('/api/account/')) {
      const actor = await accountContext(request), db = firebase().db
      if (request.method === 'GET' && url.pathname === '/api/account/projects') {
        const snapshot = await db.collection('userProjects').where('ownerUid', '==', actor.uid).get()
        const projects = snapshot.docs.map((doc) => projectSummary(doc.id, doc.data())).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        json(response, 200, projects); return
      }
      if (request.method === 'POST' && url.pathname === '/api/account/projects') {
        const project = projectPayload((await body(request)).project), now = new Date().toISOString(), ref = db.collection('userProjects').doc()
        const data = { ownerUid: actor.uid, project, createdAt: now, updatedAt: now }
        await ref.create(data)
        json(response, 201, projectSummary(ref.id, data)); return
      }
      const projectMatch = url.pathname.match(/^\/api\/account\/projects\/([^/]+)$/)
      if (projectMatch) {
        const id = recordId(projectMatch[1]), { ref, data } = await ownedProject(actor.uid, id)
        if (request.method === 'GET') { json(response, 200, { ...projectSummary(id, data), project: data.project }); return }
        if (request.method === 'PUT') {
          const input = await body(request), value = input.project ?? (typeof input.name === 'string' ? { ...(data.project as ProjectState), name: requestText(input.name, 'Project name', 80) } : null)
          if (!value) throw new ApiError(400, 'A project or project name is required.')
          const project = projectPayload(value), now = new Date().toISOString()
          await ref.update({ project, updatedAt: now })
          json(response, 200, projectSummary(id, { ...data, project, updatedAt: now })); return
        }
        if (request.method === 'DELETE') {
          const requests = await db.collection('purchaseRequests').where('ownerUid', '==', actor.uid).get()
          if (requests.docs.some((doc) => doc.data().projectId === id && activePurchaseStatuses.includes(doc.data().status))) throw new ApiError(409, 'Resolve the active purchase request before deleting this space.')
          await ref.delete(); json(response, 200, { id, deleted: true }); return
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/account/purchase-requests') {
        const snapshot = await db.collection('purchaseRequests').where('ownerUid', '==', actor.uid).get()
        const requests = snapshot.docs.map((doc) => storedPurchaseRequest(doc.id, doc.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        json(response, 200, requests); return
      }
      if (request.method === 'POST' && url.pathname === '/api/account/purchase-requests') {
        const input = await body(request)
        if (typeof input.projectId !== 'string') throw new ApiError(400, 'A saved project is required for a purchase request.')
        const projectId = recordId(input.projectId), { data: projectData } = await ownedProject(actor.uid, projectId), project = projectData.project as ProjectState
        if (!isProject(project)) throw new ApiError(409, 'The saved project is no longer valid.')
        const basket = new Map<string, { productId: string; variantId?: string; quantity: number }>(), hidden = await hiddenProductIds()
        project.objects.forEach((object) => {
          if (!object.inBasket || !object.productId) return
          const product = productById.get(object.productId)
          if (product && hidden.has(product.id)) throw new ApiError(400, `${product.name} is no longer offered. Remove it from the basket and try again.`)
          if (!product || (object.variantId && !product.variants?.some((variant) => variant.id === object.variantId))) throw new ApiError(400, 'A basket product or variant is no longer in the catalog.')
          const id = purchaseItemId(product.id, object.variantId), current = basket.get(id)
          if (current) current.quantity += 1
          else basket.set(id, { productId: product.id, ...(object.variantId ? { variantId: object.variantId } : {}), quantity: 1 })
        })
        if (!basket.size) throw new ApiError(400, 'Add at least one catalog product to the basket before requesting a purchase.')
        const items: PurchaseItem[] = [...basket].map(([id, { productId, variantId, quantity }]) => {
          const product = productById.get(productId)!, variant = product.variants?.find((item) => item.id === variantId)
          return { id, productId, ...(variantId ? { variantId } : {}), ...(variant ? { variantName: variant.name } : {}), name: product.name, retailer: product.retailer, sku: product.sku, quantity, unitPrice: product.price, catalogStatus: product.status, availability: 'pending', included: true }
        })
        const contact = input.customer && typeof input.customer === 'object' ? input.customer as Record<string, unknown> : {}
        const customer = { name: requestText(contact.name, 'Full name', 100), email: actor.email, phone: requestText(contact.phone, 'Phone', 40, false), city: requestText(contact.city, 'Delivery city', 100), notes: requestText(contact.notes, 'Notes', 500, false) }
        const estimatedTotal = estimatePurchase(items), now = new Date().toISOString(), ref = db.collection('purchaseRequests').doc()
        const data = { ownerUid: actor.uid, projectId, projectName: project.name, customer, items, estimatedTotal, currency: 'EUR', status: 'pending', createdAt: now, updatedAt: now, history: [historyEntry('pending', now, 'customer')] }
        await ref.create(data)
        json(response, 201, storedPurchaseRequest(ref.id, data)); return
      }
      const decisionMatch = url.pathname.match(/^\/api\/account\/purchase-requests\/([^/]+)\/decision$/)
      if (request.method === 'POST' && decisionMatch) {
        const id = recordId(decisionMatch[1]), ref = db.collection('purchaseRequests').doc(id), snapshot = await ref.get(), data = snapshot.data()
        if (!data || data.ownerUid !== actor.uid) throw new ApiError(404, 'Purchase request not found.')
        if (data.status !== 'awaiting-user-decision') throw new ApiError(409, 'This request is not waiting for a decision.')
        const input = await body(request), decision = input.decision
        if (decision !== 'proceed' && decision !== 'revise') throw new ApiError(400, 'Choose whether to proceed or revise the design.')
        const result = decidePurchaseItems(data.items as PurchaseItem[], decision)
        if (!result) throw new ApiError(400, 'This request has no available items to proceed with.')
        const estimatedTotal = estimatePurchase(result.items), now = new Date().toISOString()
        const entry = historyEntry(result.status, now, 'customer')
        await ref.update({ items: result.items, status: result.status, estimatedTotal, userDecision: decision, updatedAt: now, history: FieldValue.arrayUnion(entry) })
        json(response, 200, storedPurchaseRequest(id, { ...data, items: result.items, status: result.status, estimatedTotal, updatedAt: now, history: [...(Array.isArray(data.history) ? data.history : []), entry] })); return
      }
      json(response, 404, { error: 'Account resource not found.' }); return
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog/visibility') {
      let hidden: string[] = []
      try { hidden = [...await hiddenProductIds()] } catch {}
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' })
      response.end(JSON.stringify({ hidden })); return
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog/products') {
      const { products: catalog } = await catalogView()
      json(response, 200, { products: catalog.map(({ hidden: _hidden, review: _review, updatedAt: _updatedAt, deleted: _deleted, hasOverrides: _hasOverrides, overrides: _overrides, permanentlyDeletable: _permanentlyDeletable, ...product }) => product), hidden: catalog.filter((product) => product.hidden).map((product) => product.id) }); return
    }
    if (!url.pathname.startsWith('/api/admin/')) { json(response, 404, { error: 'Not found.' }); return }
    const me = await context(request, url.pathname === '/api/admin/me' ? 'viewer' : 'viewer')
    if (request.method === 'GET' && url.pathname === '/api/admin/me') { json(response, 200, { uid: me.uid, email: me.email, role: me.role }); return }
    if (request.method === 'GET' && url.pathname === '/api/admin/jobs') { json(response, 200, await listJobs()); return }
    if (request.method === 'GET' && url.pathname === '/api/admin/catalog') { json(response, 200, await catalogView()); return }
    if (request.method === 'POST' && url.pathname === '/api/admin/catalog') {
      const actor = await context(request, 'admin')
      let input: ReturnType<typeof parseManualCatalogProduct>
      try { input = parseManualCatalogProduct(await body(request)) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Catalog product is invalid.') }
      const duplicate = duplicateSkuProduct((await catalogView()).products as Record<string, unknown>[], input)
      if (duplicate) throw new ApiError(409, `SKU ${input.sku} already exists for ${input.retailer}: "${String(duplicate.name)}" (${String(duplicate.id)}).`)
      const db = firebase().db, ref = db.collection('catalogProducts').doc(), timestamp = FieldValue.serverTimestamp()
      const batch = db.batch()
      batch.create(ref, {
        id: ref.id, name: input.name, brand: input.brand, retailer: input.retailer, sku: input.sku,
        group: input.group, category: input.category, width: input.width, depth: input.depth, height: input.height,
        price: input.price, currency: 'EUR', tone: '#b8ab95', accent: '#816b54',
        status: 'Manual draft · review required', importedBy: 'admin-manual', sourceUrl: input.sourceUrl,
        thumbnailPath: input.thumbnailUrl, sourceImages: input.thumbnailUrl ? [input.thumbnailUrl] : [],
        modelPath: null, variants: [], createdAt: timestamp, updatedAt: timestamp,
      })
      batch.set(db.collection('catalogEdits').doc(ref.id), { hidden: true, review: 'pending', createdAt: timestamp, updatedAt: timestamp, updatedBy: actor.uid }, { merge: true })
      await batch.commit()
      await audit(actor, 'catalog.created', ref.id, { name: input.name, importedBy: 'admin-manual' })
      json(response, 201, { id: ref.id, hidden: true, review: 'pending' }); return
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/catalog/bulk-archive') {
      const actor = await context(request, 'admin')
      let ids: string[]
      try { ids = parseCatalogArchiveIds(await body(request)) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Catalog product ids are invalid.') }
      const db = firebase().db, [catalog, edits] = await Promise.all([allCatalogProducts(), catalogEdits()])
      const knownIds = new Set(catalog.map((product) => String(product.id)))
      if (ids.some((id) => !knownIds.has(id))) throw new ApiError(404, 'One or more catalog products were not found.')
      const activeIds = ids.filter((id) => !catalogIsDeleted(edits.get(id) || {}))
      if (activeIds.length) {
        const batch = db.batch()
        for (const id of activeIds) batch.set(db.collection('catalogEdits').doc(id), {
          deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
        }, { merge: true })
        await batch.commit()
        await audit(actor, 'catalog.bulk-archived', 'selected', { ids: activeIds, assetsPreserved: true })
      }
      json(response, 200, { archived: activeIds.length, alreadyArchived: ids.length - activeIds.length }); return
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/catalog/permanent-delete') {
      const actor = await context(request, 'admin')
      let ids: string[]
      try { ids = parseCatalogPermanentDeleteIds(await body(request)) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Catalog delete request is invalid.') }
      const db = firebase().db
      const [catalogSnapshot, editsSnapshot] = await Promise.all([db.collection('catalogProducts').get(), db.collection('catalogEdits').get()])
      const sourceById = new Map(catalogSnapshot.docs.map((doc) => [doc.id, { ...doc.data(), id: doc.id }]))
      const editsById = new Map(editsSnapshot.docs.map((doc) => [doc.id, doc.data()]))
      for (const id of ids) {
        if (products.some((product) => product.id === id)) throw new ApiError(409, 'Bundled products are source-controlled and cannot be permanently deleted from the dashboard. Archive them instead.')
        if (!sourceById.has(id)) throw new ApiError(404, 'One or more imported catalog products were not found.')
      }
      let assetsDeleted = 0
      try {
        for (const id of ids) assetsDeleted += await deleteCatalogAssets(id, sourceById.get(id)!, editsById.get(id) || {})
      } catch {
        throw new ApiError(502, 'Product records were kept, but some stored assets may already have been deleted. Retry the permanent delete to finish cleanup.')
      }
      const batch = db.batch()
      for (const id of ids) {
        batch.delete(db.collection('catalogProducts').doc(id))
        batch.delete(db.collection('catalogEdits').doc(id))
      }
      try { await batch.commit() } catch { throw new ApiError(502, 'Product files were removed, but catalogue records remain. Retry the permanent delete to finish cleanup.') }
      await audit(actor, 'catalog.permanently-deleted', 'selected', { ids, assetsDeleted, savedDesignsMayNoLongerRender: true })
      json(response, 200, { deleted: ids.length, assetsDeleted }); return
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/catalog-crawls') { json(response, 200, await listMetadataCrawls()); return }
    if (request.method === 'DELETE' && url.pathname === '/api/admin/catalog-crawls') {
      const actor = await context(request, 'admin'), result = await clearFinishedMetadataCrawls()
      await audit(actor, 'catalog.metadata-crawls-cleared', 'finished', result)
      json(response, 200, result); return
    }
    const metadataCrawlId = url.pathname.match(/^\/api\/admin\/catalog-crawls\/([A-Za-z0-9_-]+)$/)?.[1]
    if (request.method === 'GET' && metadataCrawlId) { const job = await getMetadataCrawl(metadataCrawlId); if (!job) throw new ApiError(404, 'Catalog crawl not found.'); json(response, 200, job); return }
    if (request.method === 'DELETE' && metadataCrawlId) {
      const actor = await context(request, 'admin'), input = await body(request)
      if (input.deleteImportedData !== undefined && typeof input.deleteImportedData !== 'boolean') throw new ApiError(400, 'deleteImportedData must be true or false.')
      let result: Awaited<ReturnType<typeof deleteMetadataCrawl>>
      try { result = await deleteMetadataCrawl(metadataCrawlId, input.deleteImportedData === true) } catch (error) {
        if (error instanceof Error && error.message === 'Only finished crawl history can be deleted.') throw new ApiError(409, error.message)
        throw error
      }
      if (!result) throw new ApiError(404, 'Catalog crawl not found.')
      const { job, ...deleted } = result
      await audit(actor, 'catalog.metadata-crawl-deleted', job.id, { brandName: job.brandName, status: job.status, deleteImportedData: input.deleteImportedData === true, ...deleted })
      json(response, 200, { id: job.id, deleted: true, ...deleted }); return
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/catalog-crawls') {
      const actor = await context(request, 'editor'), input = await body(request)
      if (typeof input.brandName !== 'string' || typeof input.website !== 'string' || typeof input.retailerId !== 'string') throw new ApiError(400, 'Brand name, retailer id and HTTPS website are required.')
      let job: Awaited<ReturnType<typeof createMetadataCrawl>>
      try { job = await createMetadataCrawl({ brandName: requestText(input.brandName, 'Brand name', 100), retailerId: requestText(input.retailerId, 'Retailer id', 72), website: input.website, maxProducts: Number(input.maxProducts || 100), delayMs: Number(input.delayMs || 1000) }) }
      catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid catalogue crawl request.') }
      await audit(actor, 'catalog.metadata-crawl-started', job.id, { brand: job.brandName, website: job.website })
      try { if (!await enqueueMetadataCrawl(job.id)) throw new Error('Cloud Tasks is not configured.') }
      catch (error) { console.warn(`Metadata crawl enqueue failed: ${error instanceof Error ? error.message : String(error)}`); void runMetadataCrawl(job.id) }
      json(response, 202, job); return
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/metrics') {
      await context(request, 'admin')
      const db = firebase().db, requestsByStatus = Object.fromEntries(purchaseStatuses.map((status) => [status, 0])) as Record<PurchaseRequest['status'], number>
      const [projects, ...counts] = await Promise.all([db.collection('userProjects').count().get(), ...Object.keys(requestsByStatus).map((status) => db.collection('purchaseRequests').where('status', '==', status).count().get())])
      Object.keys(requestsByStatus).forEach((status, index) => { requestsByStatus[status as PurchaseRequest['status']] = counts[index].data().count })
      json(response, 200, { savedProjects: projects.data().count, requestsByStatus }); return
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/purchase-requests') {
      await context(request, 'admin')
      const snapshot = await firebase().db.collection('purchaseRequests').orderBy('createdAt', 'desc').get()
      json(response, 200, snapshot.docs.map((doc) => adminPurchaseRequest(doc.id, doc.data()))); return
    }
    const availabilityMatch = url.pathname.match(/^\/api\/admin\/purchase-requests\/([^/]+)\/availability$/)
    if (request.method === 'PUT' && availabilityMatch) {
      const actor = await context(request, 'admin'), id = recordId(availabilityMatch[1]), ref = firebase().db.collection('purchaseRequests').doc(id), snapshot = await ref.get(), data = snapshot.data()
      if (!data) throw new ApiError(404, 'Purchase request not found.')
      if (data.status !== 'pending') throw new ApiError(409, 'Availability can only be reviewed while a request is pending.')
      const input = await body(request), rawItems = Array.isArray(input.items) ? input.items as Record<string, unknown>[] : []
      if (rawItems.some((item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || (item.availability !== 'available' && item.availability !== 'unavailable'))) throw new ApiError(400, 'Each product needs an available or unavailable result.')
      const updates = rawItems as AvailabilityUpdate[], result = reviewPurchaseItems(data.items as PurchaseItem[], updates)
      if (!result) throw new ApiError(400, 'Review every requested product exactly once.')
      const now = new Date().toISOString()
      const entry = historyEntry(result.status, now, 'admin')
      await ref.update({ items: result.items, status: result.status, updatedAt: now, availabilityReviewedBy: actor.uid, history: FieldValue.arrayUnion(entry) })
      await audit(actor, 'purchase.availability-reviewed', id, { status: result.status })
      json(response, 200, adminPurchaseRequest(id, { ...data, items: result.items, status: result.status, updatedAt: now, history: [...(Array.isArray(data.history) ? data.history : []), entry] })); return
    }
    const statusMatch = url.pathname.match(/^\/api\/admin\/purchase-requests\/([^/]+)\/status$/)
    if (request.method === 'POST' && statusMatch) {
      const actor = await context(request, 'admin'), id = recordId(statusMatch[1]), ref = firebase().db.collection('purchaseRequests').doc(id), snapshot = await ref.get(), data = snapshot.data()
      if (!data) throw new ApiError(404, 'Purchase request not found.')
      const input = await body(request), next = input.status as AdminStatusChange
      if (next !== 'placed' && next !== 'delivered' && next !== 'cancelled') throw new ApiError(400, 'Status must be placed, delivered or cancelled.')
      if (!adminTransitionAllowed(data.status, next)) throw new ApiError(409, `A ${String(data.status).replaceAll('-', ' ')} request cannot be marked ${next}.`)
      const reason = next === 'cancelled' ? requestText(input.reason, 'Cancellation reason', 300) : '', now = new Date().toISOString()
      const entry = historyEntry(next, now, 'admin', reason), patch: Record<string, unknown> = { status: next, updatedAt: now, [`${next}At`]: now, [`${next}By`]: actor.uid, ...(reason ? { cancelReason: reason } : {}) }
      await ref.update({ ...patch, history: FieldValue.arrayUnion(entry) })
      await audit(actor, `purchase.${next}`, id, { from: data.status, ...(reason ? { reason } : {}) })
      json(response, 200, adminPurchaseRequest(id, { ...data, ...patch, history: [...(Array.isArray(data.history) ? data.history : []), entry] })); return
    }
    const orderNoteMatch = url.pathname.match(/^\/api\/admin\/purchase-requests\/([^/]+)\/notes$/)
    if (request.method === 'POST' && orderNoteMatch) {
      const actor = await context(request, 'admin'), id = recordId(orderNoteMatch[1]), ref = firebase().db.collection('purchaseRequests').doc(id), snapshot = await ref.get(), data = snapshot.data()
      if (!data) throw new ApiError(404, 'Purchase request not found.')
      const note: AdminNote = { id: crypto.randomUUID(), text: requestText((await body(request)).text, 'Note', 1000), at: new Date().toISOString(), authorEmail: actor.email }
      await ref.update({ adminNotes: FieldValue.arrayUnion(note) })
      await audit(actor, 'purchase.note-added', id)
      json(response, 200, adminPurchaseRequest(id, { ...data, adminNotes: [...(Array.isArray(data.adminNotes) ? data.adminNotes : []), note] })); return
    }
    const partnerMatch = url.pathname.match(/^\/api\/admin\/partners(?:\/([^/]+))?(\/notes)?$/)
    if (partnerMatch) {
      const actor = await context(request, 'admin'), collection = firebase().db.collection('partners')
      if (!partnerMatch[1]) {
        if (request.method === 'GET') {
          const snapshot = await collection.get()
          json(response, 200, snapshot.docs.map((doc) => storedPartner(doc.id, doc.data())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); return
        }
        if (request.method === 'POST') {
          const result = partnerFields(await body(request))
          if ('error' in result) throw new ApiError(400, result.error)
          const now = new Date().toISOString(), ref = collection.doc(), data = { ...result.fields, notes: [], stageHistory: [{ stage: result.fields.stage, at: now, authorEmail: actor.email }], createdAt: now, updatedAt: now, createdBy: actor.uid }
          await ref.create(data)
          await audit(actor, 'partner.created', ref.id, { company: result.fields.company })
          json(response, 201, storedPartner(ref.id, data)); return
        }
      } else {
        const id = recordId(partnerMatch[1]), ref = collection.doc(id), snapshot = await ref.get(), data = snapshot.data()
        if (!data) throw new ApiError(404, 'Partner not found.')
        const now = new Date().toISOString()
        if (partnerMatch[2] && request.method === 'POST') {
          const note: PartnerNote = { id: crypto.randomUUID(), text: requestText((await body(request)).text, 'Note', 1000), at: now, authorEmail: actor.email }
          await ref.update({ notes: FieldValue.arrayUnion(note), updatedAt: now })
          await audit(actor, 'partner.note-added', id)
          json(response, 200, storedPartner(id, { ...data, notes: [...(Array.isArray(data.notes) ? data.notes : []), note], updatedAt: now })); return
        }
        if (!partnerMatch[2] && request.method === 'PUT') {
          const result = partnerFields(await body(request), true)
          if ('error' in result) throw new ApiError(400, result.error)
          if (!Object.keys(result.fields).length) throw new ApiError(400, 'No partner fields were provided.')
          const stageEntry = result.fields.stage && result.fields.stage !== data.stage ? { stage: result.fields.stage, at: now, authorEmail: actor.email } : null
          await ref.update({ ...result.fields, updatedAt: now, ...(stageEntry ? { stageHistory: FieldValue.arrayUnion(stageEntry) } : {}) })
          await audit(actor, stageEntry ? 'partner.stage-changed' : 'partner.updated', id, { ...result.fields })
          json(response, 200, storedPartner(id, { ...data, ...result.fields, updatedAt: now, stageHistory: [...(Array.isArray(data.stageHistory) ? data.stageHistory : []), ...(stageEntry ? [stageEntry] : [])] })); return
        }
        if (!partnerMatch[2] && request.method === 'DELETE') {
          await ref.delete()
          await audit(actor, 'partner.deleted', id, { company: data.company })
          json(response, 200, { id, deleted: true }); return
        }
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/audit') {
      await context(request, 'admin')
      const snapshot = await firebase().db.collection('adminAudit').orderBy('createdAt', 'desc').limit(100).get()
      json(response, 200, snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))); return
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/users') {
      await context(request, 'admin')
      const snapshot = await firebase().db.collection('adminUsers').get()
      json(response, 200, snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }))); return
    }
    if (request.method === 'DELETE' && url.pathname === '/api/admin/jobs') {
      const actor = await context(request, 'admin'), result = await clearFinishedCrawlJobs()
      await audit(actor, 'crawl.history-cleared', 'finished', result)
      json(response, 200, result); return
    }
    const crawlDeleteId = url.pathname.match(/^\/api\/admin\/jobs\/([A-Za-z0-9_-]+)$/)?.[1]
    if (request.method === 'DELETE' && crawlDeleteId) {
      const actor = await context(request, 'admin'), input = await body(request)
      if (input.deleteImportedData === true) throw new ApiError(409, 'Legacy products and generated assets are not safely linked to this crawl; no safe delete operation is available for them yet.')
      if (input.deleteImportedData !== undefined && typeof input.deleteImportedData !== 'boolean') throw new ApiError(400, 'deleteImportedData must be true or false.')
      let job
      try { job = await deleteCrawlJob(crawlDeleteId) } catch (error) {
        if (error instanceof Error && error.message === 'Only finished crawl history can be deleted.') throw new ApiError(409, error.message)
        throw error
      }
      if (!job) throw new ApiError(404, 'Ingestion job not found.')
      await audit(actor, 'crawl.deleted', job.id, { siteUrl: job.siteUrl, status: job.status, historyOnly: true })
      json(response, 200, { id: job.id, deleted: true }); return
    }
    const id = jobId(url.pathname)
    if (request.method === 'GET' && id) { json(response, 200, await getJob(id)); return }
    if (request.method === 'POST' && url.pathname === '/api/admin/jobs') {
      const actor = await context(request, 'editor')
      const input = await body(request)
      if (typeof input.siteUrl !== 'string' || !input.siteUrl.trim()) throw new ApiError(400, 'siteUrl is required.')
      const job = await createCrawlJob(input.siteUrl, Number(input.maxProducts || 100), Number(input.delayMs || 1000))
      await runJob(job, actor); json(response, 202, job); return
    }
    if (request.method === 'POST' && id && url.pathname.endsWith('/cancel')) {
      const actor = await context(request, 'editor'); const next = await cancelCrawlJob(id); await audit(actor, 'crawl.cancelled', id); json(response, 200, next); return
    }
    if (request.method === 'POST' && id && url.pathname.endsWith('/retry')) {
      const actor = await context(request, 'editor'); const old = await getJob(id); const job = await createCrawlJob(old.siteUrl, old.maxProducts, old.delayMs); await runJob(job, actor); json(response, 202, job); return
    }
    const uid = userId(url.pathname)
    if (request.method === 'POST' && url.pathname === '/api/admin/users') {
      const actor = await context(request, 'admin'); const input = await body(request)
      if (typeof input.email !== 'string' || !roleFromValue(input.role)) throw new ApiError(400, 'email and a valid role are required.')
      const target = await firebase().auth.getUserByEmail(input.email)
      await firebase().db.collection('adminUsers').doc(target.uid).set({ email: target.email, role: input.role, status: 'active', updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'user.role_changed', target.uid, { email: target.email, role: input.role }); json(response, 200, { uid: target.uid, email: target.email, role: input.role }); return
    }
    if (request.method === 'DELETE' && uid) {
      const actor = await context(request, 'admin')
      await firebase().db.collection('adminUsers').doc(uid).set({ status: 'revoked', updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'user.revoked', uid); json(response, 200, { uid, status: 'revoked' }); return
    }
    const restoreProductMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/restore$/)
    if (request.method === 'POST' && restoreProductMatch) {
      const actor = await context(request, 'admin'), id = recordId(restoreProductMatch[1])
      const product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      const ref = firebase().db.collection('catalogEdits').doc(id), edit = (await ref.get()).data() || {}
      if (!catalogIsDeleted(edit)) throw new ApiError(409, 'This catalog product is not deleted.')
      const effective = applyCatalogMetadataOverrides(product, readCatalogMetadataOverrides(edit.overrides))
      const modelPath = typeof edit.modelPath === 'string' ? edit.modelPath : effective.modelPath
      if ((product.importedBy === 'metadata-crawl' || product.importedBy === 'admin-manual') && edit.hidden !== true && (typeof modelPath !== 'string' || !modelPath.trim() || !catalogHasDimensions(effective))) throw new ApiError(409, 'Upload a GLB and complete the product dimensions before restoring this draft to the planner.')
      await ref.set({ deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.restored', id, { name: product.name })
      json(response, 200, { id, deleted: false }); return
    }
    const refetchMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/refetch$/)
    if (request.method === 'POST' && refetchMatch) {
      const actor = await context(request, 'editor'), id = recordId(refetchMatch[1])
      const edit = (await firebase().db.collection('catalogEdits').doc(id).get()).data() || {}
      if (catalogIsDeleted(edit)) throw new ApiError(409, 'Restore this archived product before refetching it.')
      try { await refetchMetadataProduct(id) } catch (error) { throw new ApiError(422, `Refetch failed: ${error instanceof Error ? error.message : String(error)}`) }
      await audit(actor, 'catalog.metadata-refetched', id)
      const product = (await allCatalogProducts()).find((item) => item.id === id)!
      json(response, 200, catalogProductView(product, (await catalogEdits()).get(id) || {})); return
    }
    const productId = catalogId(url.pathname)
    if (request.method === 'GET' && productId) {
      const id = recordId(productId), product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      const edit = (await catalogEdits()).get(id) || {}
      json(response, 200, catalogProductView(product, edit)); return
    }
    const modelUploadMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/model$/)
    if (request.method === 'PUT' && modelUploadMatch) {
      const actor = await context(request, 'admin'), id = recordId(modelUploadMatch[1]), product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      if (catalogIsDeleted((await firebase().db.collection('catalogEdits').doc(id).get()).data() || {})) throw new ApiError(409, 'Restore this product before uploading a model.')
      const input = await body(request, 25 * 1024 * 1024)
      if (input.mimeType !== 'model/gltf-binary' || typeof input.data !== 'string') throw new ApiError(400, 'Upload a valid binary GLB file.')
      let bytes: Buffer
      try { bytes = validateGlb(input.data) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'GLB file is invalid.') }
      const hash = createHash('sha256').update(bytes).digest('hex'), brand = catalogStorageBrand(product)
      const modelPath = await uploadBuffer(bytes, `catalog/${brand}/${id}/models/${hash}.glb`, 'model/gltf-binary', { public: true })
      await firebase().db.collection('catalogEdits').doc(id).set({ modelPath, modelHash: hash, modelSize: bytes.length, modelUpdatedAt: new Date().toISOString(), modelUpdatedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.model-uploaded', id, { hash, size: bytes.length })
      json(response, 200, { id, modelPath, hash, size: bytes.length }); return
    }
    const textureUploadMatch = url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/variants\/([^/]+)\/texture$/)
    if (request.method === 'PUT' && textureUploadMatch) {
      const actor = await context(request, 'admin'), id = recordId(textureUploadMatch[1]), variantId = recordId(textureUploadMatch[2])
      const product = (await allCatalogProducts()).find((item) => item.id === id)
      const variant = Array.isArray(product?.variants) ? (product.variants as Record<string, unknown>[]).find((item) => item.id === variantId) : undefined
      if (!product || !variant) throw new ApiError(404, 'Catalog variant not found.')
      if (catalogIsDeleted((await firebase().db.collection('catalogEdits').doc(id).get()).data() || {})) throw new ApiError(409, 'Restore this product before uploading a texture.')
      const input = await body(request, 14 * 1024 * 1024)
      if (typeof input.data !== 'string' || typeof input.mimeType !== 'string') throw new ApiError(400, 'Texture image data is required.')
      let asset: ReturnType<typeof validateTexture>
      try { asset = validateTexture(input.data, input.mimeType) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Texture image is invalid.') }
      const materialName = typeof input.materialName === 'string' ? input.materialName.trim() : ''
      if (materialName.length > 120) throw new ApiError(400, 'Material name must be 120 characters or less.')
      const hash = createHash('sha256').update(asset.bytes).digest('hex')
      const brand = catalogStorageBrand(product)
      const modelVariant = variantId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 72) || 'variant'
      const texturePath = await uploadBuffer(asset.bytes, `catalog/${brand}/${id}/variants/${modelVariant}/textures/${hash}.${asset.ext}`, input.mimeType, { public: true })
      const ref = firebase().db.collection('catalogEdits').doc(id), current = (await ref.get()).data() || {}
      const existing = current.variantTextures && typeof current.variantTextures === 'object' ? current.variantTextures as Record<string, unknown> : {}
      await ref.set({ variantTextures: { ...existing, [variantId]: { texturePath, textureMaterial: materialName || null, hash, size: asset.bytes.length, updatedAt: new Date().toISOString(), updatedBy: actor.uid } }, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.variant-texture-uploaded', id, { variantId, hash, size: asset.bytes.length })
      json(response, 200, { id, variantId, texturePath, hash, size: asset.bytes.length }); return
    }
    if (request.method === 'PATCH' && productId) {
      const actor = await context(request, 'admin'), id = recordId(productId), input = await body(request)
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'overrides') || !Object.hasOwn(input, 'overrides')) throw new ApiError(400, 'Provide only an overrides object or null.')
      const product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      const ref = firebase().db.collection('catalogEdits').doc(id), snapshot = await ref.get(), edit = snapshot.data() || {}
      if (catalogIsDeleted(edit)) throw new ApiError(409, 'Restore this product before editing it.')
      let overrides
      if (input.overrides === null) {
        await ref.set({ overrides: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      } else {
        let patch
        try { patch = parseCatalogMetadataOverrides(input.overrides) } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Catalog metadata is invalid.') }
        overrides = { ...readCatalogMetadataOverrides(edit.overrides), ...patch }
        const effective = applyCatalogMetadataOverrides(product, overrides)
        const previous = applyCatalogMetadataOverrides(product, readCatalogMetadataOverrides(edit.overrides))
        const duplicate = normalizedSku(previous.sku) !== normalizedSku(effective.sku) || previous.retailer !== effective.retailer ? duplicateSkuProduct((await catalogView()).products as Record<string, unknown>[], effective, id) : null
        if (duplicate) throw new ApiError(409, `SKU ${String(effective.sku)} is already used by "${String(duplicate.name)}" (${String(duplicate.id)}).`)
        await ref.set({ overrides, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      }
      await audit(actor, input.overrides === null ? 'catalog.metadata-reset' : 'catalog.metadata-updated', id, { fields: input.overrides === null ? Object.keys(readCatalogMetadataOverrides(edit.overrides)) : Object.keys(overrides || {}) })
      const updated = (await ref.get()).data() || {}
      json(response, 200, catalogProductView(product, updated)); return
    }
    if (request.method === 'DELETE' && productId) {
      const actor = await context(request, 'admin'), id = recordId(productId)
      const product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      const ref = firebase().db.collection('catalogEdits').doc(id), edit = (await ref.get()).data() || {}
      if (catalogIsDeleted(edit)) throw new ApiError(409, 'Catalog product is already deleted.')
      await ref.set({ deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.deleted', id, { name: product.name, assetsPreserved: true })
      json(response, 200, { id, deleted: true }); return
    }
    if (request.method === 'PUT' && productId) {
      const id = recordId(productId)
      const product = (await allCatalogProducts()).find((item) => item.id === id)
      if (!product) throw new ApiError(404, 'Catalog product not found.')
      const input = await body(request)
      if (Object.keys(input).some((key) => key !== 'review') || !catalogReviews.includes(input.review as CatalogReview)) throw new ApiError(400, `Set review to one of: ${catalogReviews.join(', ')}. Visibility is controlled by the "visible" status.`)
      const review = input.review as CatalogReview, ref = firebase().db.collection('catalogEdits').doc(id), edit = (await ref.get()).data() || {}
      const current = catalogReviewState(edit), visibilityChanges = (current === 'visible') !== (review === 'visible')
      const actor = await context(request, visibilityChanges ? 'admin' : 'editor')
      if (catalogIsDeleted(edit)) throw new ApiError(409, 'Restore this archived product before changing its status.')
      if (review === 'visible' && (product.importedBy === 'metadata-crawl' || product.importedBy === 'admin-manual')) {
        const effective = applyCatalogMetadataOverrides(product, readCatalogMetadataOverrides(edit.overrides))
        const modelPath = edit.modelPath || effective.modelPath
        if (typeof modelPath !== 'string' || !modelPath.trim() || !catalogHasDimensions(effective)) throw new ApiError(409, 'Upload a GLB and complete the product dimensions before making this product visible.')
      }
      const patch = { review, hidden: review !== 'visible' }
      await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, visibilityChanges ? review === 'visible' ? 'catalog.shown' : 'catalog.hidden' : 'catalog.reviewed', id, { from: current, review })
      json(response, 200, { id, ...patch }); return
    }
    json(response, 404, { error: 'Not found.' })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    json(response, status, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => console.log(`Forma admin API listening on http://${host}:${port}`))
