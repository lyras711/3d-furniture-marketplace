import { useEffect, useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, firebaseConfigured, keepAdminSession } from './firebase'
import { accountApi, type SavedProject } from './account'
import { activePurchaseStatuses, type PurchaseRequest, type PurchaseStatus } from './purchase'
import './profile.css'

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const statusLabels: Record<PurchaseStatus, string> = {
  pending: 'Pending review',
  'awaiting-user-decision': 'Your decision needed',
  'ready-to-place': 'Availability confirmed',
  'returned-for-revision': 'Returned to your design',
  placed: 'Order placed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}
const readableTime = (value: string) => new Date(value).toLocaleString()
const estimateLabel = (request: PurchaseRequest) => request.status === 'returned-for-revision' ? 'Not proceeding' : request.status === 'cancelled' ? 'Cancelled' : request.estimatedTotal === null ? 'Price pending' : euro.format(request.estimatedTotal)

export default function Profile() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!auth)
  const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const hasActiveRequest = (projectId: string) => requests.some((request) => request.projectId === projectId && activePurchaseStatuses.includes(request.status))

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    void keepAdminSession()
    return onAuthStateChanged(auth, (next) => { setUser(next && !next.isAnonymous ? next : null); setAuthReady(true) })
  }, [])

  useEffect(() => {
    if (!user) return
    const returnTo = new URLSearchParams(window.location.search).get('returnTo')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) window.location.replace(returnTo)
  }, [user])

  useEffect(() => {
    if (!user) { setProjects([]); setRequests([]); return }
    let current = true
    setLoading(true); setError('')
    Promise.all([accountApi<SavedProject[]>('/projects'), accountApi<PurchaseRequest[]>('/purchase-requests')])
      .then(([nextProjects, nextRequests]) => { if (current) { setProjects(nextProjects); setRequests(nextRequests) } })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load your profile.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [user, reload])

  const authenticate = async (event: FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setError('')
    try {
      if (!auth) throw new Error('Firebase Authentication is not configured for this deployment.')
      if (mode === 'create') await createUserWithEmailAndPassword(auth, email.trim(), password)
      else await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed.') }
    finally { setAuthBusy(false) }
  }

  const renameProject = async (project: SavedProject) => {
    const name = rename.trim()
    if (!name || name.length > 80) { setError('Use a project name between 1 and 80 characters.'); return }
    setBusyId(project.id); setError('')
    try {
      await accountApi(`/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: JSON.stringify({ name }) })
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name } : item))
      setEditingId(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not rename this project.') }
    finally { setBusyId(null) }
  }

  const deleteProject = async (project: SavedProject) => {
    if (hasActiveRequest(project.id)) { setError('Resolve the active purchase request before deleting this space.'); return }
    if (!window.confirm(`Delete “${project.name}” from your profile?`)) return
    setBusyId(project.id); setError('')
    try {
      await accountApi(`/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
      setProjects((current) => current.filter((item) => item.id !== project.id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this project.') }
    finally { setBusyId(null) }
  }

  const decide = async (request: PurchaseRequest, decision: 'proceed' | 'revise') => {
    setBusyId(request.id); setError('')
    try {
      await accountApi(`/purchase-requests/${encodeURIComponent(request.id)}/decision`, { method: 'POST', body: JSON.stringify({ decision }) })
      if (decision === 'revise') window.location.assign(`/planner?projectId=${encodeURIComponent(request.projectId)}`)
      else setReload((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this request.') }
    finally { setBusyId(null) }
  }

  if (!authReady) return <div className="profile-shell"><main className="profile-main"><p role="status">Checking your account…</p></main></div>
  if (!firebaseConfigured || !auth) return <div className="profile-shell"><header className="profile-header"><a className="profile-brand" href="/">FORMIVO</a><a href="/planner">Open planner</a></header><main className="profile-main"><section className="profile-auth-card"><span className="profile-eyebrow">Your Formivo account</span><h1>Save your spaces across devices.</h1><p>Account sign-in is not configured for this deployment. Your current editor still saves on this device.</p><a className="profile-primary" href="/planner">Continue to planner</a></section></main></div>
  if (!user) return <div className="profile-shell"><header className="profile-header"><a className="profile-brand" href="/">FORMIVO</a><a href="/planner">Open planner</a></header><main className="profile-main"><section className="profile-auth-card"><span className="profile-eyebrow">Your Formivo account</span><h1>{mode === 'create' ? 'Create your profile.' : 'Welcome back.'}</h1><p>Sign in to save your room designs and track purchase requests.</p><form className="profile-auth-form" onSubmit={authenticate}><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="profile-error" role="alert">{error}</p>}<button className="profile-primary" disabled={authBusy}>{authBusy ? 'Working…' : mode === 'create' ? 'Create account' : 'Sign in'}</button></form><button className="profile-text-button" onClick={() => { setMode(mode === 'create' ? 'sign-in' : 'create'); setError('') }}>{mode === 'create' ? 'Already have an account? Sign in' : 'New to Formivo? Create an account'}</button></section></main></div>

  return <div className="profile-shell">
    <header className="profile-header"><a className="profile-brand" href="/">FORMIVO</a><nav><a href="/planner">Open planner</a><span>{user.email}</span><button onClick={() => { if (auth) void signOut(auth) }}>Sign out</button></nav></header>
    <main className="profile-main">
      <section className="profile-hero"><div><span className="profile-eyebrow">Your workspace</span><h1>Spaces made yours.</h1><p>Manage saved designs and follow purchase requests from one place.</p></div><a className="profile-primary" href="/planner">Create a space</a></section>
      {error && <p className="profile-error profile-global-error" role="alert">{error}</p>}
      <section className="profile-section"><div className="profile-section-head"><div><span className="profile-eyebrow">01 / Your creations</span><h2>Saved spaces</h2></div><button className="profile-secondary" onClick={() => setReload((value) => value + 1)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {loading && !projects.length ? <p className="profile-empty" role="status">Loading your spaces…</p> : projects.length ? <div className="profile-project-grid">{projects.map((project) => <article className="profile-project-card" key={project.id}><div className="profile-project-copy"><span className="profile-eyebrow">Saved design</span>{editingId === project.id ? <input className="profile-rename-input" aria-label="Project name" autoFocus value={rename} maxLength={80} onChange={(event) => setRename(event.target.value)} /> : <h3>{project.name}</h3>}<p>{project.objectCount} furniture items · {project.roomCount} {project.roomCount === 1 ? 'room' : 'rooms'}</p><small>Updated {readableTime(project.updatedAt)}</small></div><div className="profile-card-actions">{editingId === project.id ? <><button className="profile-secondary" disabled={busyId === project.id} onClick={() => void renameProject(project)}>Save name</button><button className="profile-quiet" onClick={() => setEditingId(null)}>Cancel</button></> : <><a className="profile-primary" href={`/planner?projectId=${encodeURIComponent(project.id)}`}>Open in editor</a><button className="profile-secondary" onClick={() => { setEditingId(project.id); setRename(project.name) }}>Rename</button><button className="profile-danger" disabled={busyId === project.id || hasActiveRequest(project.id)} title={hasActiveRequest(project.id) ? 'Resolve the active purchase request first' : undefined} onClick={() => void deleteProject(project)}>Delete</button></>}</div></article>)}</div> : <p className="profile-empty">No saved spaces yet. Create a room in the planner, then choose Save to add it here.</p>}
      </section>
      <section className="profile-section"><div className="profile-section-head"><div><span className="profile-eyebrow">02 / Purchase requests</span><h2>Request history</h2></div><span className="profile-count">{requests.length}</span></div><p className="profile-note">Requests are reviewed manually with the shops. Updates appear here; no payment or automatic retailer order is processed.</p>
        {requests.length ? <div className="profile-request-list">{requests.map((request) => <article className="profile-request-card" key={request.id}><div className="profile-request-head"><div><span className="profile-eyebrow">Request · {readableTime(request.createdAt)}</span><h3>{request.projectName}</h3></div><span className={`profile-status profile-status-${request.status}`}>{statusLabels[request.status]}</span></div><div className="profile-request-items">{request.items.map((item) => <div className="profile-request-item" key={item.id}><span><strong>{item.name}{item.variantName ? ` · ${item.variantName}` : ''}</strong><small>{item.retailer} · ×{item.quantity}</small></span><span>{item.availability === 'pending' ? 'Availability pending' : item.availability === 'available' ? 'Available' : 'Unavailable'}{!item.included && item.availability === 'unavailable' ? ' · Excluded' : ''}</span></div>)}</div><div className="profile-request-foot"><span>Estimate · {estimateLabel(request)}</span>{request.status === 'pending' && <span>We are checking availability with each shop.</span>}{request.status === 'ready-to-place' && <span>Availability is confirmed. We will update this request after retailer ordering.</span>}{request.status === 'placed' && <span>The Formivo team marked this order as placed with the retailer.</span>}{request.status === 'delivered' && <span>The Formivo team recorded this order as delivered.</span>}{request.status === 'cancelled' && <span>The Formivo team cancelled this request{request.cancelReason ? `: ${request.cancelReason}` : '.'}</span>}{request.status === 'returned-for-revision' && <span>Open your saved design to revise the selection.</span>}</div>{request.status === 'awaiting-user-decision' && <div className="profile-decision"><p>{request.items.some((item) => item.availability === 'available') ? 'Some items are unavailable. You can continue with the available items or return to your design.' : 'No requested items are available. Return to your design to make changes.'}</p>{request.items.some((item) => item.availability === 'available') && <button className="profile-primary" disabled={busyId === request.id} onClick={() => void decide(request, 'proceed')}>Proceed with available items</button>}<button className="profile-secondary" disabled={busyId === request.id} onClick={() => void decide(request, 'revise')}>Return to design</button></div>}<a className="profile-project-link" href={`/planner?projectId=${encodeURIComponent(request.projectId)}`}>Open saved design</a></article>)}</div> : <p className="profile-empty">No purchase requests yet. Add products to your basket in the planner to get started.</p>}
      </section>
    </main>
  </div>
}
