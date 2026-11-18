import { catalogGroups, type CatalogMetadataOverridePatch, type CatalogMetadataOverrides, type CatalogGroup } from '../src/catalog'

const groupSet = new Set<string>(catalogGroups)
const keys = new Set(['name', 'brand', 'retailer', 'sku', 'group', 'category', 'width', 'depth', 'height', 'price'])
const manualKeys = new Set([...keys, 'sourceUrl', 'thumbnailUrl'])

function text(value: unknown, label: string, max: number, required = true) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const result = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if ((required && !result) || result.length > max) throw new Error(`${label} must be ${required ? '1–' : 'at most '}${max} characters.`)
  return result
}

export function parseCatalogMetadataOverrides(input: unknown): CatalogMetadataOverridePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('overrides must be an object.')
  const value = input as Record<string, unknown>
  const entries = Object.keys(value)
  if (!entries.length) throw new Error('Provide at least one catalog field to update.')
  for (const key of entries) if (!keys.has(key)) throw new Error(`Catalog field "${key}" cannot be edited.`)
  const result: CatalogMetadataOverridePatch = {}
  if (Object.hasOwn(value, 'name')) result.name = text(value.name, 'Name', 160)
  if (Object.hasOwn(value, 'brand')) result.brand = text(value.brand, 'Brand', 120)
  if (Object.hasOwn(value, 'retailer')) result.retailer = text(value.retailer, 'Retailer', 120)
  if (Object.hasOwn(value, 'sku')) result.sku = value.sku === null ? null : text(value.sku, 'SKU', 100, false) || null
  if (Object.hasOwn(value, 'group')) {
    if (typeof value.group !== 'string' || !groupSet.has(value.group)) throw new Error('Choose a valid product group.')
    result.group = value.group as CatalogGroup
  }
  if (Object.hasOwn(value, 'category')) result.category = text(value.category, 'Category', 80)
  for (const dimension of ['width', 'depth', 'height'] as const) {
    if (!Object.hasOwn(value, dimension)) continue
    const amount = value[dimension]
    if (typeof amount !== 'number') throw new Error(`${dimension} must be between 0 and 2000 cm.`)
    if (!Number.isFinite(amount) || amount < 0 || amount > 2000) throw new Error(`${dimension} must be between 0 and 2000 cm.`)
    result[dimension] = amount
  }
  if (Object.hasOwn(value, 'price')) {
    const price = value.price
    if (price === null) result.price = null
    else {
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100000000) throw new Error('Price must be between 0 and 100000000, or empty.')
      result.price = price
    }
  }
  return result
}

export function parseManualCatalogProduct(input: unknown): CatalogMetadataOverrides & { sourceUrl: string | null; thumbnailUrl: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Product details must be an object.')
  const value = input as Record<string, unknown>
  for (const key of Object.keys(value)) if (!manualKeys.has(key)) throw new Error(`Catalog field "${key}" cannot be set.`)
  for (const key of ['name', 'brand', 'retailer', 'group', 'category', 'width', 'depth', 'height']) {
    if (!Object.hasOwn(value, key)) throw new Error(`${key} is required.`)
  }
  const fields = parseCatalogMetadataOverrides({
    name: value.name, brand: value.brand, retailer: value.retailer, sku: value.sku ?? null,
    group: value.group, category: value.category, width: value.width, depth: value.depth, height: value.height,
    price: value.price ?? null,
  }) as CatalogMetadataOverrides
  if (!catalogHasDimensions(fields as unknown as Record<string, unknown>)) throw new Error('Width, depth, and height must be greater than zero.')
  const optionalUrl = (raw: unknown, label: string) => {
    if (raw == null) return null
    const value = text(raw, label, 2048, false)
    if (!value) return null
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
      return url.toString()
    } catch {
      throw new Error(`${label} must be a valid HTTPS URL.`)
    }
  }
  return { ...fields, sourceUrl: optionalUrl(value.sourceUrl, 'Source URL'), thumbnailUrl: optionalUrl(value.thumbnailUrl, 'Thumbnail URL') }
}

export function parseCatalogArchiveIds(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide catalog product ids.')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== 'ids') || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 500) {
    throw new Error('Provide between 1 and 500 catalog product ids.')
  }
  if (value.ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Catalog product ids are invalid.')
  return [...new Set(value.ids as string[])]
}

export function parseCatalogPermanentDeleteIds(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A permanent-delete request is required.')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== 'ids' && key !== 'confirmation') || value.confirmation !== 'DELETE') throw new Error('Type DELETE to confirm permanent removal.')
  if (!Array.isArray(value.ids)) throw new Error('Provide between 1 and 500 catalog product ids.')
  const ids = parseCatalogArchiveIds({ ids: value.ids })
  if (ids.length !== value.ids.length) throw new Error('Product ids must be unique.')
  if (ids.length > 250) throw new Error('Permanently delete no more than 250 products at a time.')
  return ids
}

export function catalogAssetPrefixFromUrl(value: unknown, productId: string, bucketName: string) {
  if (typeof value !== 'string') return null
  let objectPath: string
  try {
    if (value.startsWith('gs://')) {
      const url = new URL(value)
      if (url.hostname !== bucketName) return null
      objectPath = decodeURIComponent(url.pathname.slice(1))
    } else {
      const url = new URL(value)
      if (url.hostname === 'storage.googleapis.com') {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts.shift() !== bucketName) return null
        objectPath = decodeURIComponent(parts.join('/'))
      } else if (url.hostname === 'firebasestorage.googleapis.com') {
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/)
        if (!match || decodeURIComponent(match[1]) !== bucketName) return null
        objectPath = decodeURIComponent(match[2])
      } else return null
    }
  } catch { return null }
  const [root, brand, id] = objectPath.split('/')
  return root === 'catalog' && brand && id === productId ? `${root}/${brand}/${id}/` : null
}

export function readCatalogMetadataOverrides(value: unknown): CatalogMetadataOverridePatch {
  try { return parseCatalogMetadataOverrides(value) } catch { return {} }
}

export function applyCatalogMetadataOverrides(product: Record<string, unknown>, overrides: CatalogMetadataOverridePatch): Record<string, unknown> {
  return { ...product, ...overrides }
}

export function catalogIsDeleted(edit: Record<string, unknown>) {
  return Boolean(edit.deletedAt)
}

export function catalogIsHidden(edit: Record<string, unknown>) {
  return edit.hidden === true || catalogIsDeleted(edit)
}

export function catalogHasDimensions(product: Record<string, unknown>) {
  return (['width', 'depth', 'height'] as const).every((field) => {
    const value = product[field]
    return typeof value === 'number' && Number.isFinite(value) && value > 0
  })
}
