import { useEffect, useMemo, useState } from 'react'
import type { TabProps } from '../Admin'
import { catalogReviews, products, type CatalogReview } from '../catalog'
import { ProductThumb } from '../ui'
import { atLeast, errorText, euro, send, type CatalogItem } from './api'

const bundled = new Map(products.map((product) => [product.id, product]))
const reviewLabels: Record<CatalogReview, string> = { pending: 'Pending review', approved: 'Approved', 'needs-work': 'Needs work' }

export default function CatalogTab({ data, role, reload, onError, focus }: TabProps) {
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'listed' | 'hidden'>('all')
  const [review, setReview] = useState<CatalogReview | 'all'>('all')
  const [retailer, setRetailer] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const canReview = atLeast(role, 'editor'), canHide = atLeast(role, 'admin')
  const retailers = useMemo(() => [...new Set(data.catalog.map((item) => item.retailer))].sort(), [data.catalog])
  useEffect(() => { if (focus) document.getElementById(`catalog-${focus}`)?.scrollIntoView({ block: 'center' }) }, [focus])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return data.catalog.filter((item) => (visibility === 'all' || item.hidden === (visibility === 'hidden')) && (review === 'all' || item.review === review) && (retailer === 'all' || item.retailer === retailer) && (!term || `${item.name} ${item.brand} ${item.category} ${item.retailer} ${item.sku || ''} ${item.id}`.toLowerCase().includes(term)))
  }, [data.catalog, query, visibility, review, retailer])

  const patch = async (item: CatalogItem, change: { review?: CatalogReview; hidden?: boolean }) => {
    if (change.hidden && !window.confirm(`Hide ${item.name}? Shoppers will no longer find it in the planner. Saved designs that already use it keep showing it.`)) return
    setBusyId(item.id); onError('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(item.id)}`, 'PUT', change); await reload() } catch (reason) { onError(errorText(reason)) } finally { setBusyId(null) }
  }

  return <section className="admin-card">
    <div className="admin-toolbar">
      <input type="search" aria-label="Search catalogue" placeholder="Search name, SKU, retailer…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Filter by visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="all">Listed and hidden</option><option value="listed">Listed</option><option value="hidden">Hidden</option></select>
      <select aria-label="Filter by review" value={review} onChange={(event) => setReview(event.target.value as typeof review)}><option value="all">Any review state</option>{catalogReviews.map((value) => <option key={value} value={value}>{reviewLabels[value]}</option>)}</select>
      <select aria-label="Filter by retailer" value={retailer} onChange={(event) => setRetailer(event.target.value)}><option value="all">All retailers</option>{retailers.map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <p className="admin-help">{filtered.length} of {data.catalog.length} products. Names, prices and dimensions come from partners and are read-only here.</p>
    {filtered.length ? <div className="admin-table-wrap"><table className="admin-table admin-catalog-table"><thead><tr><th>Product</th><th>Retailer · SKU</th><th>Size (cm)</th><th>Price</th><th>Review</th><th>Visibility</th></tr></thead><tbody>{filtered.map((item) => {
      const product = bundled.get(item.id)
      return <tr key={item.id} id={`catalog-${item.id}`} className={`${item.hidden ? 'admin-row-muted' : ''} ${focus === item.id ? 'admin-row-focus' : ''}`}>
        <td><div className="admin-product-cell">{product && <ProductThumb product={product} compact />}<span><strong>{item.name}</strong><small>{item.brand} · {item.category}{item.variantCount ? ` · ${item.variantCount} colours` : ''}</small><small className="admin-request-catalog-status">{item.status}</small></span></div></td>
        <td>{item.retailer}<small className="admin-request-catalog-status">{item.sku || 'SKU missing'}</small></td>
        <td>{item.width} × {item.depth} × {item.height}</td>
        <td>{euro(item.price)}</td>
        <td>{canReview ? <select aria-label={`Review state for ${item.name}`} value={item.review} disabled={busyId === item.id} onChange={(event) => void patch(item, { review: event.target.value as CatalogReview })}>{catalogReviews.map((value) => <option key={value} value={value}>{reviewLabels[value]}</option>)}</select> : <span className={`admin-pill admin-pill-${item.review}`}>{reviewLabels[item.review]}</span>}</td>
        <td>{canHide ? <button className={item.hidden ? 'admin-row-action' : 'admin-row-action admin-row-danger'} disabled={busyId === item.id} onClick={() => void patch(item, { hidden: !item.hidden })} aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.name}`}>{item.hidden ? 'Show' : 'Hide'}</button> : <span className="admin-pill">{item.hidden ? 'hidden' : 'listed'}</span>}</td>
      </tr>
    })}</tbody></table></div> : <p className="admin-empty">{data.catalog.length ? 'No products match these filters.' : 'The catalogue could not be loaded.'}</p>}
  </section>
}
