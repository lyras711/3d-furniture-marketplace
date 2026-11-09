export type PurchaseAvailability = 'pending' | 'available' | 'unavailable'
export const purchaseStatuses = ['pending', 'awaiting-user-decision', 'ready-to-place', 'returned-for-revision', 'placed', 'delivered', 'cancelled'] as const
export type PurchaseStatus = typeof purchaseStatuses[number]
export type AdminStatusChange = 'placed' | 'delivered' | 'cancelled'
export type PurchaseHistoryEntry = { status: PurchaseStatus; at: string; by: 'customer' | 'admin'; note?: string }
export type AdminNote = { id: string; text: string; at: string; authorEmail: string }
export type PurchaseItem = {
  id: string
  productId: string
  variantId?: string
  variantName?: string
  name: string
  retailer: string
  sku: string | null
  quantity: number
  unitPrice: number | null
  catalogStatus: string
  availability: PurchaseAvailability
  included: boolean
}
export type PurchaseRequest = {
  id: string
  projectId: string
  projectName: string
  customer: { name: string; email: string; phone: string; city: string; notes: string }
  items: PurchaseItem[]
  estimatedTotal: number | null
  currency: 'EUR'
  status: PurchaseStatus
  createdAt: string
  updatedAt: string
  placedAt?: string
  deliveredAt?: string
  cancelledAt?: string
  /** Shown to the customer on their profile. */
  cancelReason?: string
  history?: PurchaseHistoryEntry[]
}
/** Admin-only projection; `adminNotes` must never be sent to `/api/account/**`. */
export type AdminPurchaseRequest = PurchaseRequest & { adminNotes: AdminNote[] }
export type AdminMetrics = {
  savedProjects: number
  requestsByStatus: Record<PurchaseStatus, number>
}
export type AvailabilityUpdate = { id: string; availability: Exclude<PurchaseAvailability, 'pending'> }
export const purchaseItemId = (productId: string, variantId?: string) => JSON.stringify([productId, variantId || ''])
export const activePurchaseStatuses: PurchaseStatus[] = ['pending', 'awaiting-user-decision', 'ready-to-place']

const adminTransitions: Record<AdminStatusChange, PurchaseStatus[]> = {
  placed: ['ready-to-place'],
  delivered: ['placed'],
  cancelled: [...activePurchaseStatuses, 'placed'],
}

export function adminTransitionAllowed(from: PurchaseStatus, to: AdminStatusChange) {
  return adminTransitions[to].includes(from)
}

export function estimatePurchase(items: PurchaseItem[]) {
  const included = items.filter((item) => item.included)
  if (!included.length || included.some((item) => item.unitPrice === null)) return null
  return included.reduce((sum, item) => sum + item.unitPrice! * item.quantity, 0)
}

export function reviewPurchaseItems(items: PurchaseItem[], updates: AvailabilityUpdate[]) {
  if (!items.length || updates.length !== items.length || new Set(updates.map((item) => item.id)).size !== items.length || updates.some((item) => !['available', 'unavailable'].includes(item.availability))) return null
  const availability = new Map(updates.map((item) => [item.id, item.availability]))
  if (items.some((item) => !availability.has(item.id))) return null
  const nextItems = items.map((item) => ({ ...item, availability: availability.get(item.id)! }))
  return { items: nextItems, status: nextItems.some((item) => item.availability === 'unavailable') ? 'awaiting-user-decision' as const : 'ready-to-place' as const }
}

export function decidePurchaseItems(items: PurchaseItem[], decision: 'proceed' | 'revise') {
  if (!items.length || items.some((item) => item.availability === 'pending') || (decision === 'proceed' && !items.some((item) => item.availability === 'available'))) return null
  if (decision === 'revise') return { items: items.map((item) => ({ ...item, included: false })), status: 'returned-for-revision' as const }
  return { items: items.map((item) => ({ ...item, included: item.availability === 'available' })), status: 'ready-to-place' as const }
}
