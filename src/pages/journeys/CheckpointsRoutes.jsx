import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookMarked, Route, Repeat, ClipboardList, Plus, Pencil, Trash2, Upload, Search, ShieldCheck, Play, Check, X, ArrowUp, ArrowDown } from 'lucide-react'
import JourneyShell from './JourneyShell'
import JourneyMap from '../../components/journeys/JourneyMap'
import { ErrorNote, Toggle } from '../../components/journeys/JourneyBits'
import { JModal, StopsImport } from '../../components/journeys/JourneyDialogs'
import {
  journeyOptions, listAddresses, saveAddress, deleteAddress, bulkAddresses, listRouteTemplates, updateRouteTemplate, deleteRouteTemplate,
  listJourneyTemplates, saveJourneyTemplate, deleteJourneyTemplate, approveJourneyTemplate, unapproveJourneyTemplate, runJourneyTemplate,
  listForms, saveForm, deleteForm, dayTime, PURPOSE_LABEL,
} from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { useScreenLevel, atLeast } from '../../data/screens'
import { FIELD_TYPES, FIELD_TYPE_LABEL } from '../../utils/journeyForms'

/**
 * Checkpoints & Routes (client 2026-11-13 menu; 2026-11-21 after Uffizio's
 * Address Book, checkpoint Forms and Job templates): the places, routes,
 * templates / schedules and stop forms New Journey reuses, with rename and
 * delete. Editing any of them never changes a journey already planned.
 */

const TABS = [
  { key: 'addresses', label: 'Address book', icon: BookMarked },
  { key: 'routes', label: 'Saved routes', icon: Route },
  { key: 'templates', label: 'Templates & schedules', icon: Repeat },
  { key: 'forms', label: 'Stop forms', icon: ClipboardList },
]
const PURPOSES = ['LOADING', 'UNLOADING', 'DELIVERY', 'REST', 'OTHER']

export default function CheckpointsRoutes(props) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'addresses'
  const level = useScreenLevel()('journeys')
  const canEdit = atLeast(level, 'modify'), canDelete = atLeast(level, 'addDelete')
  const [error, setError] = useState(null)
  const [opts, setOpts] = useState(null)
  const location = useLocation()
  useEffect(() => { journeyOptions().then(setOpts).catch(e => setError(errorMessage(e, 'Could not load'))) }, [])

  return (
    <JourneyShell {...props} crumb="Checkpoints & Routes" title="Checkpoints & routes" subtitle="Places, routes, templates, schedules and stop forms that New Journey reuses.">
      <ErrorNote error={error} />
      {location.state?.saved && tab === 'templates' && <div className="j-card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13, borderColor: 'rgba(126,226,168,.5)' }}>Schedule "{location.state.saved}" saved. Its journeys are made ahead of time; they wait for approval unless an approver approves the schedule below.</div>}
      <div className="j-tabs" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map(t => <button key={t.key} type="button" role="tab" className="j-tab" aria-pressed={tab === t.key} onClick={() => setParams({ tab: t.key })}><t.icon size={14} /> {t.label}</button>)}
      </div>
      {tab === 'addresses' && <Addresses opts={opts} canEdit={canEdit} canDelete={canDelete} onError={setError} />}
      {tab === 'routes' && <Routes canEdit={canEdit} canDelete={canDelete} onError={setError} />}
      {tab === 'templates' && <Templates opts={opts} canEdit={canEdit} canDelete={canDelete} onError={setError} />}
      {tab === 'forms' && <Forms canEdit={canEdit} canDelete={canDelete} onError={setError} />}
    </JourneyShell>
  )
}

function useList(fn, onError) {
  const [rows, setRows] = useState(null)
  const load = useCallback(() => fn().then(setRows).catch(e => onError(errorMessage(e, 'Could not load'))), [fn, onError])
  useEffect(() => { load() }, [load])
  return [rows, load]
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
      <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--j-text3)' }} />
      <input className="j-input" style={{ paddingLeft: 34 }} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  )
}

// ── address book ────────────────────────────────────────────────────────────

const emptyAddress = () => ({ name: '', arrivalType: 'RADIUS', geofenceId: null, lat: null, lng: null, radiusM: 300, purpose: 'OTHER', code: '', contactName: '', contactPhone: '', notes: '' })

function Addresses({ opts, canEdit, canDelete, onError }) {
  const [rows, load] = useList(listAddresses, onError)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState({})
  const shown = useMemo(() => (rows ?? []).filter(a => !q.trim() || [a.name, a.code, a.contactName, PURPOSE_LABEL[a.purpose]].some(v => String(v ?? '').toLowerCase().includes(q.trim().toLowerCase()))), [rows, q])
  const geofences = opts?.geofences ?? []

  async function save() {
    setBusy(true); setErrs({})
    try {
      const g = edit.arrivalType === 'GEOFENCE' ? geofences.find(x => x.id === edit.geofenceId) : null
      const pos = g ? (g.shape === 'CIRCLE' ? { lat: g.centerLat, lng: g.centerLng, radiusM: Math.round(g.radius) } : { lat: g.points.reduce((a, p) => a + p.lat, 0) / g.points.length, lng: g.points.reduce((a, p) => a + p.lng, 0) / g.points.length }) : {}
      await saveAddress({ ...edit, ...pos, radiusM: Number(pos.radiusM ?? edit.radiusM) || 300 }, edit.id)
      setEdit(null); load()
    } catch (e) { onError(errorMessage(e, 'Could not save')); if (e.details) setErrs(e.details) } finally { setBusy(false) }
  }
  async function onImport(stops) {
    setImporting(false)
    try {
      const res = await bulkAddresses(stops.map(s => ({ row: s.row, name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radiusM, purpose: s.purpose })))
      if (res.errors?.length) onError(`Added ${res.data.length}; not added: ${res.errors.map(e => `row ${e.row} (${e.message})`).join(', ')}`)
      load()
    } catch (e) { onError(errorMessage(e, 'Could not add them')) }
  }

  return (
    <div className="j-card j-card--flush">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 16px', flexWrap: 'wrap' }}>
        <span className="j-strong">{rows?.length ?? '—'} places</span>
        <div style={{ flex: 1 }} />
        <SearchBox value={q} onChange={setQ} placeholder="Search name, code or state" />
        {canEdit && <button type="button" className="j-btn j-btn--sm" onClick={() => setImporting(true)}><Upload size={13} /> Excel / CSV</button>}
        {canEdit && <button type="button" className="j-btn j-btn--sm j-btn--primary" onClick={() => setEdit(emptyAddress())}><Plus size={13} /> Add a place</button>}
      </div>
      {!rows && <div style={{ padding: 16 }}><div className="j-skel" style={{ height: 120 }} /></div>}
      {rows?.length === 0 && <div className="j-empty">No places yet. Add the depots, sites and customers you go to, or upload them from Excel.</div>}
      {shown.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="j-table">
            <thead><tr><th>Name</th><th>State</th><th>Reached when</th><th className="j-hide-sm">Code</th><th className="j-hide-sm">Contact</th><th /></tr></thead>
            <tbody>
              {shown.map(a => (
                <tr key={a.id} style={{ cursor: 'default' }}>
                  <td><div className="j-strong">{a.name}</div><div className="j-label">{a.lat.toFixed(5)}, {a.lng.toFixed(5)}</div></td>
                  <td><span className="j-pill j-pill--plain">{PURPOSE_LABEL[a.purpose]}</span></td>
                  <td className="j-label">{a.arrivalType === 'GEOFENCE' ? `Inside "${geofences.find(g => g.id === a.geofenceId)?.name ?? 'geofence'}"` : `Within ${a.radiusM} m`}</td>
                  <td className="j-hide-sm">{a.code || '—'}</td>
                  <td className="j-hide-sm j-label">{[a.contactName, a.contactPhone].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canEdit && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => setEdit({ ...a, code: a.code ?? '', contactName: a.contactName ?? '', contactPhone: a.contactPhone ?? '', notes: a.notes ?? '' })} aria-label={`Edit ${a.name}`}><Pencil size={13} /></button>}{' '}
                    {canDelete && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => window.confirm(`Delete "${a.name}"? Journeys that used it keep their copy.`) && deleteAddress(a.id).then(load).catch(e => onError(errorMessage(e, 'Could not delete')))} aria-label={`Delete ${a.name}`}><Trash2 size={13} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importing && <StopsImport title="Add places from Excel or CSV" addresses={[]} onClose={() => setImporting(false)} onImport={onImport} />}
      {edit && (
        <JModal title={edit.id ? 'Edit place' : 'Add a place'} sub="Click the map to set the point." onClose={() => setEdit(null)} width={760}
          footer={<><button type="button" className="j-btn" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="j-btn j-btn--primary" disabled={busy || !edit.name.trim() || (edit.arrivalType === 'RADIUS' ? !Number.isFinite(edit.lat) : !edit.geofenceId)} onClick={save}><Check size={14} /> Save</button></>}>
          <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
            <label className="j-field"><span>Name</span><input className="j-input" value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} />{errs.name && <span className="j-err">{errs.name}</span>}</label>
            <label className="j-field"><span>State</span><select className="j-select" value={edit.purpose} onChange={e => setEdit(x => ({ ...x, purpose: e.target.value }))}>{PURPOSES.map(p => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}</select></label>
            <div className="j-field"><span>Reached when</span>
              <div className="j-seg"><button type="button" aria-pressed={edit.arrivalType === 'RADIUS'} onClick={() => setEdit(x => ({ ...x, arrivalType: 'RADIUS' }))}>Within a radius</button><button type="button" aria-pressed={edit.arrivalType === 'GEOFENCE'} onClick={() => setEdit(x => ({ ...x, arrivalType: 'GEOFENCE' }))}>Inside a geofence</button></div>
            </div>
            {edit.arrivalType === 'RADIUS'
              ? <label className="j-field"><span>Radius (m)</span><input className="j-input" type="number" min="30" step="50" value={edit.radiusM} onChange={e => setEdit(x => ({ ...x, radiusM: e.target.value }))} /></label>
              : <label className="j-field"><span>Geofence</span><select className="j-select" value={edit.geofenceId ?? ''} onChange={e => setEdit(x => ({ ...x, geofenceId: e.target.value || null, name: x.name || geofences.find(g => g.id === e.target.value)?.name || '' }))}><option value="">Pick…</option>{geofences.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
            <label className="j-field"><span>Code <span className="j-muted" style={{ fontWeight: 400 }}>optional</span></span><input className="j-input" value={edit.code} onChange={e => setEdit(x => ({ ...x, code: e.target.value }))} /></label>
            <label className="j-field"><span>Contact</span><input className="j-input" value={edit.contactName} onChange={e => setEdit(x => ({ ...x, contactName: e.target.value }))} placeholder="Name" /></label>
            <label className="j-field"><span>Phone</span><input className="j-input" value={edit.contactPhone} onChange={e => setEdit(x => ({ ...x, contactPhone: e.target.value }))} /></label>
          </div>
          {edit.arrivalType === 'RADIUS' && (
            <div className="j-card j-card--flush" style={{ marginTop: 12 }}>
              <JourneyMap stops={Number.isFinite(edit.lat) ? [{ name: edit.name || 'Here', lat: edit.lat, lng: edit.lng, radiusM: Number(edit.radiusM) || 300 }] : []} showAreas height={280} onMapClick={([lat, lng]) => setEdit(x => ({ ...x, lat, lng }))} fitKey={edit.id ?? 'new'} />
            </div>
          )}
          {edit.arrivalType === 'RADIUS' && <div className="j-label" style={{ marginTop: 6 }}>{Number.isFinite(edit.lat) ? `${edit.lat.toFixed(5)}, ${edit.lng.toFixed(5)}` : 'Click the map to set the point.'}</div>}
          <label className="j-field" style={{ marginTop: 10 }}><span>Notes</span><textarea className="j-textarea" rows={2} value={edit.notes} onChange={e => setEdit(x => ({ ...x, notes: e.target.value }))} /></label>
        </JModal>
      )}
    </div>
  )
}

// ── saved routes ────────────────────────────────────────────────────────────

function Routes({ canEdit, canDelete, onError }) {
  const [rows, load] = useList(listRouteTemplates, onError)
  const [renaming, setRenaming] = useState(null)
  return (
    <div className="j-card j-card--flush">
      <div style={{ padding: '14px 16px' }}><span className="j-strong">{rows?.length ?? '—'} saved routes</span> <span className="j-label">· saved from New Journey ("Save this route for next time")</span></div>
      {rows?.length === 0 && <div className="j-empty">No saved routes yet.</div>}
      {rows?.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--j-line)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            {renaming?.id === r.id ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="j-input" value={renaming.name} onChange={e => setRenaming(x => ({ ...x, name: e.target.value }))} autoFocus aria-label="New name" />
                <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={!renaming.name.trim()} onClick={() => updateRouteTemplate(r.id, { name: renaming.name.trim(), source: r.source, path: r.path, driveMin: r.driveMin, stops: r.stops, recordedFrom: r.recordedFrom }).then(() => { setRenaming(null); load() }).catch(e => onError(errorMessage(e, 'Could not rename')))}><Check size={13} /></button>
                <button type="button" className="j-btn j-btn--sm" onClick={() => setRenaming(null)}><X size={13} /></button>
              </div>
            ) : <div className="j-strong">{r.name}</div>}
            <div className="j-label">{(r.stops ?? []).map(s => s.name).join(' → ')}</div>
          </div>
          <span className="j-label">{r.source === 'PAST_TRIP' ? 'From a past trip' : r.source === 'DRAWN' ? 'Drawn' : r.source === 'ROAD' ? 'By road' : 'Straight legs'}{r.distanceKm ? ` · ${Math.round(r.distanceKm)} km` : ''}</span>
          {canEdit && renaming?.id !== r.id && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => setRenaming({ id: r.id, name: r.name })} aria-label={`Rename ${r.name}`}><Pencil size={13} /></button>}
          {canDelete && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => window.confirm(`Delete "${r.name}"?`) && deleteRouteTemplate(r.id).then(load).catch(e => onError(errorMessage(e, 'Could not delete')))} aria-label={`Delete ${r.name}`}><Trash2 size={13} /></button>}
        </div>
      ))}
    </div>
  )
}

// ── templates and schedules ────────────────────────────────────────────────

function Templates({ opts, canEdit, canDelete, onError }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = useCallback(() => listJourneyTemplates().then(setData).catch(e => onError(errorMessage(e, 'Could not load'))), [onError])
  useEffect(() => { load() }, [load])
  const me = opts?.me
  const act = async (id, fn) => {
    setBusy(id)
    try { const r = await fn(); if (r?.made != null) onError(r.made ? `Made ${r.made} journey${r.made === 1 ? '' : 's'}.` : 'Nothing new to make.'); await load() } catch (e) { onError(errorMessage(e, 'That did not work')) } finally { setBusy(null) }
  }
  const toggle = t => act(t.id, () => saveJourneyTemplate({
    name: t.name, active: !t.active, vehicleId: t.vehicleId, driverId: t.driverId, body: t.body, scheduleKind: t.scheduleKind,
    repeat: t.repeat, weekdays: t.weekdays, monthDays: t.monthDays, startTime: t.startTime, validFrom: t.validFrom, validTo: t.validTo, horizonDays: t.horizonDays,
  }, t.id))
  const rows = data?.data
  return (
    <div className="j-grid" style={{ gap: 12 }}>
      <div className="j-label" style={{ fontSize: 12.5 }}>Make a template or a schedule from New Journey ("When: Repeats / Automatic", or "Also save as a template"). A schedule's journeys go for approval one by one, unless an approver approves the schedule here.</div>
      {!rows && <div className="j-skel" style={{ height: 120 }} />}
      {rows?.length === 0 && <div className="j-card j-empty">No templates or schedules yet.</div>}
      {rows?.map(t => (
        <div key={t.id} className="j-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="j-strong" style={{ fontSize: 15 }}>{t.name}</span>
                <span className="j-pill j-pill--plain">{t.scheduleKind === 'NONE' ? 'Template' : t.scheduleKind === 'RELATIVE' ? 'Repeats' : 'Automatic'}</span>
                {t.scheduleKind !== 'NONE' && (t.autoApprove ? <span className="j-pill" data-tone="ok">Approved{t.approvedByName ? ` · ${t.approvedByName}` : ''}</span> : <span className="j-pill" data-tone="violet">{t.scheduleKind === 'AUTOMATIC' ? 'Needs approval to run' : 'Each journey needs approval'}</span>)}
                {!t.active && <span className="j-pill" data-tone="muted">Off</span>}
              </div>
              <div className="j-label" style={{ marginTop: 4 }}>{t.body?.title} · {(t.body?.stops ?? []).map(s => s.name).join(' → ')}</div>
              <div className="j-label">{t.vehicleLabel ? `${t.vehicleLabel} · ` : 'Any vehicle · '}{t.describe}{t.validFrom ? ` · from ${dayTime(t.validFrom).split(' · ')[0]}` : ''}{t.validTo ? ` to ${dayTime(t.validTo).split(' · ')[0]}` : ''} · {t.journeysMade} journey{t.journeysMade === 1 ? '' : 's'} made</div>
              {t.next?.length > 0 && t.active && <div className="j-label">Next: {t.next.map(o => dayTime(o.start)).join(', ')}</div>}
              {t.lastError && <div className="j-warn-text" style={{ marginTop: 4 }}>Skipped: {t.lastError}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {t.scheduleKind !== 'NONE' && canEdit && <Toggle label="On" checked={t.active} disabled={busy === t.id} onChange={() => toggle(t)} />}
              {canEdit && <button type="button" className="j-btn j-btn--sm" onClick={() => navigate(`/journeys/new?template=${t.id}`)}><Plus size={13} /> Journey from it</button>}
              {t.scheduleKind === 'RELATIVE' && canEdit && t.active && <button type="button" className="j-btn j-btn--sm" disabled={busy === t.id} onClick={() => act(t.id, () => runJourneyTemplate(t.id))}><Play size={13} /> Make due days now</button>}
              {t.scheduleKind !== 'NONE' && data.canApprove && !t.autoApprove && t.createdById !== me?.id && <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy === t.id} onClick={() => act(t.id, () => approveJourneyTemplate(t.id))}><ShieldCheck size={13} /> Approve</button>}
              {t.scheduleKind !== 'NONE' && t.autoApprove && (data.canApprove || canEdit) && <button type="button" className="j-btn j-btn--sm" disabled={busy === t.id} onClick={() => act(t.id, () => unapproveJourneyTemplate(t.id))}>Remove approval</button>}
              {canDelete && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => window.confirm(`Delete "${t.name}"? Journeys it made stay.`) && act(t.id, () => deleteJourneyTemplate(t.id))} aria-label={`Delete ${t.name}`}><Trash2 size={13} /></button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── stop forms ──────────────────────────────────────────────────────────────

function Forms({ canEdit, canDelete, onError }) {
  const [rows, load] = useList(listForms, onError)
  const [edit, setEdit] = useState(null)
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const setField = (i, patch) => setEdit(x => ({ ...x, fields: x.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) }))
  const move = (i, d) => setEdit(x => { const f = [...x.fields]; const j = i + d; if (j < 0 || j >= f.length) return x; [f[i], f[j]] = [f[j], f[i]]; return { ...x, fields: f } })
  async function save() {
    setBusy(true); setErrs({})
    try {
      await saveForm({ name: edit.name, fields: edit.fields.map(f => ({ ...f, options: typeof f.options === 'string' ? f.options.split(',') : f.options })) }, edit.id)
      setEdit(null); load()
    } catch (e) { onError(errorMessage(e, 'Could not save the form')); if (e.details) setErrs(e.details) } finally { setBusy(false) }
  }
  return (
    <div className="j-card j-card--flush">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 16px' }}>
        <span className="j-strong" style={{ flex: 1 }}>{rows?.length ?? '—'} forms <span className="j-label">· filled at a stop by the driver (driver link) or the office</span></span>
        {canEdit && <button type="button" className="j-btn j-btn--sm j-btn--primary" onClick={() => setEdit({ name: '', fields: [{ label: '', type: 'TEXT', required: true }] })}><Plus size={13} /> New form</button>}
      </div>
      {rows?.length === 0 && <div className="j-empty">No forms yet. A form asks the driver for a seal number, the pallets delivered, a photo…</div>}
      {rows?.map(f => (
        <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--j-line)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="j-strong">{f.name}</div>
            <div className="j-label">{f.fields.map(x => `${x.label} (${FIELD_TYPE_LABEL[x.type]}${x.required ? ', required' : ''})`).join(' · ')}</div>
          </div>
          {canEdit && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => setEdit({ ...f, fields: f.fields.map(x => ({ ...x, options: (x.options ?? []).join(', ') })) })} aria-label={`Edit ${f.name}`}><Pencil size={13} /></button>}
          {canDelete && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => window.confirm(`Delete "${f.name}"? Filled forms stay on their journeys.`) && deleteForm(f.id).then(load).catch(e => onError(errorMessage(e, 'Could not delete')))} aria-label={`Delete ${f.name}`}><Trash2 size={13} /></button>}
        </div>
      ))}
      {edit && (
        <JModal title={edit.id ? 'Edit form' : 'New form'} onClose={() => setEdit(null)} width={720}
          footer={<><button type="button" className="j-btn" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="j-btn j-btn--primary" disabled={busy || !edit.name.trim()} onClick={save}><Check size={14} /> Save</button></>}>
          <label className="j-field"><span>Form name</span><input className="j-input" value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} placeholder="Delivery note" />{errs.name && <span className="j-err">{errs.name}</span>}</label>
          <div className="j-caps" style={{ margin: '16px 0 8px' }}>Fields</div>
          {edit.fields.map((f, i) => (
            <div key={i} className="j-inset" style={{ marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="j-input" style={{ flex: '2 1 180px' }} value={f.label} onChange={e => setField(i, { label: e.target.value })} placeholder="Label" aria-label="Field label" />
              <select className="j-select" style={{ flex: '1 1 120px', width: 'auto' }} value={f.type} onChange={e => setField(i, { type: e.target.value })} aria-label="Field type">{FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}</select>
              <label className="j-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} /> Required</label>
              <button type="button" className="j-iconbtn" style={{ width: 28, height: 28 }} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp size={12} /></button>
              <button type="button" className="j-iconbtn" style={{ width: 28, height: 28 }} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown size={12} /></button>
              <button type="button" className="j-iconbtn" style={{ width: 28, height: 28 }} onClick={() => setEdit(x => ({ ...x, fields: x.fields.filter((_, k) => k !== i) }))} aria-label="Remove field"><X size={12} /></button>
              {f.type === 'DROPDOWN' && <input className="j-input" style={{ flexBasis: '100%' }} value={f.options ?? ''} onChange={e => setField(i, { options: e.target.value })} placeholder="Choices, separated by commas" aria-label="Choices" />}
              {(errs[`fields.${i}.label`] || errs[`fields.${i}.options`]) && <span className="j-err" style={{ flexBasis: '100%' }}>{errs[`fields.${i}.label`] || errs[`fields.${i}.options`]}</span>}
            </div>
          ))}
          <button type="button" className="j-btn j-btn--sm" onClick={() => setEdit(x => ({ ...x, fields: [...x.fields, { label: '', type: 'TEXT', required: false }] }))}><Plus size={13} /> Add a field</button>
        </JModal>
      )}
    </div>
  )
}
