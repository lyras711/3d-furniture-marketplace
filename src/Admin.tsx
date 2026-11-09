import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, firebaseConfigured, keepAdminSession } from './firebase'
import { atLeast, emptyData, errorText, send, type AdminData, type Job, type Role } from './admin/api'
import OverviewTab from './admin/OverviewTab'
import OrdersTab from './admin/OrdersTab'
import PartnersTab from './admin/PartnersTab'
import CatalogTab from './admin/CatalogTab'
import IngestionTab, { activeJobStatuses } from './admin/IngestionTab'
import TeamTab from './admin/TeamTab'
import './admin.css'

export type TabId = 'overview' | 'orders' | 'partners' | 'catalogue' | 'ingestion' | 'team'
export type TabProps = { data: AdminData; role: string; reload: () => Promise<void>; onError: (message: string) => void; go: (tab: TabId, focus?: string) => void; focus: string | null }

const tabs: { id: TabId; title: string; intro: string; minimum: Role }[] = [
  { id: 'overview', title: 'Overview', intro: 'What needs attention across orders, partners and the catalogue.', minimum: 'viewer' },
  { id: 'orders', title: 'Orders', intro: 'Shopper purchase requests. Check availability with each retailer, then record placement and delivery by hand.', minimum: 'admin' },
  { id: 'partners', title: 'Partners', intro: 'Retailers and brands in the B2B pipeline, from first contact to live catalogue.', minimum: 'admin' },
  { id: 'catalogue', title: 'Catalogue', intro: 'Every product the planner ships. Partners own names, prices and dimensions; here you set review state and visibility.', minimum: 'viewer' },
  { id: 'ingestion', title: 'Ingestion', intro: 'Controlled catalogue crawls. Use only with retailer permission; requests are rate-limited and capped.', minimum: 'viewer' },
  { id: 'team', title: 'Team & audit', intro: 'Admin roles and the change log.', minimum: 'admin' },
]

const initialTab = () => { const value = new URLSearchParams(location.search).get('tab'); return tabs.some((tab) => tab.id === value) ? value as TabId : 'overview' }

function AuthCard({ children, onSubmit }: { children: ReactNode; onSubmit?: (event: FormEvent) => void }) {
  return <div className="admin-auth-shell">{onSubmit ? <form className="admin-auth-card" onSubmit={onSubmit}>{children}</form> : <div className="admin-auth-card">{children}</div>}</div>
}

export default function Admin() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [accessChecked, setAccessChecked] = useState(false)
  const [data, setData] = useState<AdminData>(emptyData)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [focus, setFocus] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    void keepAdminSession()
    return onAuthStateChanged(auth, (next) => {
      setUser(next && !next.isAnonymous ? next : null); setAuthReady(true); setAccessChecked(false); setRole(null); setData(emptyData)
    })
  }, [])

  const load = useCallback(async () => {
    let me: { role: string }
    try { me = await send<{ role: string }>('/api/admin/me') } catch (reason) {
      setRole(null); setAccessChecked(true); setError(errorText(reason) || 'Admin API unavailable. Start npm run admin:server.'); return
    }
    setRole(me.role); setAccessChecked(true)
    const failed: string[] = [], admin = atLeast(me.role, 'admin')
    const get = <T,>(section: string, path: string, fallback: T, allowed = true) => allowed ? send<T>(path).catch(() => { failed.push(section); return fallback }) : Promise.resolve(fallback)
    const [jobs, catalog, users, audit, requests, metrics, partners] = await Promise.all([
      get('ingestion', '/api/admin/jobs', emptyData.jobs),
      get('catalogue', '/api/admin/catalog', { products: emptyData.catalog }),
      get('team', '/api/admin/users', emptyData.users, admin),
      get('audit', '/api/admin/audit', emptyData.audit, admin),
      get('orders', '/api/admin/purchase-requests', emptyData.requests, admin),
      get('metrics', '/api/admin/metrics', null, admin),
      get('partners', '/api/admin/partners', emptyData.partners, admin),
    ])
    setData({ jobs: jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), catalog: catalog.products, users, audit, requests, metrics, partners })
    setError(failed.length ? `Could not load: ${failed.join(', ')}. Check the admin API and Firebase credentials.` : '')
  }, [])

  useEffect(() => { if (user) void load() }, [user, load])
  useEffect(() => {
    if (!user || !data.jobs.some((job) => activeJobStatuses.has(job.status))) return
    const timer = window.setInterval(() => void send<Job[]>('/api/admin/jobs').then((jobs) => setData((current) => ({ ...current, jobs: jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }))).catch(() => {}), 2000)
    return () => window.clearInterval(timer)
  }, [data.jobs, user])

  const go = (next: TabId, target?: string) => {
    setTab(next); setFocus(target ?? null); setError('')
    const url = new URL(location.href); url.searchParams.set('tab', next); history.replaceState(null, '', url)
    window.scrollTo({ top: 0 })
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setError('')
    try { if (!auth) throw new Error('Firebase Auth is not configured. Set the VITE_FIREBASE_* values before using /admin.'); await signInWithEmailAndPassword(auth, email, password) }
    catch (reason) { setError(errorText(reason)) }
    finally { setAuthBusy(false) }
  }

  if (!authReady) return <AuthCard><span className="admin-eyebrow">Formivo admin dashboard</span><h1>Checking access…</h1></AuthCard>
  if (!firebaseConfigured || !auth || !user) return <AuthCard onSubmit={signIn}><a className="admin-brand" href="/">FORMIVO</a><span className="admin-eyebrow">Protected admin</span><h1>Sign in to the admin dashboard.</h1>{!firebaseConfigured && <p className="admin-error">Firebase Auth is not configured for this deployment.</p>}<label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{error && <p className="admin-error">{error}</p>}<button className="admin-primary" disabled={authBusy || !firebaseConfigured}>{authBusy ? 'Signing in…' : 'Sign in'}</button><p className="admin-help">Access is granted only to users with an admin role in Firebase.</p></AuthCard>
  if (!accessChecked) return <AuthCard><span className="admin-eyebrow">Protected admin</span><h1>Checking role…</h1></AuthCard>
  if (!role) return <AuthCard><a className="admin-brand" href="/">FORMIVO</a><span className="admin-eyebrow">Protected admin</span><h1>Admin access is required.</h1><p className="admin-error">{error || 'This account does not have an admin role.'}</p><button className="admin-primary" onClick={() => { if (auth) void signOut(auth) }}>Sign out</button></AuthCard>

  const visible = tabs.filter((item) => atLeast(role, item.minimum))
  const current = visible.find((item) => item.id === tab) || visible[0]
  const badges: Partial<Record<TabId, number>> = {
    orders: data.requests.filter((request) => request.status === 'pending' || request.status === 'ready-to-place').length,
    catalogue: data.catalog.filter((item) => item.review === 'needs-work').length,
  }
  const props: TabProps = { data, role, reload: load, onError: setError, go, focus }

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand"><a href="/" className="admin-brand">FORMIVO</a><span className="admin-kicker">Admin</span></div>
      <nav className="admin-tabs" aria-label="Admin sections">{visible.map((item) => <button key={item.id} className={item.id === current.id ? 'admin-tab admin-tab-active' : 'admin-tab'} aria-current={item.id === current.id ? 'page' : undefined} onClick={() => go(item.id)}><span>{item.title}</span>{Boolean(badges[item.id]) && <b aria-label={`${badges[item.id]} need attention`}>{badges[item.id]}</b>}</button>)}</nav>
      <div className="admin-sidebar-foot"><a href="/planner">Open planner</a><span className="admin-user" title={user.email || ''}>{user.email}<small>{role}</small></span><button className="admin-signout" onClick={() => signOut(auth!)}>Sign out</button></div>
    </aside>
    <main className="admin-main">
      <header className="admin-page-head"><div><span className="admin-eyebrow">Formivo operations</span><h1>{current.title}</h1><p>{current.intro}</p></div><button className="admin-refresh" onClick={() => void load()}>Refresh</button></header>
      {error && <p className="admin-error admin-global-error" role="alert">{error}</p>}
      {current.id === 'overview' && <OverviewTab {...props} />}
      {current.id === 'orders' && <OrdersTab {...props} />}
      {current.id === 'partners' && <PartnersTab {...props} />}
      {current.id === 'catalogue' && <CatalogTab {...props} />}
      {current.id === 'ingestion' && <IngestionTab {...props} />}
      {current.id === 'team' && <TeamTab {...props} />}
    </main>
  </div>
}
