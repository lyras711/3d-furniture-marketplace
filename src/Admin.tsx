import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, firebaseConfigured, keepAdminSession } from './firebase'
import type { AdminMetrics, AvailabilityUpdate, PurchaseRequest } from './purchase'
import './admin.css'

type ItemStatus = 'queued' | 'scraping' | 'skipped-existing' | 'needs-model-recipe' | 'generated' | 'failed'
type CrawlItem = { url: string; status: ItemStatus; sku: string | null; productId: string | null; artifactRoot: string | null; error: string | null; updatedAt: string }
type Job = { id: string; siteUrl: string; retailerId: string; maxProducts: number; delayMs: number; status: string; discoveredUrls: string[]; items: CrawlItem[]; currentUrl: string | null; error: string | null; createdAt: string; updatedAt: string }
type CatalogItem = { id: string; sku: string | null; name: string; brand?: string; retailer: string; status: string; price?: number | null; modelPath: string | null; verification?: { dimensions: string; model: string; humanReview: string } }
type AdminUser = { uid: string; email: string; role: string; status: string }
type AuditEntry = { id: string; actorEmail: string; action: string; target: string; createdAt?: { _seconds?: number } }

const api = ''

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await auth?.currentUser?.getIdToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

const active = new Set(['queued', 'discovering', 'running'])
const roleRank: Record<string, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

function statusLabel(value: string) { return value.replaceAll('-', ' ') }
function time(value: string) { return new Date(value).toLocaleString() }
function estimateLabel(request: PurchaseRequest) { return request.status === 'returned-for-revision' ? 'Not proceeding' : request.estimatedTotal === null ? 'Price pending' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(request.estimatedTotal) }

export default function Admin() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [siteUrl, setSiteUrl] = useState('https://www.polihome.gr/el')
  const [maxProducts, setMaxProducts] = useState('100')
  const [delayMs, setDelayMs] = useState('1000')
  const [jobs, setJobs] = useState<Job[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [adminRole, setAdminRole] = useState<string | null>(null)
  const [accessChecked, setAccessChecked] = useState(false)
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [availabilityDrafts, setAvailabilityDrafts] = useState<Record<string, Record<string, '' | 'available' | 'unavailable'>>>({})
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState('editor')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selected = jobs.find((job) => job.id === selectedId) || jobs[0] || null
  const counts = useMemo(() => selected?.items.reduce<Record<string, number>>((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result }, {}) || {}, [selected])
  const requestTotal = metrics ? Object.values(metrics.requestsByStatus).reduce((sum, count) => sum + count, 0) : 0

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    void keepAdminSession()
    return onAuthStateChanged(auth, (next) => {
      setUser(next && !next.isAnonymous ? next : null); setAuthReady(true); setAccessChecked(false); setAdminRole(null)
      setJobs([]); setCatalog([]); setRequests([]); setMetrics(null); setUsers([]); setAudit([])
    })
  }, [])

  const refreshJobs = async () => {
    try {
      const response = await authFetch(`${api}/api/admin/jobs`)
      if (!response.ok) return
      const next = await response.json() as Job[]
      setJobs(next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setSelectedId((current) => current || next[0]?.id || null)
    } catch {}
  }

  const load = async () => {
    try {
      const meResponse = await authFetch(`${api}/api/admin/me`)
      if (!meResponse.ok) throw new Error((await meResponse.json()).error || `HTTP ${meResponse.status}`)
      const me = await meResponse.json() as { role: string }
      setAdminRole(me.role); setAccessChecked(true)
      const response = await authFetch(`${api}/api/admin/jobs`)
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`)
      const next = await response.json() as Job[]
      setJobs(next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setSelectedId((current) => current || next[0]?.id || null)
      const catalogResponse = await authFetch(`${api}/api/admin/catalog`)
      if (catalogResponse.ok) setCatalog(((await catalogResponse.json()).products || []) as CatalogItem[])
      if (roleRank[me.role] >= roleRank.admin) {
        const [usersResponse, auditResponse, requestResponse, metricsResponse] = await Promise.all([authFetch(`${api}/api/admin/users`), authFetch(`${api}/api/admin/audit`), authFetch(`${api}/api/admin/purchase-requests`), authFetch(`${api}/api/admin/metrics`)])
        if (usersResponse.ok) setUsers(await usersResponse.json() as AdminUser[])
        if (auditResponse.ok) setAudit(await auditResponse.json() as AuditEntry[])
        if (requestResponse.ok) setRequests(await requestResponse.json() as PurchaseRequest[])
        if (metricsResponse.ok) setMetrics(await metricsResponse.json() as AdminMetrics)
      } else { setUsers([]); setAudit([]); setRequests([]); setMetrics(null) }
      setError('')
    } catch (reason) {
      setAccessChecked(true); setAdminRole(null)
      setError(reason instanceof Error ? reason.message : 'Admin API unavailable. Start npm run admin:server.')
    }
  }

  useEffect(() => { if (user) void load() }, [user])
  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => { if (jobs.some((job) => active.has(job.status))) void refreshJobs() }, 2000)
    return () => window.clearInterval(timer)
  }, [jobs, user])

  const start = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const response = await authFetch(`${api}/api/admin/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteUrl, maxProducts: Number(maxProducts), delayMs: Number(delayMs) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
      setSelectedId(result.id); await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }

  const action = async (id: string, kind: 'cancel' | 'retry') => {
    const response = await authFetch(`${api}/api/admin/jobs/${id}/${kind}`, { method: 'POST' })
    if (!response.ok) setError((await response.json()).error || `Could not ${kind} job.`)
    await load()
  }

  const editCatalog = async (item: CatalogItem) => {
    const name = window.prompt('Catalog name', item.name)
    if (!name || name === item.name) return
    const response = await authFetch(`${api}/api/admin/catalog/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    if (!response.ok) setError((await response.json()).error || 'Catalog update failed.')
    await load()
  }

  const deleteCatalog = async (item: CatalogItem) => {
    if (!window.confirm(`Hide ${item.name} from the catalog?`)) return
    const response = await authFetch(`${api}/api/admin/catalog/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    if (!response.ok) setError((await response.json()).error || 'Catalog delete failed.')
    await load()
  }

  const addUser = async (event: FormEvent) => {
    event.preventDefault()
    const response = await authFetch(`${api}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: newUserEmail, role: newUserRole }) })
    if (!response.ok) setError((await response.json()).error || 'Role update failed.')
    setNewUserEmail(''); await load()
  }

  const revokeUser = async (target: AdminUser) => {
    if (!window.confirm(`Revoke ${target.email}?`)) return
    const response = await authFetch(`${api}/api/admin/users/${encodeURIComponent(target.uid)}`, { method: 'DELETE' })
    if (!response.ok) setError((await response.json()).error || 'Role revoke failed.')
    await load()
  }

  const reviewAvailability = async (request: PurchaseRequest) => {
    const updates: AvailabilityUpdate[] = []
    for (const item of request.items) {
      const availability = availabilityDrafts[request.id]?.[item.id] || (item.availability === 'pending' ? '' : item.availability)
      if (availability !== 'available' && availability !== 'unavailable') { setError('Mark every item available or unavailable before saving.'); return }
      updates.push({ id: item.id, availability })
    }
    setRequestBusyId(request.id); setError('')
    try {
      const response = await authFetch(`${api}/api/admin/purchase-requests/${encodeURIComponent(request.id)}/availability`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: updates }) })
      if (!response.ok) throw new Error((await response.json()).error || 'Availability review failed.')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Availability review failed.') }
    finally { setRequestBusyId(null) }
  }

  const markOrderPlaced = async (request: PurchaseRequest) => {
    setRequestBusyId(request.id); setError('')
    try {
      const response = await authFetch(`${api}/api/admin/purchase-requests/${encodeURIComponent(request.id)}/placed`, { method: 'POST' })
      if (!response.ok) throw new Error((await response.json()).error || 'Could not mark this order as placed.')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not mark this order as placed.') }
    finally { setRequestBusyId(null) }
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setError('')
    try { if (!auth) throw new Error('Firebase Auth is not configured. Set the VITE_FIREBASE_* values before using /admin.'); await signInWithEmailAndPassword(auth, email, password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setAuthBusy(false) }
  }

  if (!authReady) return <div className="admin-auth-shell"><div className="admin-auth-card"><span className="admin-eyebrow">Formivo admin dashboard</span><h1>Checking access…</h1></div></div>
  if (!firebaseConfigured || !auth || !user) return <div className="admin-auth-shell"><form className="admin-auth-card" onSubmit={signIn}><a className="admin-brand" href="/">FORMIVO</a><span className="admin-eyebrow">Protected admin</span><h1>Sign in to the admin dashboard.</h1>{!firebaseConfigured && <p className="admin-error">Firebase Auth is not configured for this deployment.</p>}<label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{error && <p className="admin-error">{error}</p>}<button className="admin-primary" disabled={authBusy || !firebaseConfigured}>{authBusy ? 'Signing in…' : 'Sign in'}</button><p className="admin-help">Access is granted only to users with an admin role in Firebase.</p></form></div>

  if (!accessChecked) return <div className="admin-auth-shell"><div className="admin-auth-card"><span className="admin-eyebrow">Protected admin</span><h1>Checking role…</h1></div></div>
  if (!adminRole) return <div className="admin-auth-shell"><div className="admin-auth-card"><a className="admin-brand" href="/">FORMIVO</a><span className="admin-eyebrow">Protected admin</span><h1>Admin access is required.</h1><p className="admin-error">{error || 'This account does not have an admin role.'}</p><button className="admin-primary" onClick={() => { if (auth) void signOut(auth) }}>Sign out</button></div></div>

  return <div className="admin-shell">
    <header className="admin-header"><div><a href="/" className="admin-brand">FORMIVO</a><span className="admin-divider" /><span className="admin-kicker">PLATFORM OPERATIONS</span></div><nav><a href="/planner">Open planner</a><a href="/profile">Profile</a><a className="admin-active" href="/admin">Admin</a><span className="admin-user">{user.email}</span><button className="admin-signout" onClick={() => signOut(auth!)}>Sign out</button></nav></header>
    <main className="admin-main">
      <section className="admin-hero"><div><span className="admin-eyebrow">Controlled ingestion</span><h1>Bring a retailer catalogue into Formivo.</h1><p>Discover product URLs, skip known SKUs, generate supported models, validate exported GLBs, and keep every intermediate artifact for review.</p></div><div className="admin-warning"><strong>Internal prototype</strong><span>Use only with permission. Requests are rate-limited and capped per job.</span></div></section>
      {roleRank[adminRole] >= roleRank.admin && metrics && <section className="admin-card admin-overview"><div className="admin-card-head"><div><span className="admin-eyebrow">00 / Platform health</span><h2>Editor overview</h2></div><span className="admin-muted">{catalog.length} catalog products</span></div><div className="admin-stat-grid admin-metrics-grid"><div><strong>{metrics.savedProjects}</strong><span>saved designs</span></div><div><strong>{requestTotal}</strong><span>purchase requests</span></div><div><strong>{metrics.requestsByStatus.pending}</strong><span>pending review</span></div><div><strong>{metrics.requestsByStatus['awaiting-user-decision']}</strong><span>waiting for user</span></div><div><strong>{metrics.requestsByStatus['ready-to-place']}</strong><span>ready to place</span></div><div><strong>{metrics.requestsByStatus.placed}</strong><span>orders marked placed</span></div></div><p className="admin-help">Operational counts from saved designs and requests. No third-party click tracking is enabled.</p></section>}
      {roleRank[adminRole] >= roleRank.admin && <section className="admin-card admin-items admin-requests"><div className="admin-card-head"><div><span className="admin-eyebrow">00 / Customer requests</span><h2>Purchase request queue</h2></div><button className="admin-refresh" onClick={() => void load()}>Refresh</button></div>{requests.length ? <div className="admin-request-list">{requests.map((request) => <article className="admin-request-card" key={request.id}><div className="admin-request-head"><span><strong>{request.projectName}</strong><small>{request.customer.name} · {request.customer.email} · {request.customer.city}</small><small>{time(request.createdAt)} · Estimate {estimateLabel(request)}</small></span><em className={`admin-pill admin-pill-${request.status}`}>{statusLabel(request.status)}</em></div>{request.customer.phone && <p className="admin-help">Phone: {request.customer.phone}</p>}{request.customer.notes && <p className="admin-help">Notes: {request.customer.notes}</p>}<div className="admin-table-wrap"><table><thead><tr><th>Product</th><th>Retailer</th><th>SKU</th><th>Qty</th><th>Unit estimate</th><th>Availability</th></tr></thead><tbody>{request.items.map((item) => <tr key={item.id}><td>{item.name}{item.variantName ? ` · ${item.variantName}` : ''}<small className="admin-request-catalog-status">{item.catalogStatus}</small></td><td>{item.retailer}</td><td>{item.sku || '—'}</td><td>{item.quantity}</td><td>{item.unitPrice === null ? 'Unverified' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(item.unitPrice)}</td><td>{request.status === 'pending' ? <select aria-label={`Availability for ${item.name} ${item.variantName || ''}`} value={availabilityDrafts[request.id]?.[item.id] || ''} onChange={(event) => setAvailabilityDrafts((current) => ({ ...current, [request.id]: { ...current[request.id], [item.id]: event.target.value as 'available' | 'unavailable' | '' } }))}><option value="">Review…</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select> : item.availability === 'pending' ? 'Pending' : item.availability}</td></tr>)}</tbody></table></div>{request.status === 'pending' && <div className="admin-request-actions"><p className="admin-help">Check each retailer manually, then save the availability results.</p><button className="admin-primary" disabled={requestBusyId === request.id} onClick={() => void reviewAvailability(request)}>{requestBusyId === request.id ? 'Saving…' : 'Save availability review'}</button></div>}{request.status === 'awaiting-user-decision' && <p className="admin-help">Waiting for the user to accept the available items or return to their design.</p>}{request.status === 'ready-to-place' && <div className="admin-request-actions"><p className="admin-help">Availability is confirmed. Contact the retailer and place the order before recording it here.</p><button className="admin-primary" disabled={requestBusyId === request.id} onClick={() => void markOrderPlaced(request)}>Record retailer order placed</button></div>}{request.status === 'returned-for-revision' && <p className="admin-help">The user returned to the design instead of proceeding with partial availability.</p>}{request.status === 'placed' && <p className="admin-help">Marked placed {request.placedAt ? `on ${time(request.placedAt)}` : ''}. This is an admin record of manual retailer fulfillment.</p>}</article>)}</div> : <p className="admin-empty">No purchase requests yet.</p>}</section>}
      <section className="admin-grid">
        <form className="admin-card admin-start" onSubmit={start}><div className="admin-card-head"><div><span className="admin-eyebrow">01 / Start a job</span><h2>Scan a brand site</h2></div><span className="admin-status-dot" /></div><label>Brand website<input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://www.example.com" type="url" required /></label><div className="admin-fields"><label>Maximum products<input value={maxProducts} onChange={(event) => setMaxProducts(event.target.value)} type="number" min="1" max="100" /></label><label>Delay between pages<input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} type="number" min="250" step="250" /></label></div><p className="admin-help">Default: 100 product URLs, one request per second. The current adapter supports Polihome. Other retailers need an adapter before extraction is trusted.</p><button className="admin-primary" disabled={loading}>{loading ? 'Starting…' : 'Start controlled crawl'}</button></form>
        <section className="admin-card admin-stats"><div className="admin-card-head"><div><span className="admin-eyebrow">02 / Current job</span><h2>{selected ? selected.siteUrl : 'No job selected'}</h2></div>{selected && <span className={`admin-pill admin-pill-${selected.status}`}>{statusLabel(selected.status)}</span>}</div>{selected ? <><div className="admin-stat-grid"><div><strong>{selected.discoveredUrls.length}</strong><span>discovered</span></div><div><strong>{counts.generated || 0}</strong><span>generated</span></div><div><strong>{counts['skipped-existing'] || 0}</strong><span>existing SKU</span></div><div><strong>{counts.failed || 0}</strong><span>failed</span></div></div><div className="admin-progress"><span style={{ width: `${selected.items.length ? Math.round(selected.items.filter((item) => !['queued', 'scraping'].includes(item.status)).length / selected.items.length * 100) : 0}%` }} /></div><p className="admin-help">Updated {time(selected.updatedAt)}{selected.currentUrl ? ` · processing ${selected.currentUrl}` : ''}</p>{selected.status === 'failed' && <p className="admin-error">{selected.error}</p>}<div className="admin-actions">{active.has(selected.status) && <button onClick={() => action(selected.id, 'cancel')}>Cancel job</button>}{!active.has(selected.status) && <button onClick={() => action(selected.id, 'retry')}>Retry as new job</button>}</div></> : <p className="admin-empty">Start a job to see discovery and generation progress here.</p>}</section>
      </section>
      {error && <p className="admin-error admin-global-error">{error}</p>}
      <section className="admin-card admin-jobs"><div className="admin-card-head"><div><span className="admin-eyebrow">03 / History</span><h2>Ingestion jobs</h2></div><button className="admin-refresh" onClick={() => load()}>Refresh</button></div>{jobs.length ? <div className="admin-job-list">{jobs.map((job) => <button className={`admin-job ${job.id === selected?.id ? 'admin-job-selected' : ''}`} key={job.id} onClick={() => setSelectedId(job.id)}><span><strong>{job.siteUrl}</strong><small>{time(job.createdAt)} · cap {job.maxProducts}</small></span><span><b>{job.items.filter((item) => item.status === 'generated').length}/{job.items.length}</b><em className={`admin-pill admin-pill-${job.status}`}>{statusLabel(job.status)}</em></span></button>)}</div> : <p className="admin-empty">No ingestion jobs yet.</p>}</section>
      <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">04 / Registered catalogue</span><h2>Catalog products</h2></div><span className="admin-muted">{catalog.length} products</span></div>{catalog.length ? <div className="admin-catalog-list">{catalog.map((item) => <div className="admin-catalog-row" key={item.id}><span><strong>{item.name}</strong><small>{item.retailer} · SKU {item.sku || 'missing'}</small></span><span><em className="admin-pill">{item.verification?.dimensions || 'pending'}</em><em className="admin-pill">{item.verification?.humanReview || 'pending'}</em><button className="admin-row-action" onClick={() => editCatalog(item)}>Edit</button><button className="admin-row-action admin-row-danger" onClick={() => deleteCatalog(item)}>Hide</button></span></div>)}</div> : <p className="admin-empty">The catalog is empty.</p>}</section>
      {roleRank[adminRole] >= roleRank.admin && <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">05 / Roles</span><h2>Admin users</h2></div><span className="admin-muted">{users.length} accounts</span></div><form className="admin-user-form" onSubmit={addUser}><input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} type="email" placeholder="user@example.com" required /><select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button className="admin-row-action">Grant role</button></form>{users.length ? <div className="admin-catalog-list">{users.map((item) => <div className="admin-catalog-row" key={item.uid}><span><strong>{item.email}</strong><small>{item.uid}</small></span><span><em className="admin-pill">{item.role}</em><button className="admin-row-action admin-row-danger" onClick={() => revokeUser(item)}>Revoke</button></span></div>)}</div> : <p className="admin-empty">Only configured Firebase owners appear here after Firebase Admin credentials are set.</p>}</section>}
      {roleRank[adminRole] >= roleRank.admin && <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">06 / Audit history</span><h2>Admin changes</h2></div><span className="admin-muted">{audit.length} events</span></div>{audit.length ? <div className="admin-catalog-list">{audit.slice(0, 25).map((item) => <div className="admin-catalog-row" key={item.id}><span><strong>{item.action}</strong><small>{item.actorEmail} · {item.target}</small></span></div>)}</div> : <p className="admin-empty">No admin changes recorded.</p>}</section>}
      {selected && <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">04 / Product queue</span><h2>Discovered products</h2></div><span className="admin-muted">{selected.items.length} items</span></div>{selected.items.length ? <div className="admin-table-wrap"><table><thead><tr><th>URL</th><th>SKU</th><th>Status</th><th>Artifact</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.url}><td>{item.url}</td><td>{item.sku || '—'}</td><td><span className={`admin-pill admin-pill-${item.status}`}>{statusLabel(item.status)}</span>{item.error && <small className="admin-row-error">{item.error}</small>}</td><td>{item.artifactRoot || '—'}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Product discovery has not started.</p>}</section>}
    </main>
  </div>
}
