import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadEnvFile } from 'node:process'
import { readFile } from 'node:fs/promises'

try { loadEnvFile('.env.local') } catch {}
import { CloudTasksClient } from '@google-cloud/tasks'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { cancelCrawlJob, createCrawlJob, getJob, listJobs, runCrawlJob } from './catalog-workflow'

type Role = 'viewer' | 'editor' | 'admin' | 'owner'
const roleRank: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }
const port = Number(process.env.PORT || process.env.ADMIN_PORT || 8787)
const host = process.env.ADMIN_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')
const workers = new Set<string>()
const tasks = new CloudTasksClient()

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function firebase() {
  const app = getApps()[0] || initializeApp()
  return { auth: getAuth(app), db: getFirestore(app) }
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' })
  response.end(body)
}

async function body(request: IncomingMessage) {
  let value = ''
  for await (const chunk of request) value += chunk
  return value ? JSON.parse(value) as Record<string, unknown> : {}
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
  const configuredOwner = (process.env.ADMIN_EMAILS || '').split(',').map((item) => item.trim().toLowerCase()).includes(email)
  let role = configuredOwner ? 'owner' as Role : roleFromValue(decoded.role) || (decoded.admin === true ? 'admin' as Role : null)
  try {
    const userDoc = await firebase().db.collection('adminUsers').doc(decoded.uid).get()
    const storedRole = roleFromValue(userDoc.data()?.role)
    if (storedRole) role = storedRole
    if (userDoc.data()?.status === 'revoked') role = null
  } catch (error) {
    if (!role) throw new ApiError(503, `Firebase Admin is not configured: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!role || roleRank[role] < roleRank[minimum]) throw new ApiError(403, 'This account does not have the required admin role.')
  return { uid: decoded.uid, email, role, token: decoded }
}

async function audit(actor: Awaited<ReturnType<typeof context>>, action: string, target: string, data: Record<string, unknown> = {}) {
  const { db } = firebase()
  await db.collection('adminAudit').add({ actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role, action, target, data, createdAt: FieldValue.serverTimestamp() })
}

async function catalogView() {
  const registry = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8')) as { generatedAt?: string; products?: Array<Record<string, unknown>> }
  let products = registry.products || []
  try {
    const stored = await firebase().db.collection('catalogProducts').get()
    if (stored.size) products = stored.docs.map((doc) => doc.data() as Record<string, unknown>)
    const snapshot = await firebase().db.collection('catalogEdits').get()
    const edits = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]))
    return { generatedAt: registry.generatedAt, products: products.map((product) => ({ ...product, ...(edits.get(String(product.id)) || {}) })).filter((product) => !product.deletedAt) }
  } catch {
    return { generatedAt: registry.generatedAt, products }
  }
}

async function enqueueJob(jobId: string) {
  const workerUrl = process.env.WORKER_URL
  const workerSecret = process.env.WORKER_TASK_SECRET
  if (!workerUrl || !workerSecret) return false
  const project = process.env.GCLOUD_PROJECT || 'forma-furniture-marketplace'
  const region = process.env.CLOUD_TASKS_REGION || 'europe-west1'
  const queue = process.env.CLOUD_TASKS_QUEUE || 'forma-ingestion'
  const parent = tasks.queuePath(project, region, queue)
  await tasks.createTask({ parent, task: { httpRequest: { httpMethod: 'POST', url: `${workerUrl.replace(/\/$/, '')}/api/worker/jobs`, headers: { 'content-type': 'application/json', 'x-forma-worker-secret': workerSecret }, body: Buffer.from(JSON.stringify({ jobId })).toString('base64') } } })
  return true
}

async function runJob(job: Awaited<ReturnType<typeof createCrawlJob>>, actor: Awaited<ReturnType<typeof context>>) {
  await audit(actor, 'crawl.started', job.id, { siteUrl: job.siteUrl, maxProducts: job.maxProducts })
  if (await enqueueJob(job.id)) { await audit(actor, 'crawl.enqueued', job.id); return }
  if (!workers.has(job.id)) { workers.add(job.id); void runCrawlJob(job.id).finally(() => workers.delete(job.id)) }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || host}`)
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' }); response.end(); return }
    if (request.method === 'POST' && url.pathname === '/api/worker/jobs') {
      if (!process.env.WORKER_TASK_SECRET || request.headers['x-forma-worker-secret'] !== process.env.WORKER_TASK_SECRET) throw new ApiError(401, 'Worker task authentication is required.')
      const input = await body(request)
      if (typeof input.jobId !== 'string') throw new ApiError(400, 'jobId is required.')
      const job = await runCrawlJob(input.jobId)
      if (job.status === 'failed') throw new ApiError(500, job.error || 'Ingestion job failed.')
      json(response, 200, job); return
    }
    if (!url.pathname.startsWith('/api/admin/')) { json(response, 404, { error: 'Not found.' }); return }
    const me = await context(request, url.pathname === '/api/admin/me' ? 'viewer' : 'viewer')
    if (request.method === 'GET' && url.pathname === '/api/admin/me') { json(response, 200, { uid: me.uid, email: me.email, role: me.role }); return }
    if (request.method === 'GET' && url.pathname === '/api/admin/jobs') { json(response, 200, await listJobs()); return }
    if (request.method === 'GET' && url.pathname === '/api/admin/catalog') { json(response, 200, await catalogView()); return }
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
    const productId = catalogId(url.pathname)
    if (request.method === 'PUT' && productId) {
      const actor = await context(request, 'editor'); const input = await body(request)
      const allowed = ['name', 'brand', 'price', 'status', 'description', 'category']
      const patch = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)))
      if (!Object.keys(patch).length) throw new ApiError(400, 'No editable catalog fields were provided.')
      await firebase().db.collection('catalogEdits').doc(productId).set({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.updated', productId, patch); json(response, 200, { id: productId, ...patch }); return
    }
    if (request.method === 'DELETE' && productId) {
      const actor = await context(request, 'admin')
      await firebase().db.collection('catalogEdits').doc(productId).set({ deletedAt: FieldValue.serverTimestamp(), deletedBy: actor.uid }, { merge: true })
      await audit(actor, 'catalog.deleted', productId); json(response, 200, { id: productId, deleted: true }); return
    }
    json(response, 404, { error: 'Not found.' })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    json(response, status, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => console.log(`Forma admin API listening on http://${host}:${port}`))
