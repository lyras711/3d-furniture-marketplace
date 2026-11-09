import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { adminTransitionAllowed, purchaseStatuses, type AdminPurchaseRequest, type AdminStatusChange, type AvailabilityUpdate, type PurchaseStatus } from '../purchase'
import { errorText, euro, send, shortDate, time } from './api'

export const orderStatusLabels: Record<PurchaseStatus, string> = {
  pending: 'Check availability',
  'awaiting-user-decision': 'Waiting for shopper',
  'ready-to-place': 'Ready to place',
  placed: 'Placed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  'returned-for-revision': 'Returned to design',
}

const itemCount = (request: AdminPurchaseRequest) => { const count = request.items.reduce((sum, item) => sum + item.quantity, 0); return `${count} ${count === 1 ? 'item' : 'items'}` }

function OrderDetail({ request, reload, onError, onBack }: { request: AdminPurchaseRequest; reload: () => Promise<void>; onError: (message: string) => void; onBack: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, '' | 'available' | 'unavailable'>>({})
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDrafts({}); setCancelling(false); setReason(''); setNote('') }, [request.id])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); onError('')
    try { await work(); await reload(); return true } catch (reason) { onError(errorText(reason)); return false } finally { setBusy(false) }
  }
  const path = `/api/admin/purchase-requests/${encodeURIComponent(request.id)}`
  const saveReview = () => {
    const updates: AvailabilityUpdate[] = []
    for (const item of request.items) {
      const availability = drafts[item.id]
      if (availability !== 'available' && availability !== 'unavailable') { onError('Mark every item available or unavailable before saving.'); return }
      updates.push({ id: item.id, availability })
    }
    void run(() => send(`${path}/availability`, 'PUT', { items: updates }))
  }
  const setStatus = (status: AdminStatusChange, extra: Record<string, string> = {}) => run(() => send(`${path}/status`, 'POST', { status, ...extra }))
  const cancel = (event: FormEvent) => { event.preventDefault(); void setStatus('cancelled', { reason }).then((ok) => { if (ok) setCancelling(false) }) }
  const addNote = (event: FormEvent) => { event.preventDefault(); void run(() => send(`${path}/notes`, 'POST', { text: note })).then((ok) => { if (ok) setNote('') }) }
  const history = [...(request.history || [])].reverse()

  return <article className="admin-card admin-detail" aria-label={`Order ${request.projectName}`}>
    <button className="admin-back" onClick={onBack}>← All orders</button>
    <div className="admin-card-head"><div><span className="admin-eyebrow">Order · {shortDate(request.createdAt)}</span><h2>{request.projectName}</h2></div><em className={`admin-pill admin-pill-${request.status}`}>{orderStatusLabels[request.status]}</em></div>
    <dl className="admin-facts"><div><dt>Customer</dt><dd>{request.customer.name}</dd></div><div><dt>Email</dt><dd><a href={`mailto:${request.customer.email}`}>{request.customer.email}</a></dd></div><div><dt>Phone</dt><dd>{request.customer.phone || '—'}</dd></div><div><dt>City</dt><dd>{request.customer.city}</dd></div><div><dt>Estimate</dt><dd>{request.status === 'cancelled' || request.status === 'returned-for-revision' ? 'Not proceeding' : euro(request.estimatedTotal)}</dd></div><div><dt>Request id</dt><dd><code>{request.id}</code></dd></div></dl>
    {request.customer.notes && <p className="admin-quote">“{request.customer.notes}”</p>}
    {request.cancelReason && <p className="admin-help">Cancellation reason shown to the shopper: {request.cancelReason}</p>}
    <div className="admin-table-wrap"><table className="admin-table admin-order-items"><thead><tr><th>Product</th><th>Retailer</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Availability</th></tr></thead><tbody>{request.items.map((item) => <tr key={item.id} className={item.included ? '' : 'admin-row-muted'}><td>{item.name}{item.variantName ? ` · ${item.variantName}` : ''}<small className="admin-request-catalog-status">{item.catalogStatus}</small></td><td>{item.retailer}</td><td>{item.sku || '—'}</td><td>{item.quantity}</td><td>{item.unitPrice === null ? 'Unverified' : euro(item.unitPrice)}</td><td>{request.status === 'pending' ? <select aria-label={`Availability for ${item.name} ${item.variantName || ''}`.trim()} value={drafts[item.id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value as '' | 'available' | 'unavailable' }))}><option value="">Review…</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select> : <span className={`admin-pill admin-pill-${item.availability}`}>{item.availability}{!item.included ? ' · excluded' : ''}</span>}</td></tr>)}</tbody></table></div>
    <div className="admin-actions admin-order-actions">
      {request.status === 'pending' && <button className="admin-primary-inline" disabled={busy} onClick={saveReview}>Save availability review</button>}
      {adminTransitionAllowed(request.status, 'placed') && <button className="admin-primary-inline" disabled={busy} onClick={() => void setStatus('placed')}>Mark order placed</button>}
      {adminTransitionAllowed(request.status, 'delivered') && <button className="admin-primary-inline" disabled={busy} onClick={() => void setStatus('delivered')}>Mark delivered</button>}
      {adminTransitionAllowed(request.status, 'cancelled') && !cancelling && <button className="admin-row-danger" disabled={busy} onClick={() => setCancelling(true)}>Cancel request</button>}
    </div>
    {request.status === 'ready-to-place' && <p className="admin-help">Mark placed only after you have contacted the retailer and placed the order by hand.</p>}
    {cancelling && <form className="admin-inline-form" onSubmit={cancel}><label>Reason shown to the shopper<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} required rows={2} /></label><div className="admin-actions"><button className="admin-row-danger" disabled={busy}>Confirm cancellation</button><button type="button" onClick={() => setCancelling(false)}>Keep request</button></div></form>}
    <div className="admin-two-col admin-detail-cols">
      <section><h3>Internal notes</h3><p className="admin-help">Only admins see these.</p>
        {request.adminNotes.length ? <ul className="admin-timeline">{[...request.adminNotes].reverse().map((item) => <li key={item.id}><p>{item.text}</p><small>{item.authorEmail} · {time(item.at)}</small></li>)}</ul> : <p className="admin-empty">No notes yet.</p>}
        <form className="admin-inline-form" onSubmit={addNote}><label>Add a note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} required rows={2} placeholder="Called retailer, delivery in week 48…" /></label><button className="admin-row-action" disabled={busy}>Add note</button></form>
      </section>
      <section><h3>History</h3>
        {history.length ? <ul className="admin-timeline">{history.map((entry, index) => <li key={`${entry.at}-${index}`}><p>{orderStatusLabels[entry.status]}{entry.note ? ` — ${entry.note}` : ''}</p><small>{entry.by === 'admin' ? 'Formivo team' : 'Shopper'} · {time(entry.at)}</small></li>)}</ul> : <p className="admin-empty">Requests created before history tracking show no timeline. Created {time(request.createdAt)}.</p>}
      </section>
    </div>
  </article>
}

export default function OrdersTab({ data, reload, onError, focus }: TabProps) {
  const [status, setStatus] = useState<PurchaseStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(focus)
  useEffect(() => { if (focus) setSelectedId(focus) }, [focus])
  const counts = useMemo(() => Object.fromEntries(purchaseStatuses.map((value) => [value, data.requests.filter((request) => request.status === value).length])) as Record<PurchaseStatus, number>, [data.requests])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return data.requests.filter((request) => (status === 'all' || request.status === status) && (!term || `${request.id} ${request.projectName} ${request.customer.name} ${request.customer.email} ${request.customer.city} ${request.items.map((item) => `${item.name} ${item.retailer} ${item.sku || ''}`).join(' ')}`.toLowerCase().includes(term)))
  }, [data.requests, query, status])
  const selected = data.requests.find((request) => request.id === selectedId) || null

  return <div className={`admin-split ${selected ? 'admin-split-open' : ''}`}>
    <section className="admin-card admin-list-pane">
      <div className="admin-toolbar"><input type="search" aria-label="Search orders" placeholder="Search customer, project, product…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="admin-chips" role="group" aria-label="Filter orders by status"><button aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All <b>{data.requests.length}</b></button>{purchaseStatuses.map((value) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{orderStatusLabels[value]} <b>{counts[value]}</b></button>)}</div>
      {filtered.length ? <div className="admin-catalog-list">{filtered.map((request) => <button className={`admin-list-row ${request.id === selectedId ? 'admin-list-row-selected' : ''}`} key={request.id} onClick={() => setSelectedId(request.id)}><span><strong>{request.projectName}</strong><small>{request.customer.name} · {request.customer.city} · {shortDate(request.createdAt)}</small><small>{itemCount(request)} · {euro(request.estimatedTotal)}</small></span><em className={`admin-pill admin-pill-${request.status}`}>{orderStatusLabels[request.status]}</em></button>)}</div> : <p className="admin-empty">{data.requests.length ? 'No orders match these filters.' : 'No purchase requests yet.'}</p>}
    </section>
    {selected ? <OrderDetail request={selected} reload={reload} onError={onError} onBack={() => setSelectedId(null)} /> : <section className="admin-card admin-detail-empty"><p className="admin-empty">Select an order to review availability, record placement or delivery, and keep notes.</p></section>}
  </div>
}
