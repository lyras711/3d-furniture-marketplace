import { useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { errorText, send, time, type AdminUser } from './api'

export default function TeamTab({ data, reload, onError }: TabProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const addUser = async (event: FormEvent) => {
    event.preventDefault()
    try { await send('/api/admin/users', 'POST', { email, role }); setEmail(''); await reload() } catch (reason) { onError(errorText(reason)) }
  }
  const revoke = async (target: AdminUser) => {
    if (!window.confirm(`Revoke ${target.email}?`)) return
    try { await send(`/api/admin/users/${encodeURIComponent(target.uid)}`, 'DELETE'); await reload() } catch (reason) { onError(errorText(reason)) }
  }
  return <div className="admin-two-col">
    <section className="admin-card"><div className="admin-card-head"><div><span className="admin-eyebrow">Roles</span><h2>Admin users</h2></div><span className="admin-muted">{data.users.length} accounts</span></div>
      <form className="admin-user-form" onSubmit={addUser}><input aria-label="Email to grant a role" value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="user@example.com" required /><select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button className="admin-row-action">Grant role</button></form>
      <p className="admin-help">Viewer: overview, catalogue, ingestion (read). Editor: catalogue review, ingestion jobs. Admin and owner: orders, partners, visibility, roles.</p>
      {data.users.length ? <div className="admin-catalog-list">{data.users.map((item) => <div className="admin-catalog-row" key={item.uid}><span><strong>{item.email}</strong><small>{item.uid}</small></span><span><em className="admin-pill">{item.status === 'revoked' ? 'revoked' : item.role}</em>{item.status !== 'revoked' && <button className="admin-row-action admin-row-danger" onClick={() => void revoke(item)}>Revoke</button>}</span></div>)}</div> : <p className="admin-empty">Only configured Firebase owners appear here after Firebase Admin credentials are set.</p>}
    </section>
    <section className="admin-card"><div className="admin-card-head"><div><span className="admin-eyebrow">Audit history</span><h2>Admin changes</h2></div><span className="admin-muted">{data.audit.length} events</span></div>
      {data.audit.length ? <div className="admin-catalog-list">{data.audit.slice(0, 50).map((item) => <div className="admin-catalog-row" key={item.id}><span><strong>{item.action}</strong><small>{item.actorEmail} · {item.target}</small></span>{item.createdAt?._seconds && <small className="admin-muted">{time(new Date(item.createdAt._seconds * 1000).toISOString())}</small>}</div>)}</div> : <p className="admin-empty">No admin changes recorded.</p>}
    </section>
  </div>
}
