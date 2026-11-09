import { auth } from '../firebase'
import type { CatalogReview } from '../catalog'
import type { AdminMetrics, AdminPurchaseRequest } from '../purchase'
import type { Partner } from '../partners'

export type ItemStatus = 'queued' | 'scraping' | 'skipped-existing' | 'needs-model-recipe' | 'generated' | 'failed'
export type CrawlItem = { url: string; status: ItemStatus; sku: string | null; productId: string | null; artifactRoot: string | null; error: string | null; updatedAt: string }
export type Job = { id: string; siteUrl: string; retailerId: string; maxProducts: number; delayMs: number; status: string; discoveredUrls: string[]; items: CrawlItem[]; currentUrl: string | null; error: string | null; createdAt: string; updatedAt: string }
export type CatalogItem = { id: string; sku: string | null; name: string; brand: string; retailer: string; retailerId: string | null; group: string; category: string; width: number; depth: number; height: number; price: number | null; status: string; thumbnailPath: string | null; modelPath: string | null; variantCount: number; verification: { dimensions: string; model: string; humanReview: string } | null; hidden: boolean; review: CatalogReview; updatedAt: string | null }
export type AdminUser = { uid: string; email: string; role: string; status: string }
export type AuditEntry = { id: string; actorEmail: string; action: string; target: string; createdAt?: { _seconds?: number } }
export type Role = 'viewer' | 'editor' | 'admin' | 'owner'
export type AdminData = { jobs: Job[]; catalog: CatalogItem[]; users: AdminUser[]; audit: AuditEntry[]; requests: AdminPurchaseRequest[]; metrics: AdminMetrics | null; partners: Partner[] }
export const emptyData: AdminData = { jobs: [], catalog: [], users: [], audit: [], requests: [], metrics: null, partners: [] }

export const roleRank: Record<string, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }
export const atLeast = (role: string, minimum: Role) => (roleRank[role] || 0) >= roleRank[minimum]

export async function authFetch(input: string, init: RequestInit = {}) {
  const token = await auth?.currentUser?.getIdToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

/** JSON request that throws the server's error message on failure. */
export async function send<T = unknown>(path: string, method = 'GET', payload?: unknown): Promise<T> {
  const response = await authFetch(path, { method, ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((result as { error?: string }).error || `HTTP ${response.status}`)
  return result as T
}

export const euro = (value: number | null) => value === null ? 'Price pending' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
export const time = (value: string) => new Date(value).toLocaleString()
export const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const label = (value: string) => value.replaceAll('-', ' ')
export const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
