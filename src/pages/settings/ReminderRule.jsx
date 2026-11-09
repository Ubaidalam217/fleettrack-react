import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Search, BellRing, Bell, ListChecks, CalendarClock, Route, Timer, Car, Pencil, Trash2, Check, ArrowRight,
} from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import PageNotice from './PageNotice'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE, inputStyle } from './formStyles'
import { DFM_CSS, ctl } from './alignedFormStyles'
import { DF, DSection } from './AlignedForm'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { usePageAccess, handleApiError } from './pageChrome'
import { IS_REAL } from '../../data/mode'
import { useVehicles, useCompanies, companyNameFor, branchNameFor, vehicleLabel } from '../../data/settings'
import {
  REMINDER_TYPES, isRenewal, ruleSummary,
  listReminderRules, addReminderRule, updateReminderRule, deleteReminderRule,
} from '../../data/reminders'

// Settings › Master › Reminder Rule (client, 2026-11-10), after the reference
// system's Reminder Rule screen: what to be reminded of, by duration, distance
// and/or engine hours (whichever comes first), how, and for which vehicles —
// each with its own start point. Reports › Reminder Status shows where each
// vehicle stands and is where a reminder is marked done.

const CSS = `
.rr-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:900px}
.rr-table th{background:var(--c-thead);text-align:left;padding:10px 12px;font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:.05em;color:var(--c-text3);white-space:nowrap;border-bottom:1px solid var(--c-border2)}
.rr-table td{padding:10px 12px;border-bottom:1px solid var(--c-border2);color:var(--c-text1);vertical-align:middle}
.rr-table tbody tr:hover{background:var(--c-hover)}
.rr-sub{font-size:11px;color:var(--c-text3);margin-top:1px}
.rr-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:750;padding:2px 8px;border-radius:999px;white-space:nowrap}
.rr-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text2);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.rr-btn:hover{background:var(--c-hover);color:var(--c-text1)}
.rr-veh{border:1px solid var(--c-border2);border-radius:12px;overflow:hidden}
.rr-veh-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--c-border2);background:var(--c-thead)}
.rr-veh table{width:100%;border-collapse:collapse;font-size:12.5px}
.rr-veh th{text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--c-text3);white-space:nowrap}
.rr-veh td{padding:6px 10px;border-top:1px solid var(--c-border2);vertical-align:middle}
.rr-veh tr[aria-selected="true"] td{background:color-mix(in srgb,var(--ft-accent) 6%,transparent)}
.rr-veh input[type=date],.rr-veh input[type=number]{height:34px}
.rr-empty{padding:36px 16px;text-align:center;color:var(--c-text3);font-size:12.5px}
`

const today = () => new Date().toLocaleDateString('en-CA')
const str = v => (v === null || v === undefined ? '' : String(v))
const num = v => (String(v ?? '').trim() === '' ? null : Number(v))

function emptyRule(bgId = '') {
  return {
    id: null, bgId, name: '', type: 'Oil Change', otherType: '', recurring: true,
    byDuration: true, byDistance: false, byEngineHours: false,
    frequency: 'Monthly', every: '', notifyDays: '7',
    everyKm: '', notifyKm: '500', everyHours: '', notifyHours: '10',
    notifyInApp: true, notifyEmail: false, emails: '', active: true,
    vehicles: {}, // vehicleId → { startDate, kmBefore, hoursBefore, issueDate, expiryDate }
  }
}

const ALL_TYPES = [...REMINDER_TYPES.Service, ...REMINDER_TYPES.Renewal]
const CELL_LABEL = { startDate: 'Start date', kmBefore: 'Km already run', hoursBefore: 'Engine hours already run', issueDate: 'Issue date', expiryDate: 'Expiry date' }

export default function ReminderRule(props) {
  const access = usePageAccess('reminder-rule')
  const vehicles = useVehicles()
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()

  const [rows, setRows] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [bgFilter, setBgFilter] = useState('')
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(null)
  const [vehSearch, setVehSearch] = useState('')
  const formRef = useRef(null)

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    listReminderRules(bgFilter ? { bgId: bgFilter } : {})
      .then(d => { if (live) setRows(d ?? []) })
      .catch(err => { if (live) { setRows([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgFilter, reloadKey])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => !q || [r.name, r.type, r.bg?.name].some(s => String(s ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  // ── form ──────────────────────────────────────────────────────────────────
  const editing = draft !== null
  const openAdd = () => {
    setErrors({}); setVehSearch('')
    setDraft(emptyRule(bgFilter || (companies.length === 1 ? companies[0].id : '')))
  }
  const openEdit = r => {
    setErrors({}); setVehSearch('')
    const known = ALL_TYPES.includes(r.type)
    setDraft({
      ...emptyRule(r.bgId), id: r.id, name: r.name, type: known ? r.type : '__other', otherType: known ? '' : r.type,
      recurring: r.recurring, byDuration: r.byDuration, byDistance: r.byDistance, byEngineHours: r.byEngineHours,
      frequency: r.frequency, every: str(r.every), notifyDays: str(r.notifyDays),
      everyKm: str(r.everyKm), notifyKm: str(r.notifyKm), everyHours: str(r.everyHours), notifyHours: str(r.notifyHours),
      notifyInApp: r.notifyInApp, notifyEmail: r.notifyEmail, emails: (r.emails ?? []).join(', '), active: r.active,
      vehicles: Object.fromEntries((r.vehicles ?? []).map(v => [v.vehicleId, {
        startDate: str(v.startDate), kmBefore: str(v.kmBefore), hoursBefore: str(v.hoursBefore),
        issueDate: str(v.issueDate), expiryDate: str(v.expiryDate),
      }])),
    })
  }
  const closeForm = () => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => ({ ...d, [key]: value, ...(key === 'bgId' ? { vehicles: {} } : {}) }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }
  const setVehicle = (id, key, value) => setDraft(d => ({ ...d, vehicles: { ...d.vehicles, [id]: { ...d.vehicles[id], [key]: value } } }))
  const toggleVehicle = id => setDraft(d => {
    const next = { ...d.vehicles }
    if (next[id]) delete next[id]
    else next[id] = { startDate: today(), kmBefore: '', hoursBefore: '', issueDate: '', expiryDate: '' }
    return { ...d, vehicles: next }
  })

  const type = editing ? (draft.type === '__other' ? draft.otherType.trim() : draft.type) : ''
  const renewal = editing && isRenewal(type)
  const bgVehicles = editing
    ? vehicles.filter(v => v.companyId === draft.bgId).sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
    : []
  const vehShown = bgVehicles.filter(v => !vehSearch.trim() || vehicleLabel(v).toLowerCase().includes(vehSearch.trim().toLowerCase()))
  const allPicked = vehShown.length > 0 && vehShown.every(v => draft.vehicles[v.id])
  const pickAll = () => setDraft(d => {
    const next = { ...d.vehicles }
    if (allPicked) vehShown.forEach(v => delete next[v.id])
    else vehShown.forEach(v => { if (!next[v.id]) next[v.id] = { startDate: today(), kmBefore: '', hoursBefore: '', issueDate: '', expiryDate: '' } })
    return { ...d, vehicles: next }
  })

  const submit = async e => {
    e.preventDefault()
    if (saving) return
    const next = {}
    if (!draft.bgId) next.bgId = 'Business Group is required'
    if (!draft.name.trim()) next.name = 'Reminder name is required'
    if (!type) next.type = draft.type === '__other' ? 'Type the reminder type' : 'Reminder type is required'
    if (!draft.byDuration && !draft.byDistance && !draft.byEngineHours) next.byDuration = 'Choose at least one'
    const picked = Object.values(draft.vehicles)
    if (draft.byDuration && !(num(draft.every) > 0) && !(picked.length && picked.every(v => v.expiryDate))) {
      next.every = renewal ? 'Required, or give every vehicle an expiry date' : 'Required'
    }
    if (draft.byDistance && !(num(draft.everyKm) > 0)) next.everyKm = 'Required'
    if (draft.byDistance && num(draft.notifyKm) != null && num(draft.everyKm) > 0 && num(draft.notifyKm) >= num(draft.everyKm)) next.notifyKm = 'Less than the distance'
    if (draft.byEngineHours && !(num(draft.everyHours) > 0)) next.everyHours = 'Required'
    const emails = draft.emails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    if (draft.notifyEmail && !emails.length) next.emails = 'Add at least one email'
    if (!draft.notifyInApp && !draft.notifyEmail) next.notifyInApp = 'Choose how to remind'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }
    const body = {
      ...(draft.id ? {} : { bgId: draft.bgId }),
      name: draft.name.trim(), type, recurring: draft.recurring,
      byDuration: draft.byDuration, byDistance: draft.byDistance, byEngineHours: draft.byEngineHours,
      frequency: draft.frequency, every: draft.byDuration ? num(draft.every) : null, notifyDays: draft.byDuration ? num(draft.notifyDays) : null,
      everyKm: draft.byDistance ? num(draft.everyKm) : null, notifyKm: draft.byDistance ? num(draft.notifyKm) : null,
      everyHours: draft.byEngineHours ? num(draft.everyHours) : null, notifyHours: draft.byEngineHours ? num(draft.notifyHours) : null,
      notifyInApp: draft.notifyInApp, notifyEmail: draft.notifyEmail, emails: draft.notifyEmail ? emails : [], active: draft.active,
      vehicles: Object.entries(draft.vehicles).map(([vehicleId, v]) => ({
        vehicleId, startDate: v.startDate || null, kmBefore: num(v.kmBefore), hoursBefore: num(v.hoursBefore),
        issueDate: v.issueDate || null, expiryDate: v.expiryDate || null,
      })),
    }
    setSaving(true)
    try {
      if (draft.id) await updateReminderRule(draft.id, body)
      else await addReminderRule(body)
      push(`${body.name} ${draft.id ? 'updated' : 'added'}`, { tone: 'success' })
      closeForm()
      setReloadKey(k => k + 1)
    } catch (err) {
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const r = pending
    setPending(null)
    try {
      await deleteReminderRule(r.id)
      push(`${r.name} deleted`, { tone: 'success' })
      setReloadKey(k => k + 1)
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const fid = n => `rr-${n}`
  const numField = (name, label, { span = 4, placeholder, required, hint } = {}) => (
    <DF id={fid(name)} label={label} required={required} error={errors[name]} span={span} hint={hint}>
      <input id={fid(name)} name={name} type="number" min="0" inputMode="decimal" value={draft[name]} placeholder={placeholder}
        onChange={e => set(name, e.target.value)} aria-invalid={!!errors[name] || undefined} style={ctl(!!errors[name])} />
    </DF>
  )
  const busyBtn = saving ? { opacity: 0.6, cursor: 'not-allowed' } : null
  const title = !editing ? 'Reminder Rule' : draft.id ? 'Edit Reminder' : 'Add Reminder'
  const unitWord = editing ? { Daily: 'days', Weekly: 'weeks', Monthly: 'months' }[draft.frequency] : ''

  if (!IS_REAL) {
    return (
      <SettingsLayout title="Reminder Rule" {...props}>
        <div style={{ ...CARD_SURFACE, padding: 24, marginTop: 16, fontSize: 13, color: 'var(--c-text2)' }}>
          Reminders are kept on the server, so they are not available in demo mode.
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout title={title} {...props}>
      <style>{CSS}</style>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate className="dfm">
          <style>{DFM_CSS}</style>

          <DSection icon={Bell} title="Reminder" desc="What to be reminded of, and whether it repeats.">
            <div className="dfm-grid">
              <DF id={fid('name')} label="Reminder name" required error={errors.name} span={6}>
                <input id={fid('name')} name="name" value={draft.name} onChange={e => set('name', e.target.value)} maxLength={120}
                  placeholder="Oil change every 10,000 km" autoComplete="off" aria-invalid={!!errors.name || undefined} style={ctl(!!errors.name)} />
              </DF>
              <DF id={fid('type')} label="Reminder type" required error={errors.type} span={draft.type === '__other' ? 3 : 6}>
                <select id={fid('type')} name="type" value={draft.type} onChange={e => set('type', e.target.value)} style={ctl(!!errors.type)}>
                  <optgroup label="Service">{REMINDER_TYPES.Service.map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
                  <optgroup label="Renewal">{REMINDER_TYPES.Renewal.map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
                  <option value="__other">Other…</option>
                </select>
              </DF>
              {draft.type === '__other' && (
                <DF id={fid('otherType')} label="Other type" span={3}>
                  <input id={fid('otherType')} name="otherType" value={draft.otherType} onChange={e => set('otherType', e.target.value)}
                    maxLength={60} placeholder="Gearbox oil" autoComplete="off" style={ctl(false)} />
                </DF>
              )}
              <DF id={fid('bgId')} label="Business Group" required error={errors.bgId}
                hint={draft.id ? 'A reminder stays in its Business Group.' : undefined}>
                <select id={fid('bgId')} name="bgId" value={draft.bgId} onChange={e => set('bgId', e.target.value)} disabled={!!draft.id}
                  style={ctl(!!errors.bgId, draft.id ? { opacity: 0.6, cursor: 'not-allowed' } : null)}>
                  <option value="">— Select —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </DF>
              <DF id={fid('recurring')} label="Schedule" group>
                <div className="dfm-seg" role="radiogroup" aria-labelledby={`${fid('recurring')}-label`} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {[[true, 'Recurring'], [false, 'One Time']].map(([v, l]) => (
                    <button key={l} type="button" role="radio" aria-checked={draft.recurring === v} onClick={() => set('recurring', v)}>{l}</button>
                  ))}
                </div>
              </DF>
              <DF id={fid('active')} label="Status" group>
                <div className="dfm-seg" role="radiogroup" aria-labelledby={`${fid('active')}-label`} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {[[true, 'Active'], [false, 'Paused']].map(([v, l]) => (
                    <button key={l} type="button" role="radio" aria-checked={draft.active === v} onClick={() => set('active', v)}>{l}</button>
                  ))}
                </div>
              </DF>
            </div>
          </DSection>

          <DSection icon={ListChecks} title="Based on" desc="Choose one or more; whichever comes first raises the reminder.">
            <div className="dfm-grid">
              <DF id={fid('byDuration')} label="Count by" group error={errors.byDuration} span={12}>
                <div className="dfm-chips" role="group" aria-labelledby={`${fid('byDuration')}-label`}>
                  {[['byDuration', 'Duration'], ['byDistance', 'Distance'], ['byEngineHours', 'Engine hours']].map(([k, l]) => (
                    <button key={k} name={k === 'byDuration' ? 'byDuration' : undefined} type="button" className="dfm-chip" role="checkbox"
                      aria-checked={draft[k]} onClick={() => { set(k, !draft[k]); setErrors(e => ({ ...e, byDuration: null })) }}>
                      {draft[k] && <Check size={13} strokeWidth={3} aria-hidden="true" />}{l}
                    </button>
                  ))}
                </div>
              </DF>
            </div>
          </DSection>

          {draft.byDuration && (
            <DSection icon={CalendarClock} title="Duration"
              desc={renewal ? 'For a renewal, an expiry date on a vehicle below stands for the interval.' : 'Counted from each vehicle’s start date.'}>
              <div className="dfm-grid">
                {draft.recurring ? (
                  <>
                    <DF id={fid('frequency')} label="Frequency" group>
                      <div className="dfm-seg" role="radiogroup" aria-labelledby={`${fid('frequency')}-label`}>
                        {['Daily', 'Weekly', 'Monthly'].map(f => (
                          <button key={f} type="button" role="radio" aria-checked={draft.frequency === f} onClick={() => set('frequency', f)}>{f}</button>
                        ))}
                      </div>
                    </DF>
                    {numField('every', `Every (x) ${unitWord}`, { placeholder: draft.frequency === 'Monthly' ? '6' : '30', required: !renewal })}
                  </>
                ) : (
                  numField('every', 'Reminder at (x) months', { span: 8, placeholder: '12', required: !renewal })
                )}
                {numField('notifyDays', 'Notify before (days)', { placeholder: '7' })}
              </div>
            </DSection>
          )}

          {draft.byDistance && (
            <DSection icon={Route} title="Distance" desc="From the tracker’s odometer.">
              <div className="dfm-grid">
                {numField('everyKm', draft.recurring ? 'Every (x) km' : 'Reminder at (x) km', { span: 6, placeholder: '10000', required: true })}
                {numField('notifyKm', 'Notify before (km)', { span: 6, placeholder: '500' })}
              </div>
            </DSection>
          )}

          {draft.byEngineHours && (
            <DSection icon={Timer} title="Engine hours" desc="Counted by FleetmaxX from ignition-on time; the trackers send no hour meter.">
              <div className="dfm-grid">
                {numField('everyHours', draft.recurring ? 'Every (x) engine hours' : 'Reminder at (x) engine hours', { span: 6, placeholder: '250', required: true })}
                {numField('notifyHours', 'Notify before (hours)', { span: 6, placeholder: '10' })}
              </div>
            </DSection>
          )}

          <DSection icon={BellRing} title="Remind using" desc="Due and Overdue are each sent once per cycle.">
            <div className="dfm-grid">
              <DF id={fid('notifyInApp')} label="Channels" group error={errors.notifyInApp} span={12}>
                <div className="dfm-chips" role="group" aria-labelledby={`${fid('notifyInApp')}-label`}>
                  <button type="button" name="notifyInApp" className="dfm-chip" role="checkbox" aria-checked={draft.notifyInApp} onClick={() => set('notifyInApp', !draft.notifyInApp)}>
                    {draft.notifyInApp && <Check size={13} strokeWidth={3} aria-hidden="true" />}Notification
                  </button>
                  <button type="button" className="dfm-chip" role="checkbox" aria-checked={draft.notifyEmail} onClick={() => set('notifyEmail', !draft.notifyEmail)}>
                    {draft.notifyEmail && <Check size={13} strokeWidth={3} aria-hidden="true" />}Email
                  </button>
                  <button type="button" className="dfm-chip" role="checkbox" aria-checked="false" disabled title="SMS is not set up">SMS · not set up</button>
                </div>
              </DF>
              {draft.notifyEmail && (
                <DF id={fid('emails')} label="Email to" required error={errors.emails} span={12} hint="Separate addresses with commas.">
                  <input id={fid('emails')} name="emails" value={draft.emails} onChange={e => set('emails', e.target.value)}
                    placeholder="fleet@company.ae, workshop@company.ae" autoComplete="off" style={ctl(!!errors.emails)} />
                </DF>
              )}
            </div>
          </DSection>

          <DSection icon={Car} title="Vehicles" desc="Each starts its count from its own date. Distance or hours already run before that date count too.">
            {!draft.bgId ? (
              <div className="dfm-empty">Choose a Business Group first.</div>
            ) : bgVehicles.length === 0 ? (
              <div className="dfm-empty">No vehicles in this Business Group.</div>
            ) : (
              <div className="rr-veh">
                <div className="rr-veh-head">
                  <div style={{ position: 'relative', flex: '0 1 280px' }}>
                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
                    <input type="search" value={vehSearch} onChange={e => setVehSearch(e.target.value)} placeholder="Search vehicle" aria-label="Search vehicles"
                      style={{ ...inputStyle(false), height: 34, paddingLeft: 28 }} />
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text3)' }}>{Object.keys(draft.vehicles).length} of {bgVehicles.length} chosen</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}><input type="checkbox" checked={allPicked} onChange={pickAll} aria-label="Choose all vehicles" style={{ accentColor: 'var(--ft-accent)' }} /></th>
                        <th>Vehicle</th>
                        <th>Start date</th>
                        {draft.byDistance && <th>Km already run</th>}
                        {draft.byEngineHours && <th>Engine h already run</th>}
                        {renewal && <th>Issue date</th>}
                        {renewal && <th>Expiry date</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {vehShown.map(v => {
                        const row = draft.vehicles[v.id]
                        const cell = (key, typeAttr = 'date', extra = {}) => (
                          <input type={typeAttr} value={row?.[key] ?? ''} disabled={!row} onChange={e => setVehicle(v.id, key, e.target.value)}
                            aria-label={`${CELL_LABEL[key]} for ${vehicleLabel(v)}`} style={{ ...inputStyle(false), opacity: row ? 1 : 0.4, ...extra }} {...(typeAttr === 'number' ? { min: 0, placeholder: '0' } : {})} />
                        )
                        return (
                          <tr key={v.id} aria-selected={!!row}>
                            <td><input type="checkbox" checked={!!row} onChange={() => toggleVehicle(v.id)} aria-label={`Choose ${vehicleLabel(v)}`} style={{ accentColor: 'var(--ft-accent)' }} /></td>
                            <td>
                              <div style={{ fontWeight: 650 }}>{vehicleLabel(v)}</div>
                              <div className="rr-sub">{v.branchId ? branchNameFor(v.branchId) : companyNameFor(v.companyId)}</div>
                            </td>
                            <td style={{ minWidth: 150 }}>{cell('startDate')}</td>
                            {draft.byDistance && <td style={{ minWidth: 120 }}>{cell('kmBefore', 'number')}</td>}
                            {draft.byEngineHours && <td style={{ minWidth: 120 }}>{cell('hoursBefore', 'number')}</td>}
                            {renewal && <td style={{ minWidth: 150 }}>{cell('issueDate')}</td>}
                            {renewal && <td style={{ minWidth: 150 }}>{cell('expiryDate')}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {errors.vehicles && <span className="dfm-err" role="alert">{errors.vehicles}</span>}
          </DSection>

          <div className="dfm-foot">
            <span className="dfm-foot-note"><span className="dfm-req" aria-hidden="true">*</span> Required</span>
            <button type="button" onClick={closeForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Back</button>
            <button type="submit" style={{ ...PRIMARY_BTN, height: 40, ...busyBtn }} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Reminder'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <PageNotice {...access} />
          {!access.loading && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
                  <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or type" aria-label="Search reminders"
                    style={{ ...inputStyle(false), height: 38, paddingLeft: 30 }} />
                </div>
                {companies.length > 1 && (
                  <select value={bgFilter} onChange={e => setBgFilter(e.target.value)} aria-label="Business Group" style={{ ...inputStyle(false), height: 38, width: 'auto', minWidth: 180 }}>
                    <option value="">All Business Groups</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <Link to="/reports/reminder-status" style={{ ...SECONDARY_BTN, height: 38, textDecoration: 'none' }}>
                    Reminder Status <ArrowRight size={14} />
                  </Link>
                  {access.canAdd && (
                    <button type="button" onClick={openAdd} disabled={!companies.length} style={{ ...PRIMARY_BTN, height: 38 }}>
                      <Plus size={14} strokeWidth={2.6} /> Add Reminder
                    </button>
                  )}
                </div>
              </div>

              <div style={{ ...CARD_SURFACE, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="rr-table">
                    <thead>
                      <tr>
                        <th>Reminder</th><th>Type</th><th>Schedule</th><th>Interval</th><th>Remind using</th>
                        <th>Vehicles</th><th>Status</th>{access.canWrite && <th style={{ textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows === null ? (
                        <tr><td colSpan={8} className="rr-empty">Loading reminders…</td></tr>
                      ) : shown.length === 0 ? (
                        <tr><td colSpan={8} className="rr-empty">
                          {rows.length ? 'No reminders match the search.' : access.canAdd ? 'No reminders yet — use Add Reminder to set one up.' : 'No reminders to show.'}
                        </td></tr>
                      ) : shown.map(r => (
                        <tr key={r.id}>
                          <td><div style={{ fontWeight: 700 }}>{r.name}</div><div className="rr-sub">{r.bg?.name}</div></td>
                          <td>{r.type}<div className="rr-sub">{isRenewal(r.type) ? 'Renewal' : ALL_TYPES.includes(r.type) ? 'Service' : 'Other'}</div></td>
                          <td>{r.recurring ? 'Recurring' : 'One Time'}</td>
                          <td>{ruleSummary(r)}</td>
                          <td>{[r.notifyInApp && 'Notification', r.notifyEmail && 'Email'].filter(Boolean).join(' · ') || '—'}</td>
                          <td>{r.vehicles?.length ?? 0}</td>
                          <td>
                            <span className="rr-pill" style={r.active
                              ? { color: '#16a34a', background: 'rgba(16,185,129,0.12)' }
                              : { color: 'var(--c-text3)', background: 'var(--c-progress)' }}>
                              {r.active ? 'Active' : 'Paused'}
                            </span>
                          </td>
                          {access.canWrite && (
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button type="button" className="rr-btn" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`} title="Edit"><Pencil size={14} /></button>
                              {access.canDelete && (
                                <button type="button" className="rr-btn" onClick={() => setPending(r)} aria-label={`Delete ${r.name}`} title="Delete" style={{ marginLeft: 6 }}><Trash2 size={14} /></button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete reminder?"
          body={`${pending.name} will stop for all its vehicles. Its Mark done history is kept.`}
          note="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
