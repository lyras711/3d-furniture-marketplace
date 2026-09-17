import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage, type Storage } from 'firebase-admin/storage'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CatalogProductRecord } from './product-types'
import type { CrawlJob } from './catalog-workflow'

let cached: { app: App; db: Firestore; storage: Storage } | null = null

export function firebaseStore() {
  if (cached) return cached
  const app = getApps()[0] || initializeApp({ storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'forma-furniture-marketplace.firebasestorage.app' })
  cached = { app, db: getFirestore(app), storage: getStorage(app) }
  return cached
}

export async function persistJob(job: CrawlJob) {
  await firebaseStore().db.collection('ingestionJobs').doc(job.id).set(job)
}

export async function getStoredJob(id: string) {
  const snapshot = await firebaseStore().db.collection('ingestionJobs').doc(id).get()
  return snapshot.exists ? snapshot.data() as CrawlJob : null
}

export async function listStoredJobs() {
  const snapshot = await firebaseStore().db.collection('ingestionJobs').get()
  return snapshot.docs.map((doc) => doc.data() as CrawlJob).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function upsertCatalogProduct(record: CatalogProductRecord) {
  await firebaseStore().db.collection('catalogProducts').doc(record.id).set({ ...record, updatedAt: new Date().toISOString() }, { merge: true })
}

function contentType(file: string) {
  const ext = path.extname(file).toLowerCase()
  return ({ '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary' } as Record<string, string>)[ext] || 'application/octet-stream'
}

export async function uploadFile(localPath: string, storageKey: string, options: { public?: boolean } = {}) {
  const buffer = await readFile(localPath)
  const bucket = firebaseStore().storage.bucket()
  const file = bucket.file(storageKey)
  await file.save(buffer, { resumable: false, metadata: { contentType: contentType(localPath), cacheControl: 'public,max-age=31536000,immutable' } })
  if (options.public) {
    try { await file.makePublic(); return file.publicUrl() } catch {}
  }
  const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 365 * 24 * 60 * 60 * 1000 })
  return url
}

export async function uploadArtifactTree(localRoot: string, storagePrefix: string) {
  const uploaded: Record<string, string> = {}
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      const relative = path.relative(localRoot, full).split(path.sep).join('/')
      if (entry.isDirectory()) { await visit(full); continue }
      if (entry.name.endsWith('.blend')) continue
      uploaded[relative] = await uploadFile(full, `${storagePrefix}/${relative}`)
    }
  }
  await visit(localRoot)
  return uploaded
}
