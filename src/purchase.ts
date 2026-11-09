export type PurchaseAvailability = 'pending' | 'available' | 'unavailable'
export type PurchaseStatus = 'pending' | 'awaiting-user-decision' | 'ready-to-place' | 'returned-for-revision' | 'placed'
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
}
export type AdminMetrics = {
  savedProjects: number
  requestsByStatus: Record<PurchaseStatus, number>
}
export type AvailabilityUpdate = { id: string; availability: Exclude<PurchaseAvailability, 'pending'> }
export const purchaseItemId = (productId: string, variantId?: string) => JSON.stringify([productId, variantId || ''])

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
