import { useMemo, useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { atLeast, errorText, label, send, time, type Job } from './api'

export const activeJobStatuses = new Set(['queued', 'discovering', 'running'])
type CrawlDeleteRequest = { path: string; description: string; kind: 'metadata' | 'legacy' }

export default function IngestionTab({ data, role, reload, onError }: TabProps) {
  const [siteUrl, setSiteUrl] = useState('https://www.polihome.gr')
  const [brandName, setBrandName] = useState('')
  const [retailerId, setRetailerId] = useState('')
  const [maxProducts, setMaxProducts] = useState('100')
  const [delayMs, setDelayMs] = useState('1000')
  const [loading, setLoading] = useState(false)
  const [managing, setManaging] = useState(false)
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CrawlDeleteRequest | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = data.jobs.find((job) => job.id === selectedId) || data.jobs[0] || null
  const latestCrawl = data.catalogCrawls[0] || null
  const counts = useMemo(() => selected?.items.reduce<Record<string, number>>((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result }, {}) || {}, [selected])
  const canRun = atLeast(role, 'editor')
  const canManage = atLeast(role, 'admin')
  const isFinished = (status: string) => status === 'completed' || status === 'failed' || status === 'cancelled'

  const start = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); onError('')
    try { await send('/api/admin/catalog-crawls', 'POST', { website: siteUrl, brandName, retailerId: retailerId || brandName, maxProducts: Number(maxProducts), delayMs: Number(delayMs) }); await reload() }
    catch (reason) { onError(errorText(reason)) }
    finally { setLoading(false) }
  }

  const deleteHistory = async (deleteImportedData: boolean) => {
    if (!pendingDelete) return
    setManaging(true); setNotice(''); onError('')
    try {
      const result = await send<{ productsDeleted: number; productsSkipped: number; imagesDeleted: number }>(pendingDelete.path, 'DELETE', { deleteImportedData })
      setNotice(deleteImportedData
        ? `Deleted ${pendingDelete.description} crawl history and ${result.productsDeleted} linked product drafts; removed ${result.imagesDeleted} crawled image files. ${result.productsSkipped} unlinked products and uploaded models or textures were preserved.`
        : `Deleted ${pendingDelete.description} crawl history. Imported products and files remain.`)
      setPendingDelete(null); await reload()
    }
    catch (reason) { onError(errorText(reason)) }
    finally { setManaging(false) }
  }

  const clearHistory = async (path: string, description: string) => {
    if (!window.confirm(`Clear all finished ${description} crawl history only? Active crawls, products, images, and generated artifacts will be kept.`)) return
    setManaging(true); setNotice(''); onError('')
    try {
      const result = await send<{ deleted: number; skippedActive: number }>(path, 'DELETE')
      setNotice(`Deleted ${result.deleted} ${description} crawl records. ${result.skippedActive} active or unknown records were kept.`)
      await reload()
    } catch (reason) { onError(errorText(reason)) }
    finally { setManaging(false) }
  }

  return <>
    <section className="admin-grid">
      {canRun && <form className="admin-card admin-start" onSubmit={start}><div className="admin-card-head"><div><span className="admin-eyebrow">Metadata only</span><h2>Collect a retailer catalogue</h2></div></div><label>Brand name<input value={brandName} onChange={(event) => setBrandName(event.target.value)} required /></label><label>Brand website<input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} type="url" placeholder="https://www.example.com" required /></label><label>Retailer id<input value={retailerId} onChange={(event) => setRetailerId(event.target.value)} placeholder="Optional; defaults to brand name" /></label><div className="admin-fields"><label>Maximum products<input value={maxProducts} onChange={(event) => setMaxProducts(event.target.value)} type="number" min="1" max="500" /></label><label>Delay (ms)<input value={delayMs} onChange={(event) => setDelayMs(event.target.value)} type="number" min="1000" step="500" /></label></div><p className="admin-help">Use only retailer sites you have permission to crawl. Checks robots.txt and the sitemap, saves product metadata and images under the brand folder, and does not generate 3D models. New items stay hidden until a GLB and complete dimensions are available.</p><button className="admin-primary" disabled={loading}>{loading ? 'Starting…' : 'Start metadata crawl'}</button></form>}
      <section className="admin-card admin-stats"><div className="admin-card-head"><div><span className="admin-eyebrow">Latest metadata crawl</span><h2>{latestCrawl ? latestCrawl.brandName : 'No crawl started'}</h2></div>{latestCrawl && <span className={`admin-pill admin-pill-${latestCrawl.status}`}>{label(latestCrawl.status)}</span>}</div>{latestCrawl ? <><div className="admin-stat-grid"><div><strong>{latestCrawl.discoveredUrls.length}</strong><span>discovered</span></div><div><strong>{latestCrawl.items.filter((item) => item.status === 'saved').length}</strong><span>saved</span></div><div><strong>{latestCrawl.items.filter((item) => item.status === 'failed').length}</strong><span>failed</span></div><div><strong>{latestCrawl.items.filter((item) => item.status === 'queued' || item.status === 'scraping').length}</strong><span>remaining</span></div></div><div className="admin-progress"><span style={{ width: `${latestCrawl.items.length ? Math.round(latestCrawl.items.filter((item) => item.status === 'saved' || item.status === 'failed').length / latestCrawl.items.length * 100) : 0}%` }} /></div><p className="admin-help">Updated {time(latestCrawl.updatedAt)}{latestCrawl.currentUrl ? ` · processing ${latestCrawl.currentUrl}` : ''}</p>{latestCrawl.error && <p className="admin-error">{latestCrawl.error}</p>}</> : <p className="admin-empty">Start a metadata crawl to see progress. It collects product details and images; it does not generate 3D models.</p>}</section>
    </section>
    {notice && <p className="admin-help" role="status">{notice}</p>}
    <section className="admin-card admin-jobs"><div className="admin-card-head"><div><span className="admin-eyebrow">Metadata crawls</span><h2>Brand catalogue imports</h2></div>{canManage && data.catalogCrawls.length > 0 && <button className="admin-row-danger" type="button" aria-label="Clear finished metadata crawls" disabled={managing} onClick={() => void clearHistory('/api/admin/catalog-crawls', 'metadata')}>Clear finished</button>}</div>{data.catalogCrawls.length ? <div className="admin-job-list">{data.catalogCrawls.map((job) => <article className="admin-job" key={job.id}><span><strong>{job.brandName} · {job.website}</strong><small>{job.items.filter((item) => item.status === 'saved').length} saved / {job.items.length} products · {time(job.updatedAt)}</small>{job.error && <small className="admin-row-error">{job.error}</small>}{job.items.filter((item) => item.status === 'saved' && item.productId).map((item) => <a key={item.url} href={`/admin/catalog/${encodeURIComponent(item.productId!)}`}>Open {item.productId}</a>)}</span><em className={`admin-pill admin-pill-${job.status}`}>{label(job.status)}</em>{canManage && <button className="admin-row-danger" type="button" aria-label={`Delete ${job.brandName} crawl`} disabled={managing || !isFinished(job.status)} title={isFinished(job.status) ? undefined : 'Active crawls cannot be deleted'} onClick={() => setPendingDelete({ path: `/api/admin/catalog-crawls/${encodeURIComponent(job.id)}`, description: job.brandName, kind: 'metadata' })}>Delete</button>}</article>)}</div> : <p className="admin-empty">No metadata crawls yet.</p>}</section>
    <section className="admin-card admin-jobs"><div className="admin-card-head"><div><span className="admin-eyebrow">Legacy model-recipe history</span><h2>Older generation jobs</h2></div>{canManage && data.jobs.length > 0 && <button className="admin-row-danger" type="button" aria-label="Clear finished legacy crawls" disabled={managing} onClick={() => void clearHistory('/api/admin/jobs', 'legacy')}>Clear finished</button>}</div>{data.jobs.length ? <div className="admin-job-list">{data.jobs.map((job) => <article className={`admin-job ${job.id === selected?.id ? 'admin-job-selected' : ''}`} key={job.id}><button type="button" className="admin-job-main" onClick={() => setSelectedId(job.id)}><span><strong>{job.siteUrl}</strong><small>{time(job.createdAt)} · cap {job.maxProducts}</small></span><span><b>{job.items.filter((item) => item.status === 'generated').length}/{job.items.length}</b><em className={`admin-pill admin-pill-${job.status}`}>{label(job.status)}</em></span></button>{canManage && <button className="admin-row-danger" type="button" aria-label={`Delete ${job.id} crawl`} disabled={managing || !isFinished(job.status)} title={isFinished(job.status) ? undefined : 'Active crawls cannot be deleted'} onClick={() => setPendingDelete({ path: `/api/admin/jobs/${encodeURIComponent(job.id)}`, description: job.siteUrl, kind: 'legacy' })}>Delete</button>}</article>)}</div> : <p className="admin-empty">No legacy model-recipe jobs.</p>}</section>
    {pendingDelete && <div className="admin-confirm-backdrop"><section className="admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="crawl-delete-heading" aria-describedby="crawl-delete-description"><span className="admin-eyebrow">Delete crawl</span><h2 id="crawl-delete-heading">{pendingDelete.description}</h2><p id="crawl-delete-description">{pendingDelete.kind === 'metadata' ? 'Choose whether to remove history only or also delete this crawl’s linked product drafts and crawled images. Uploaded 3D models and textures are preserved; products without an exclusive link to this crawl are kept.' : 'Legacy products and generated files are not safely linked to this job. This release can remove only the crawl history.'}</p><div className="admin-confirm-actions"><button className="admin-row-action" type="button" disabled={managing} onClick={() => void deleteHistory(false)}>Delete history only</button>{pendingDelete.kind === 'metadata' && <button className="admin-row-danger" type="button" disabled={managing} onClick={() => void deleteHistory(true)}>Delete linked drafts and images</button>}<button className="admin-row-action" type="button" disabled={managing} onClick={() => setPendingDelete(null)}>Cancel</button></div></section></div>}
    {selected && <section className="admin-card admin-items"><div className="admin-card-head"><div><span className="admin-eyebrow">Product queue</span><h2>Discovered products</h2></div><span className="admin-muted">{selected.items.length} items</span></div>{selected.items.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>URL</th><th>SKU</th><th>Status</th><th>Artifact</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.url}><td className="admin-cell-clip">{item.url}</td><td>{item.sku || '—'}</td><td><span className={`admin-pill admin-pill-${item.status}`}>{label(item.status)}</span>{item.error && <small className="admin-row-error">{item.error}</small>}</td><td>{item.artifactRoot || '—'}</td></tr>)}</tbody></table></div> : <p className="admin-empty">Product discovery has not started.</p>}</section>}
  </>
}
