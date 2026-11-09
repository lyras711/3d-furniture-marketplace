import type { TabProps } from '../Admin'
import { stageLabels } from '../partners'
import { atLeast, euro, label, shortDate } from './api'

const openStages = new Set(['lead', 'contacted', 'negotiating', 'onboarding'])

export default function OverviewTab({ data, role, go }: TabProps) {
  const admin = atLeast(role, 'admin')
  const { requests, partners, catalog, metrics, jobs } = data
  const count = (status: string) => requests.filter((request) => request.status === status).length
  const attention = requests.filter((request) => request.status === 'pending' || request.status === 'ready-to-place').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 6)
  const needsWork = catalog.filter((item) => item.review === 'needs-work').slice(0, 6)
  const stats = [
    ...(admin ? [
      { value: count('pending'), text: 'orders to check', tab: 'orders' as const },
      { value: count('awaiting-user-decision'), text: 'waiting for shopper', tab: 'orders' as const },
      { value: count('ready-to-place'), text: 'ready to place', tab: 'orders' as const },
      { value: count('placed'), text: 'placed, not delivered', tab: 'orders' as const },
      { value: partners.filter((partner) => openStages.has(partner.stage)).length, text: 'partners in pipeline', tab: 'partners' as const },
      { value: partners.filter((partner) => partner.stage === 'active').length, text: 'active partners', tab: 'partners' as const },
    ] : []),
    { value: catalog.filter((item) => !item.hidden).length, text: 'listed products', tab: 'catalogue' as const },
    { value: catalog.filter((item) => item.review === 'pending').length, text: 'awaiting review', tab: 'catalogue' as const },
    { value: catalog.filter((item) => item.hidden).length, text: 'hidden products', tab: 'catalogue' as const },
    ...(metrics ? [{ value: metrics.savedProjects, text: 'saved designs', tab: 'overview' as const }] : []),
    { value: jobs.filter((job) => job.status === 'running' || job.status === 'queued' || job.status === 'discovering').length, text: 'ingestion jobs running', tab: 'ingestion' as const },
  ]

  return <>
    <section className="admin-kpis" aria-label="Key numbers">{stats.map((stat) => <button key={stat.text} className="admin-kpi" onClick={() => go(stat.tab)}><strong>{stat.value}</strong><span>{stat.text}</span></button>)}</section>
    <div className="admin-two-col">
      {admin && <section className="admin-card"><div className="admin-card-head"><div><span className="admin-eyebrow">Orders</span><h2>Needs action</h2></div><button className="admin-row-action" onClick={() => go('orders')}>All orders</button></div>
        {attention.length ? <div className="admin-catalog-list">{attention.map((request) => <button className="admin-list-row" key={request.id} onClick={() => go('orders', request.id)}><span><strong>{request.projectName}</strong><small>{request.customer.name} · {shortDate(request.createdAt)} · {euro(request.estimatedTotal)}</small></span><em className={`admin-pill admin-pill-${request.status}`}>{request.status === 'pending' ? 'check availability' : 'place with retailer'}</em></button>)}</div> : <p className="admin-empty">No orders need action.</p>}
      </section>}
      {admin && <section className="admin-card"><div className="admin-card-head"><div><span className="admin-eyebrow">B2B</span><h2>Partner pipeline</h2></div><button className="admin-row-action" onClick={() => go('partners')}>All partners</button></div>
        <div className="admin-stage-bars">{Object.entries(stageLabels).map(([stage, text]) => { const value = partners.filter((partner) => partner.stage === stage).length; return <div key={stage}><span>{text}</span><i><b style={{ width: `${partners.length ? value / partners.length * 100 : 0}%` }} /></i><strong>{value}</strong></div> })}</div>
      </section>}
      <section className="admin-card"><div className="admin-card-head"><div><span className="admin-eyebrow">Catalogue</span><h2>Flagged for work</h2></div><button className="admin-row-action" onClick={() => go('catalogue')}>Catalogue</button></div>
        {needsWork.length ? <div className="admin-catalog-list">{needsWork.map((item) => <button className="admin-list-row" key={item.id} onClick={() => go('catalogue', item.id)}><span><strong>{item.name}</strong><small>{item.retailer} · {label(item.category)}</small></span><em className="admin-pill admin-pill-needs-work">needs work</em></button>)}</div> : <p className="admin-empty">No products are flagged as needing work.</p>}
      </section>
    </div>
    {admin && <p className="admin-help">Counts come from saved designs, purchase requests and partner records. No third-party click tracking is enabled.</p>}
  </>
}
