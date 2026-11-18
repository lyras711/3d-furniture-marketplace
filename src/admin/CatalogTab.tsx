import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { catalogGroups, catalogReviews, type CatalogGroup, type CatalogReview } from '../catalog'
import { ProductThumb } from '../ui'
import { atLeast, errorText, euro, send, type CatalogItem } from './api'

const reviewLabels: Record<CatalogReview, string> = { pending: 'Pending review', approved: 'Approved', 'needs-work': 'Needs work' }
const maxBulkArchive = 500

export default function CatalogTab({ data, role, reload, onError, focus }: TabProps) {
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'listed' | 'hidden' | 'deleted'>('all')
  const [review, setReview] = useState<CatalogReview | 'all'>('all')
  const [retailer, setRetailer] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [archiving, setArchiving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const canReview = atLeast(role, 'editor'), canHide = atLeast(role, 'admin')
  const retailers = useMemo(() => [...new Set(data.catalog.map((item) => item.retailer))].sort(), [data.catalog])
  useEffect(() => {
    if (!focus) return
    const row = document.getElementById(`catalog-${focus}`)
    row?.closest('details')?.setAttribute('open', '')
    row?.scrollIntoView({ block: 'center' })
  }, [focus])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return data.catalog.filter((item) => (visibility === 'all' || (visibility === 'deleted' ? item.deleted : !item.deleted && item.hidden === (visibility === 'hidden'))) && (review === 'all' || item.review === review) && (retailer === 'all' || item.retailer === retailer) && (!term || `${item.name} ${item.brand} ${item.category} ${item.retailer} ${item.sku || ''} ${item.id}`.toLowerCase().includes(term)))
  }, [data.catalog, query, visibility, review, retailer])
  const brandGroups = useMemo(() => {
    const groups = new Map<string, { brand: string; items: CatalogItem[] }>()
    for (const item of filtered) {
      const brand = typeof item.brand === 'string' ? item.brand.trim() || 'Unbranded' : 'Unbranded', key = brand.toLowerCase()
      const group = groups.get(key)
      if (group) group.items.push(item)
      else groups.set(key, { brand, items: [item] })
    }
    return [...groups.values()].sort((left, right) => left.brand.localeCompare(right.brand, undefined, { sensitivity: 'base' }))
  }, [filtered])
  const selectable = filtered.filter((item) => !item.deleted)
  const allVisibleSelected = selectable.length > 0 && selectable.every((item) => selectedIds.has(item.id))
  const clearSelection = () => setSelectedIds(new Set())

  const patch = async (item: CatalogItem, change: { review?: CatalogReview; hidden?: boolean }) => {
    if (change.hidden && !window.confirm(`Hide ${item.name}? Shoppers will no longer find it in the planner. Saved designs that already use it keep showing it.`)) return
    setBusyId(item.id); onError(''); setNotice('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(item.id)}`, 'PUT', change); await reload() } catch (reason) { onError(errorText(reason)) } finally { setBusyId(null) }
  }
  const restore = async (item: CatalogItem) => {
    if (!window.confirm(`Restore ${item.name} to the catalogue?`)) return
    setBusyId(item.id); onError(''); setNotice('')
    try { await send(`/api/admin/catalog/${encodeURIComponent(item.id)}/restore`, 'POST'); await reload() } catch (reason) { onError(errorText(reason)) } finally { setBusyId(null) }
  }
  const toggleProduct = (id: string) => {
    if (!selectedIds.has(id) && selectedIds.size >= maxBulkArchive) { onError(`Archive up to ${maxBulkArchive} products at a time.`); return }
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleVisible = () => {
    if (allVisibleSelected) { clearSelection(); return }
    if (selectable.length > maxBulkArchive) { onError(`Select no more than ${maxBulkArchive} products at a time.`); return }
    setSelectedIds(new Set(selectable.map((item) => item.id)))
  }
  const toggleBrandSelection = (items: CatalogItem[]) => {
    const ids = items.filter((item) => !item.deleted).map((item) => item.id)
    if (!ids.length) return
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
      return
    }
    const newSelectionCount = ids.filter((id) => !selectedIds.has(id)).length
    if (selectedIds.size + newSelectionCount > maxBulkArchive) { onError(`Archive up to ${maxBulkArchive} products at a time.`); return }
    setSelectedIds((current) => new Set([...current, ...ids]))
  }
  const archiveItems = async (items: CatalogItem[], scope: string) => {
    const ids = [...new Set(items.filter((item) => !item.deleted).map((item) => item.id))]
    if (!ids.length) return
    if (ids.length > maxBulkArchive) { onError(`Archive up to ${maxBulkArchive} products at a time.`); return }
    if (!window.confirm(`Archive ${ids.length} ${scope}? This is reversible; product records, uploaded models, textures, and saved-design references will be kept.`)) return
    setArchiving(true); onError(''); setNotice('')
    try {
      const result = await send<{ archived: number; alreadyArchived: number }>('/api/admin/catalog/bulk-archive', 'POST', { ids })
      setSelectedIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setNotice(`${result.archived} product${result.archived === 1 ? '' : 's'} archived. Product records and assets were kept.${result.alreadyArchived ? ` ${result.alreadyArchived} were already archived.` : ''}`)
      await reload()
    } catch (reason) {
      const message = errorText(reason)
      onError(message.toLowerCase() === 'not found.' || message === 'HTTP 404'
        ? 'The bulk-archive route is missing from this admin API. Deploy the latest Cloud Run revision and retry.'
        : message)
    } finally { setArchiving(false) }
  }
  const archiveSelected = () => void archiveItems(filtered.filter((item) => selectedIds.has(item.id)), 'selected products')
  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget), price = String(values.get('price') || '').trim()
    const value = (key: string) => String(values.get(key) || '').trim()
    setCreatingBusy(true); onError(''); setNotice('')
    try {
      const result = await send<{ id: string }>('/api/admin/catalog', 'POST', {
        name: value('name'), brand: value('brand'), retailer: value('retailer'), sku: value('sku') || null,
        group: value('group') as CatalogGroup, category: value('category'),
        width: Number(values.get('width')), depth: Number(values.get('depth')), height: Number(values.get('height')),
        price: price ? Number(price) : null, sourceUrl: value('sourceUrl') || null, thumbnailUrl: value('thumbnailUrl') || null,
      })
      window.location.href = `/admin/catalog/${encodeURIComponent(result.id)}`
    } catch (reason) { onError(errorText(reason)) } finally { setCreatingBusy(false) }
  }

  return <section className="admin-card">
    <div className="admin-toolbar">
      <input type="search" aria-label="Search catalogue" placeholder="Search name, SKU, retailer…" value={query} onChange={(event) => { setQuery(event.target.value); clearSelection() }} />
      <select aria-label="Filter by visibility" value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); clearSelection() }}><option value="all">All products</option><option value="listed">Listed</option><option value="hidden">Hidden</option><option value="deleted">Archived</option></select>
      <select aria-label="Filter by review" value={review} onChange={(event) => { setReview(event.target.value as typeof review); clearSelection() }}><option value="all">Any review state</option>{catalogReviews.map((value) => <option key={value} value={value}>{reviewLabels[value]}</option>)}</select>
      <select aria-label="Filter by retailer" value={retailer} onChange={(event) => { setRetailer(event.target.value); clearSelection() }}><option value="all">All retailers</option>{retailers.map((value) => <option key={value}>{value}</option>)}</select>
      {canHide && <button className="admin-primary-inline" type="button" aria-expanded={creating} onClick={() => setCreating((value) => !value)}>{creating ? 'Close form' : 'Add product'}</button>}
    </div>
    {creating && <section className="admin-card admin-create-product" aria-label="New catalogue product">
      <div className="admin-card-head"><div><span className="admin-eyebrow">Manual entry</span><h2>Add a catalogue product</h2></div></div>
      <p className="admin-help">Enter the product details available to you. New products stay hidden until a GLB is uploaded; positive dimensions are required before listing.</p>
      <form className="admin-form-grid" onSubmit={(event) => void createProduct(event)}>
        <label>Product name<input name="name" maxLength={160} required /></label>
        <label>Brand<input name="brand" maxLength={120} required /></label>
        <label>Retailer<input name="retailer" maxLength={120} required /></label>
        <label>SKU (optional)<input name="sku" maxLength={100} /></label>
        <label>Product group<select name="group" defaultValue="Seating">{catalogGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
        <label>Category<input name="category" maxLength={80} required /></label>
        <label>Width (cm)<input name="width" type="number" min="0.1" max="2000" step="any" required /></label>
        <label>Depth (cm)<input name="depth" type="number" min="0.1" max="2000" step="any" required /></label>
        <label>Height (cm)<input name="height" type="number" min="0.1" max="2000" step="any" required /></label>
        <label>Price (€; optional)<input name="price" type="number" min="0" max="100000000" step="0.01" /></label>
        <label>Source product URL (optional)<input name="sourceUrl" type="url" maxLength={2048} placeholder="https://…" /></label>
        <label>Thumbnail image URL (optional)<input name="thumbnailUrl" type="url" maxLength={2048} placeholder="https://…" /></label>
        <div className="admin-form-submit admin-actions"><button className="admin-primary-inline" type="submit" disabled={creatingBusy}>{creatingBusy ? 'Creating…' : 'Create product'}</button><button className="admin-row-action" type="button" disabled={creatingBusy} onClick={() => setCreating(false)}>Cancel</button></div>
      </form>
    </section>}
    <p className="admin-help">{filtered.length} of {data.catalog.length} products. Admin edits are overrides; archiving hides a product but keeps its record, files, and saved-design references.</p>
    {notice && <p className="admin-help" role="status">{notice}</p>}
    {canHide && <div className="admin-catalog-selection-tools" role="group" aria-label="Catalogue selection">
      <label className="admin-catalog-select-all"><input className="admin-catalog-select" type="checkbox" aria-label="Select all visible products" checked={allVisibleSelected} disabled={!selectable.length || archiving} onChange={toggleVisible} /><span>Select all {selectable.length} visible</span></label>
      {selectedIds.size > 0 && <><span>{selectedIds.size} selected</span><button className="admin-row-danger" type="button" disabled={archiving || creatingBusy} onClick={archiveSelected}>{archiving ? 'Archiving…' : 'Archive selected'}</button><button className="admin-row-action" type="button" disabled={archiving || creatingBusy} onClick={clearSelection}>Clear selection</button></>}
      <small>Brand folders match the current filters. Archive can be reversed; product files are kept. Bulk actions allow up to {maxBulkArchive} products.</small>
    </div>}
    {brandGroups.length ? <div className="admin-catalog-brand-folders">{brandGroups.map((group) => {
      const activeItems = group.items.filter((item) => !item.deleted)
      const allBrandSelected = activeItems.length > 0 && activeItems.every((item) => selectedIds.has(item.id))
      return <details className="admin-catalog-brand-folder" data-brand={group.brand} key={group.brand.toLowerCase()}>
        <summary><span className="admin-catalog-folder-title"><strong>{group.brand}</strong><small>{group.items.length} matching product{group.items.length === 1 ? '' : 's'} · {activeItems.length} active</small></span></summary>
        {canHide && activeItems.length > 0 && <div className="admin-catalog-folder-actions">
          <button className="admin-row-action" type="button" disabled={archiving || activeItems.length > maxBulkArchive} title={activeItems.length > maxBulkArchive ? `Archive up to ${maxBulkArchive} products at a time.` : undefined} onClick={() => toggleBrandSelection(group.items)}>{allBrandSelected ? 'Clear brand selection' : 'Select brand products'}</button>
          <button className="admin-row-danger" type="button" disabled={archiving || activeItems.length > maxBulkArchive} title={activeItems.length > maxBulkArchive ? `Archive up to ${maxBulkArchive} products at a time.` : undefined} onClick={() => void archiveItems(group.items, `active ${group.brand} products shown in this folder`)}>Archive brand ({activeItems.length})</button>
          {activeItems.length > maxBulkArchive && <small>Use selection batches to archive this brand.</small>}
        </div>}
        <div className="admin-table-wrap"><table className={`admin-table admin-catalog-table ${canHide ? 'admin-catalog-table-selectable' : ''}`}><thead><tr>
          {canHide && <th className="admin-catalog-selection-cell" aria-label="Select" />}
          <th>Product</th><th>Retailer · SKU</th><th>Size (cm)</th><th>Price</th><th>Review</th><th>Visibility</th></tr></thead><tbody>{group.items.map((item) => {
          const product = item
          return <tr key={item.id} id={`catalog-${item.id}`} className={`${item.hidden ? 'admin-row-muted' : ''} ${focus === item.id ? 'admin-row-focus' : ''}`} onClick={(event) => {
            if (!(event.target instanceof Element) || event.target.closest('a,button,select,input')) return
            window.location.href = `/admin/catalog/${encodeURIComponent(item.id)}`
          }}>
            {canHide && <td className="admin-catalog-selection-cell"><input className="admin-catalog-select" type="checkbox" aria-label={`Select ${item.name}`} checked={selectedIds.has(item.id)} disabled={item.deleted || archiving} onChange={() => toggleProduct(item.id)} /></td>}
            <td><a className="admin-product-cell admin-product-slot" href={`/admin/catalog/${encodeURIComponent(item.id)}`}>{product && <ProductThumb product={product} compact />}<span><strong>{item.name}</strong><small>{item.brand} · {item.category}{item.variants?.length ? ` · ${item.variants.length} variants` : ''}</small>{item.deleted && <small className="admin-row-error">Archived</small>}<small className="admin-request-catalog-status">{item.status}</small>{item.missingFields?.length ? <small className="admin-row-error">{item.missingFields.length} fields missing</small> : null}</span></a></td>
            <td>{item.retailer}<small className="admin-request-catalog-status">{item.sku || 'SKU missing'}</small></td>
            <td>{item.width || 'Missing'} × {item.depth || 'Missing'} × {item.height || 'Missing'}</td>
            <td>{euro(item.price)}</td>
            <td>{canReview ? <select aria-label={`Review state for ${item.name}`} value={item.review} disabled={busyId === item.id} onChange={(event) => void patch(item, { review: event.target.value as CatalogReview })}>{catalogReviews.map((value) => <option key={value} value={value}>{reviewLabels[value]}</option>)}</select> : <span className={`admin-pill admin-pill-${item.review}`}>{reviewLabels[item.review]}</span>}</td>
            <td>{canHide ? item.deleted ? <button className="admin-row-action" disabled={busyId === item.id} onClick={() => void restore(item)} aria-label={`Restore ${item.name}`}>Restore</button> : <button className={item.hidden ? 'admin-row-action' : 'admin-row-action admin-row-danger'} disabled={busyId === item.id} onClick={() => void patch(item, { hidden: !item.hidden })} aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.name}`}>{item.hidden ? 'Show' : 'Hide'}</button> : <span className="admin-pill">{item.deleted ? 'archived' : item.hidden ? 'hidden' : 'listed'}</span>}</td>
          </tr>
        })}</tbody></table></div>
      </details>
    })}</div> : <p className="admin-empty">{data.catalog.length ? 'No products match these filters.' : 'The catalogue could not be loaded.'}</p>}
  </section>
}
