import { useEffect, useSyncExternalStore } from 'react'
import { products } from './catalog'

let listed = products, started = false
const listeners = new Set<() => void>()

/** Fetches admin-hidden product ids once. Hidden products leave the catalogue lists but keep rendering in saved designs. */
function loadCatalogVisibility() {
  if (started) return
  started = true
  fetch('/api/catalog/visibility').then((response) => response.ok ? response.json() : null).then((value: { hidden?: unknown } | null) => {
    if (!Array.isArray(value?.hidden) || !value.hidden.length) return
    const hidden = new Set(value.hidden.filter((id): id is string => typeof id === 'string'))
    listed = products.filter((product) => !hidden.has(product.id))
    listeners.forEach((listener) => listener())
  }).catch(() => {})
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useListedProducts() {
  useEffect(loadCatalogVisibility, [])
  return useSyncExternalStore(subscribe, () => listed)
}
