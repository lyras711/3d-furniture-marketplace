import { useMemo, useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { atLeast, errorText, label, send, time, type Job } from './api'

export const activeJobStatuses = new Set(['queued', 'discovering', 'running'])

export default function IngestionTab({ data, role, reload, onError }: TabProps) {
  const [siteUrl, setSiteUrl] = useState('https://www.polihome.gr/el')
  const [maxProducts, setMaxProducts] = useState('100')
  const [delayMs, setDelayMs] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = data.jobs.find((job) => job.id === selectedId) || data.jobs[0] || null
  const counts = useMemo(() => selected?.items.reduce<Record<string, number>>((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result }, {}) || {}, [selected])
  const canRun = atLeast(role, 'editor')

  const start = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); onError('')
    try { const job = await send<Job>('/api/admin/jobs', 'POST', { siteUrl, maxProducts: Number(maxProducts), delayMs: Number(delayMs) }); setSelectedId(job.id); await reload() }
    catch (reason) { onError(errorText(reason)) }
    finally { setLoading(false) }
  }
  const action = async (id: string, kind: 'cancel' | 'retry') => {
    try { await send(`/api/admin/jobs/${id}/${kind}`, 'POST') } catch (reason) { onError(errorText(reason)) }
    await reload()
  }

  return <>
    <section className="admin-grid">
      {canRun && <form className="admin-card admin-start" onSubmit={start}><div className="admin-card-head"><div><span className="admin-eyebrow">Start a job</span><h2>Scan a brand site</h2></div><span className="admin-status-dot" /></div><label>Brand website<input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://www.example.com" type="url" required /></label><div className="admin-fields"><label>Maximum products<input value={maxProducts} onChange={(event) => setMaxProducts(event.target.value)} type="number" min="1" max="100" /></label><label>Delay between pages<input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} type="number" min="250" step="250" /></label></div><p className="admin-help">Default: 100 product URLs, one request per second. The current adapter supports Polihome. Other retailers need an adapter before extraction is trusted.</p><button className="admin-primary" disabled={loading}>{loading ? 'Starting…' : 'Start controlled crawl'}</button></form>}
      <section className="admin-card admin-stats"><div className="admin-card-head"><div><span className="admin-eyebrow">Current job</span><h2>{selected ? selected.siteUrl : 'No job selected'}</h2></div>{selected && <span className={`admin-pill admin-pill-${selected.status}`}>{label(selected.status)}</span>}</div>{selected ? <><div className="admin-stat-grid"><div><strong>{selected.discoveredUrls.length}</strong><span>discovered</span></div><div><strong>{counts.generated || 0}</strong><span>generated</span></div><div><strong>{counts['skipped-existing'] || 0}</strong><span>existing SKU</span></div><div><strong>{counts.failed || 0}</strong><span>failed</span></div></div><div className="admin-progress"><span style={{ width: `${selected.items.length ? Math.round(selected.items.filter((item) => !['queued', 'scraping'].includes(item.status)).length / selected.items.length * 100) : 0}%` }} /></div><p className="admin-help">Updated {time(selected.updatedAt)}{selected.currentUrl ? ` · processing ${selected.currentUrl}` : ''}</p>{selected.status === 'failed' && <p className="admin-error">{selected.error}</p>}{canRun && <div className="admin-actions">{activeJobStatuses.has(selected.status) ? <button onClick={() => void action(selected.id, 'cancel')}>Cancel job</button> : <button onClick={() => void action(selected.id, 'retry')}>Retry as new job</button>}</div>}</> : <p className="admin-empty">Start a job to see discovery and generation progress here.</p>}</section>
    </section>
    <section className="admin-card admin-jobs"><div className="admin-card-head"><div><span className="admin-eyebrow">History</span><h2>Ingestion jobs</h2></div></div>{data.jobs.length ? <div className="admin-job-list">{data.jobs.map((job) => <button className={`admin-job ${job.id === selected?.id ? 'admin-job-selected' : ''}`} key={job.id} onClick={() => setSelectedId(job.id)}><span><strong>{job.siteUrl}</strong><small>{time(job.createdAt)} · cap {job.maxProducts}</small></span><span><b>{job.items.filter((item) => item.status === 'generated').length}/{job.items.length}</b><em className={`admin-pill admin-pill-${job.status}`}>{label(job.status)}</em></span></button>)}</div> : <p className="admin-empty">No ingestion jobs yet.</p>}</section>
    {selected && <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">Product queue</span><h2>Discovered products</h2></div><span className="admin-muted">{selected.items.length} items</span></div>{selected.items.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>URL</th><th>SKU</th><th>Status</th><th>Artifact</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.url}><td className="admin-cell-clip">{item.url}</td><td>{item.sku || '—'}</td><td><span className={`admin-pill admin-pill-${item.status}`}>{label(item.status)}</span>{item.error && <small className="admin-row-error">{item.error}</small>}</td><td>{item.artifactRoot || '—'}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Product discovery has not started.</p>}</section>}
  </>
}
