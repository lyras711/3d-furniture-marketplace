import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { TabProps } from '../Admin'
import { partnerStages, stageLabels, type Partner, type PartnerFields, type PartnerStage } from '../partners'
import { errorText, send, shortDate, time, type CatalogItem } from './api'

const blank: PartnerFields = { company: '', website: '', country: '', contactName: '', contactEmail: '', contactPhone: '', retailerId: '', stage: 'lead' }
const fieldsOf = (partner: Partner): PartnerFields => ({ company: partner.company, website: partner.website, country: partner.country, contactName: partner.contactName, contactEmail: partner.contactEmail, contactPhone: partner.contactPhone, retailerId: partner.retailerId, stage: partner.stage })

function PartnerForm({ initial, catalog, busy, submitLabel, onSubmit }: { initial: PartnerFields; catalog: CatalogItem[]; busy: boolean; submitLabel: string; onSubmit: (fields: PartnerFields) => void }) {
  const [fields, setFields] = useState(initial)
  useEffect(() => setFields(initial), [initial])
  const retailers = useMemo(() => [...new Set(catalog.map((item) => item.retailerId).filter((id): id is string => Boolean(id)))].sort(), [catalog])
  const input = (key: Exclude<keyof PartnerFields, 'stage'>, text: string, type = 'text', extra: Record<string, unknown> = {}) => <label>{text}<input type={type} value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} {...extra} /></label>
  return <form className="admin-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(fields) }}>
    {input('company', 'Company', 'text', { required: true, maxLength: 120 })}
    <label>Stage<select value={fields.stage} onChange={(event) => setFields((current) => ({ ...current, stage: event.target.value as PartnerStage }))}>{partnerStages.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></label>
    {input('website', 'Website', 'url', { placeholder: 'https://', maxLength: 200 })}
    {input('country', 'Country', 'text', { maxLength: 60 })}
    {input('contactName', 'Contact name', 'text', { maxLength: 100 })}
    {input('contactEmail', 'Contact email', 'email', { maxLength: 160 })}
    {input('contactPhone', 'Contact phone', 'tel', { maxLength: 40 })}
    {input('retailerId', 'Catalogue retailer id', 'text', { list: 'admin-retailer-ids', placeholder: 'e.g. polihome', pattern: '[a-z0-9-]*', maxLength: 60 })}
    <datalist id="admin-retailer-ids">{retailers.map((id) => <option key={id} value={id} />)}</datalist>
    <div className="admin-form-submit"><button className="admin-primary-inline" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
  </form>
}

export default function PartnersTab({ data, reload, onError, focus }: TabProps) {
  const [stage, setStage] = useState<PartnerStage | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(focus)
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = data.partners.find((partner) => partner.id === selectedId) || null
  const initial = useMemo(() => selected ? fieldsOf(selected) : blank, [selected])
  const productCount = (retailerId: string) => retailerId ? data.catalog.filter((item) => item.retailerId === retailerId).length : 0
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return data.partners.filter((partner) => (stage === 'all' || partner.stage === stage) && (!term || `${partner.company} ${partner.contactName} ${partner.contactEmail} ${partner.country} ${partner.website} ${partner.retailerId}`.toLowerCase().includes(term)))
  }, [data.partners, query, stage])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); onError('')
    try { const result = await work(); await reload(); return result } catch (reason) { onError(errorText(reason)); return null } finally { setBusy(false) }
  }
  const create = async (fields: PartnerFields) => { const created = await run(() => send<Partner>('/api/admin/partners', 'POST', fields)) as Partner | null; if (created) { setCreating(false); setSelectedId(created.id) } }
  const update = (fields: PartnerFields) => void run(() => send(`/api/admin/partners/${encodeURIComponent(selected!.id)}`, 'PUT', fields))
  const addNote = async (event: FormEvent) => { event.preventDefault(); if (await run(() => send(`/api/admin/partners/${encodeURIComponent(selected!.id)}/notes`, 'POST', { text: note }))) setNote('') }
  const remove = async () => { if (!selected || !window.confirm(`Delete ${selected.company} and its notes? This cannot be undone.`)) return; if (await run(() => send(`/api/admin/partners/${encodeURIComponent(selected.id)}`, 'DELETE'))) setSelectedId(null) }
  const open = creating || Boolean(selected)

  return <div className={`admin-split ${open ? 'admin-split-open' : ''}`}>
    <section className="admin-card admin-list-pane">
      <div className="admin-toolbar"><input type="search" aria-label="Search partners" placeholder="Search company, contact, country…" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="admin-primary-inline" onClick={() => { setCreating(true); setSelectedId(null) }}>Add partner</button></div>
      <div className="admin-chips" role="group" aria-label="Filter partners by stage"><button aria-pressed={stage === 'all'} onClick={() => setStage('all')}>All <b>{data.partners.length}</b></button>{partnerStages.map((value) => <button key={value} aria-pressed={stage === value} onClick={() => setStage(value)}>{stageLabels[value]} <b>{data.partners.filter((partner) => partner.stage === value).length}</b></button>)}</div>
      {filtered.length ? <div className="admin-catalog-list">{filtered.map((partner) => <button className={`admin-list-row ${partner.id === selectedId ? 'admin-list-row-selected' : ''}`} key={partner.id} onClick={() => { setSelectedId(partner.id); setCreating(false) }}><span><strong>{partner.company}</strong><small>{[partner.contactName, partner.country].filter(Boolean).join(' · ') || 'No contact yet'}</small><small>{partner.retailerId ? `${productCount(partner.retailerId)} catalogue products` : 'Not linked to catalogue'} · updated {shortDate(partner.updatedAt)}</small></span><em className={`admin-pill admin-pill-stage-${partner.stage}`}>{stageLabels[partner.stage]}</em></button>)}</div> : <p className="admin-empty">{data.partners.length ? 'No partners match these filters.' : 'No partners yet. Add the retailers and brands you are talking to.'}</p>}
    </section>
    {creating ? <section className="admin-card admin-detail" aria-label="New partner"><button className="admin-back" onClick={() => setCreating(false)}>← All partners</button><div className="admin-card-head"><div><span className="admin-eyebrow">B2B partner</span><h2>Add a partner</h2></div></div><PartnerForm initial={blank} catalog={data.catalog} busy={busy} submitLabel="Create partner" onSubmit={(fields) => void create(fields)} /></section>
      : selected ? <section className="admin-card admin-detail" aria-label={`Partner ${selected.company}`}>
        <button className="admin-back" onClick={() => setSelectedId(null)}>← All partners</button>
        <div className="admin-card-head"><div><span className="admin-eyebrow">B2B partner · since {shortDate(selected.createdAt)}</span><h2>{selected.company}</h2></div><em className={`admin-pill admin-pill-stage-${selected.stage}`}>{stageLabels[selected.stage]}</em></div>
        <div className="admin-link-row">{selected.website && <a href={selected.website} target="_blank" rel="noreferrer">Website ↗</a>}{selected.contactEmail && <a href={`mailto:${selected.contactEmail}`}>Email {selected.contactName || 'contact'}</a>}{selected.retailerId && <span>{productCount(selected.retailerId)} products in catalogue as <code>{selected.retailerId}</code></span>}</div>
        <PartnerForm initial={initial} catalog={data.catalog} busy={busy} submitLabel="Save changes" onSubmit={update} />
        <div className="admin-two-col admin-detail-cols">
          <section><h3>Notes</h3>
            {selected.notes.length ? <ul className="admin-timeline">{[...selected.notes].reverse().map((item) => <li key={item.id}><p>{item.text}</p><small>{item.authorEmail} · {time(item.at)}</small></li>)}</ul> : <p className="admin-empty">No notes yet.</p>}
            <form className="admin-inline-form" onSubmit={addNote}><label>Add a note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} required rows={2} placeholder="Intro call done; sending pilot terms…" /></label><button className="admin-row-action" disabled={busy}>Add note</button></form>
          </section>
          <section><h3>Stage history</h3><ul className="admin-timeline">{[...selected.stageHistory].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><p>{stageLabels[entry.stage]}</p><small>{entry.authorEmail} · {time(entry.at)}</small></li>)}</ul></section>
        </div>
        <div className="admin-actions"><button className="admin-row-danger" disabled={busy} onClick={() => void remove()}>Delete partner</button></div>
      </section>
      : <section className="admin-card admin-detail-empty"><p className="admin-empty">Select a partner to update their stage, contact details and notes.</p></section>}
  </div>
}
