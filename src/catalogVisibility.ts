import { useEffect, useSyncExternalStore } from 'react'
import { products } from './catalog'
import { replaceCatalogProducts } from './editor'

let listed = products, started = false
let bootstrap: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Loads dynamic products before project validation and keeps hidden products resolvable in saved designs. */
export function bootstrapCatalogProducts() {
  if (bootstrap) return bootstrap
  started = true
  bootstrap = fetch('/api/catalog/products', { signal: AbortSignal.timeout(1800) })
    .then((response) => response.ok ? response.json() : null)
    .then((value: { products?: unknown; hidden?: unknown } | null) => {
    if (!Array.isArray(value?.products)) return
    const all = value.products.filter((item): item is typeof products[number] => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
    const hidden = new Set(Array.isArray(value.hidden) ? value.hidden.filter((id): id is string => typeof id === 'string') : [])
    replaceCatalogProducts(all)
    listed = all.filter((product) => !hidden.has(product.id))
    listeners.forEach((listener) => listener())
  }).catch(() => {})
  return bootstrap
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useListedProducts() {
  useEffect(() => { if (!started) void bootstrapCatalogProducts() }, [])
  return useSyncExternalStore(subscribe, () => listed)
}
