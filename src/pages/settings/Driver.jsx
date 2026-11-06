import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, Search, Camera, Trash2, FileText, Upload, ExternalLink } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useDrivers, useVehicles, useCompanies,
  addDriver, updateDriver, removeDriver,
  companyNameFor, vehiclesForCompany, vehicleLabel,
  driverForVehicleId, emptyDriver, isIbuttonTaken,
  DRIVER_DEPARTMENTS, LICENCE_CATEGORIES, DRIVER_DOC_TYPES, driverCode,
  setDriverPhoto, removeDriverPhoto,
  listDriverDocuments, uploadDriverDocument, deleteDriverDocument, openDriverDocument,
  listDriverAssignments, addDriverAssignment, endDriverAssignment, deleteDriverAssignment,
  listDriverIncidents, addDriverIncident, deleteDriverIncident, INCIDENT_TYPES,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'
import { licenceExpiryState, formatExpiryDate } from '../../utils/licenceExpiry'
import { squareJpegBase64, fileToBase64 } from '../../utils/imageUpload'

// Settings > Driver — the driver master (Driver Management, phase 1, client
// 2026-11-06): profile, licence and other document details with their
// expiries, a photo, scanned copies, and the one vehicle and iButton tag the
// driver uses. The Live Map panel and the reports read the assignment back
// through driverForVehicleImei() / driverForIbutton().
//
// A vehicle has one driver at most. Picking a vehicle someone else drives MOVES
// it on save — the server does that in one transaction, mock mode mirrors it —
// so the dropdown names the current driver beside each vehicle, and the save
// toast says who lost it. A Suspended driver may not hold a vehicle.

// Mirrors the badge vocabulary in components/VehicleStatus.jsx, as User.jsx does.
const STATUS_TONE = {
  Active:    { color: '#16a34a', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  Inactive:  { color: 'var(--c-text3)', bg: 'var(--c-progress)', border: 'transparent' },
  Suspended: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)' },
}

const EXPIRY_TONE = {
  valid:    STATUS_TONE.Active,
  expiring: { color: '#d97706', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.28)' },
  expired:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)' },
}

// The dated papers the expiry alert watches, in the order the form shows them.
const EXPIRIES = [
  ['licenseExpiry',    'Licence'],
  ['visaExpiry',       'Visa'],
  ['emiratesIdExpiry', 'Emirates ID'],
  ['medicalExpiry',    'Medical'],
]

function Pill({ tone, children }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, whiteSpace: 'nowrap' }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {children}
    </span>
  )
}

function ExpiryChip({ expiry }) {
  const s = licenceExpiryState(expiry)
  if (s.state === 'none') return null
  return <Pill tone={EXPIRY_TONE[s.state]}>{s.label}</Pill>
}

function Avatar({ driver, size = 28 }) {
  const initials = String(driver.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return driver.photoUrl ? (
    <img src={driver.photoUrl} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)',
    }}>{initials}</span>
  )
}

/** The paper that runs out first, for the table: "Visa · Expires in 12d". */
function nextExpiry(d) {
  const dated = EXPIRIES.filter(([k]) => d[k]).map(([k, label]) => ({ label, date: d[k] }))
  if (!dated.length) return null
  return dated.sort((a, b) => a.date.localeCompare(b.date))[0]
}

// A function of the vehicle lookup rather than a constant, so the Vehicle column
// re-renders when a vehicle is renamed on its own page.
const columnsFor = vehicleById => [
  { key: 'driverNo',  label: 'Driver ID', render: row => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{driverCode(row)}</span> },
  {
    key: 'name',
    label: 'Driver',
    render: row => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Avatar driver={row} />
        <span style={{ fontWeight: 700, color: 'var(--c-text1)' }}>{row.name}</span>
      </span>
    ),
  },
  { key: 'employeeId', label: 'Employee ID', render: row => row.employeeId || '—' },
  { key: 'company',    label: 'BG', render: row => companyNameFor(row.companyId) },
  { key: 'department', label: 'Department', render: row => row.department || '—' },
  { key: 'mobile',     label: 'Mobile', render: row => row.mobile || '—' },
  {
    key: 'expiry',
    label: 'Next Expiry',
    render: row => {
      const e = nextExpiry(row)
      return e ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{e.label} · {formatExpiryDate(e.date)}</span>
          <ExpiryChip expiry={e.date} />
        </span>
      ) : '—'
    },
  },
  { key: 'ibuttonCode', label: 'iButton', render: row => row.ibuttonCode || '—' },
  {
    key: 'vehicle',
    label: 'Vehicle',
    render: row => (row.vehicleId ? vehicleLabel(vehicleById.get(row.vehicleId)) : (
      <span style={{ color: 'var(--c-text3)' }}>Unassigned</span>
    )),
  },
  {
    key: 'status',
    label: 'Status',
    render: row => <Pill tone={STATUS_TONE[row.status] || STATUS_TONE.Inactive}>{row.status}</Pill>,
  },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

function SectionTitle({ children, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '22px 0 12px', paddingBottom: 6, borderBottom: '1px solid var(--c-border2)' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>{children}</span>
      {note && <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>{note}</span>}
    </div>
  )
}

/** A date input with the expiry chip under it (a valid save even when expired). */
function ExpiryField({ label, name, value, error, onChange }) {
  return (
    <Field label={label} error={error}>
      <input name={name} type="date" value={value ?? ''} onChange={e => onChange(name, e.target.value)}
        aria-invalid={!!error || undefined} style={inputStyle(!!error)} />
      {!error && licenceExpiryState(value).state !== 'none' && (
        <span style={{ display: 'block', marginTop: 5 }}><ExpiryChip expiry={value} /></span>
      )}
    </Field>
  )
}

const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Scanned copies of a saved driver's papers (real mode only — they live on the server). */
function DriverDocuments({ driver, canWrite, push }) {
  const [docs, setDocs] = useState(null)
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState(DRIVER_DOC_TYPES[0])
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const load = () => listDriverDocuments(driver.id).then(setDocs).catch(err => { setDocs([]); handleApiError(err, { push }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [driver.id])

  const upload = async () => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { push('The file is too large (max 5 MB)', { tone: 'error' }); return }
    setBusy(true)
    try {
      await uploadDriverDocument(driver.id, {
        title: title.trim() || file.name, docType, expiryDate: expiry || null, fileName: file.name, data: await fileToBase64(file),
      })
      push(`${title.trim() || file.name} uploaded`, { tone: 'success' })
      setTitle(''); setExpiry(''); setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
    }
  }

  const remove = async d => {
    try {
      await deleteDriverDocument(driver.id, d.id)
      push(`${d.title} deleted`, { tone: 'success' })
      await load()
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  return (
    <>
      {docs === null ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Loading documents…</div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>No documents uploaded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {docs.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 8 }}>
              <FileText size={16} style={{ color: 'var(--ft-accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{d.title}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
                  {d.docType} · {d.fileName} · {fmtSize(d.size)}{d.expiryDate ? ` · expires ${formatExpiryDate(d.expiryDate)}` : ''}
                </div>
              </div>
              {d.expiryDate && <ExpiryChip expiry={d.expiryDate} />}
              <button type="button" className="ft-btn" onClick={() => openDriverDocument(driver.id, d.id).catch(err => push(err.message, { tone: 'error' }))}
                style={{ padding: '5px 9px', fontSize: 11.5 }} title="Open">
                <ExternalLink size={13} /> Open
              </button>
              {canWrite && (
                <button type="button" className="ft-btn" onClick={() => remove(d)} style={{ padding: '5px 9px', fontSize: 11.5 }} title="Delete">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div style={{ ...GRID, marginTop: 12, alignItems: 'end' }}>
          <Field label="Document Type">
            <select value={docType} onChange={e => setDocType(e.target.value)} style={inputStyle(false)}>
              {DRIVER_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Licence (front)" maxLength={120} style={inputStyle(false)} />
          </Field>
          <Field label="Expiry (optional)">
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} style={inputStyle(false)} />
          </Field>
          <Field label="File" hint="PDF, JPEG, PNG or WebP · max 5 MB">
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ ...inputStyle(false), padding: 6 }} />
          </Field>
          <div>
            <button type="button" onClick={upload} disabled={!file || busy}
              style={{ ...PRIMARY_BTN, padding: '9px 16px', opacity: !file || busy ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const ROW = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 8 }
const SMALL_BTN = { padding: '5px 9px', fontSize: 11.5 }

/**
 * Who drove which vehicle when. Primary rows follow the Vehicle field above;
 * a Temporary row covers a vehicle for some dates (leave, a spare vehicle).
 * Trips with no iButton tag are credited by these dates.
 */
function DriverAssignments({ driver, canWrite, push }) {
  const [rows, setRows] = useState(null)
  const [vehicleId, setVehicleId] = useState('')
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const bgVehicles = [...vehiclesForCompany(driver.companyId)].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))

  const load = () => listDriverAssignments(driver.id).then(setRows).catch(err => { setRows([]); handleApiError(err, { push }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [driver.id])

  const add = async () => {
    setBusy(true)
    try {
      await addDriverAssignment(driver.id, { vehicleId, startDate: from, endDate: to || null, notes: notes.trim() || null })
      push('Temporary assignment added', { tone: 'success' })
      setVehicleId(''); setTo(''); setNotes('')
      await load()
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
    }
  }
  const end = async a => {
    try { await endDriverAssignment(driver.id, a.id, todayStr()); await load() } catch (err) { handleApiError(err, { push }) }
  }
  const drop = async a => {
    try { await deleteDriverAssignment(driver.id, a.id); await load() } catch (err) { handleApiError(err, { push }) }
  }
  const vName = v => (v ? (v.plateNo || v.fleetNo || v.imei) : '—')

  return (
    <>
      {rows === null ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Loading assignments…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>No assignments yet. Choosing a Vehicle above starts the Primary one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(a => (
            <div key={a.id} style={ROW}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                color: a.role === 'Primary' ? 'var(--ft-accent)' : '#d97706',
                background: a.role === 'Primary' ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'rgba(245,158,11,0.12)',
              }}>{a.role}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{vName(a.vehicle)}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
                  {formatExpiryDate(a.startDate)} → {a.endDate ? formatExpiryDate(a.endDate) : 'now'}{a.notes ? ` · ${a.notes}` : ''}
                </div>
              </div>
              {canWrite && a.role === 'Temporary' && !a.endDate && (
                <button type="button" className="ft-btn" onClick={() => end(a)} style={SMALL_BTN}>End today</button>
              )}
              {canWrite && a.role === 'Temporary' && (
                <button type="button" className="ft-btn" onClick={() => drop(a)} style={SMALL_BTN} title="Delete"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {canWrite && driver.status !== 'Suspended' && (
        <div style={{ ...GRID, marginTop: 12, alignItems: 'end' }}>
          <Field label="Temporary vehicle">
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={inputStyle(false)}>
              <option value="">— Choose —</option>
              {bgVehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle(false)} /></Field>
          <Field label="To (optional)"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle(false)} /></Field>
          <Field label="Note"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Leave cover" maxLength={300} style={inputStyle(false)} /></Field>
          <div>
            <button type="button" onClick={add} disabled={!vehicleId || !from || busy}
              style={{ ...PRIMARY_BTN, padding: '9px 16px', opacity: !vehicleId || !from || busy ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** Accidents and incidents on the driver's record; they weigh on the safety score. */
function DriverIncidents({ driver, canWrite, push }) {
  const [rows, setRows] = useState(null)
  const [date, setDate] = useState(todayStr())
  const [type, setType] = useState(INCIDENT_TYPES[0])
  const [vehicleId, setVehicleId] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const bgVehicles = [...vehiclesForCompany(driver.companyId)].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))

  const load = () => listDriverIncidents(driver.id).then(setRows).catch(err => { setRows([]); handleApiError(err, { push }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [driver.id])

  const add = async () => {
    setBusy(true)
    try {
      await addDriverIncident(driver.id, { date, type, vehicleId: vehicleId || null, description: description.trim() || null, cost: cost === '' ? null : cost })
      push(`${type} recorded`, { tone: 'success' })
      setDescription(''); setCost(''); setVehicleId('')
      await load()
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
    }
  }
  const drop = async i => {
    try { await deleteDriverIncident(driver.id, i.id); await load() } catch (err) { handleApiError(err, { push }) }
  }

  return (
    <>
      {rows === null ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Loading incidents…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>No incidents on record.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(i => (
            <div key={i.id} style={ROW}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: '#ef4444', background: 'rgba(239,68,68,0.1)', flexShrink: 0 }}>{i.type}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{i.description || i.type}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
                  {formatExpiryDate(i.date)}{i.vehicle ? ` · ${i.vehicle.plateNo || i.vehicle.fleetNo || i.vehicle.imei}` : ''}{i.cost != null ? ` · AED ${i.cost.toLocaleString()}` : ''}
                </div>
              </div>
              {canWrite && <button type="button" className="ft-btn" onClick={() => drop(i)} style={SMALL_BTN} title="Delete"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {canWrite && (
        <div style={{ ...GRID, marginTop: 12, alignItems: 'end' }}>
          <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle(false)} /></Field>
          <Field label="Type">
            <select value={type} onChange={e => setType(e.target.value)} style={inputStyle(false)}>
              {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Vehicle (optional)">
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={inputStyle(false)}>
              <option value="">— None —</option>
              {bgVehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </select>
          </Field>
          <Field label="What happened"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="Rear bumper, minor" maxLength={1000} style={inputStyle(false)} /></Field>
          <Field label="Cost (AED, optional)"><input type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} style={inputStyle(false)} /></Field>
          <div>
            <button type="button" onClick={add} disabled={!date || busy}
              style={{ ...PRIMARY_BTN, padding: '9px 16px', opacity: !date || busy ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> Record
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function Driver(props) {
  const drivers   = useDrivers()
  const vehicles  = useVehicles()
  const companies = useCompanies()

  const vehicleById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles])
  const columns = useMemo(() => columnsFor(vehicleById), [vehicleById])

  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('driver')

  const [search,    setSearch]    = useState('')
  const [bgFilter,  setBgFilter]  = useState('')
  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [saving,  setSaving]  = useState(false)
  // A photo picked on a new driver waits here and uploads once the driver is saved.
  const [stagedPhoto, setStagedPhoto] = useState(null)
  const firstRef = useRef(null)
  const formRef  = useRef(null)
  const photoRef = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = drivers.filter(d => {
      if (bgFilter && d.companyId !== bgFilter) return false
      if (!q) return true
      const vehicle = d.vehicleId ? vehicleById.get(d.vehicleId) : null
      return [d.name, driverCode(d), d.employeeId, d.department, d.mobile, d.licenseNo, d.ibuttonCode, companyNameFor(d.companyId), vehicle && vehicleLabel(vehicle)]
        .some(s => String(s ?? '').toLowerCase().includes(q))
    })
    return list.sort((a, b) => a.name.localeCompare(b.name))
    // companies: BG names are searched through companyNameFor, which reads that store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, vehicleById, companies, search, bgFilter])

  const openAdd = () => {
    setErrors({})
    setStagedPhoto(null)
    // A BG already narrowed in the filter is almost certainly the one being added to.
    setDraft({ ...emptyDriver(), companyId: bgFilter })
  }
  const openEdit  = row => { setErrors({}); setStagedPhoto(null); setDraft({ ...emptyDriver(), ...row }) }
  const closeForm = ()  => { setErrors({}); setStagedPhoto(null); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A vehicle belongs to one BG, so the old pick is not an option under the new one.
      if (key === 'companyId') next.vehicleId = ''
      // A suspended driver is off duty and gives up the vehicle.
      if (key === 'status' && value === 'Suspended') next.vehicleId = ''
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const pickPhoto = async file => {
    if (!file) return
    try {
      const b64 = await squareJpegBase64(file)
      if (draft.id) {
        await setDriverPhoto(draft.id, b64)
        setDraft(d => ({ ...d, photoUrl: `data:image/jpeg;base64,${b64}` }))
        push('Photo updated', { tone: 'success' })
      } else {
        setStagedPhoto(b64)
        setDraft(d => ({ ...d, photoUrl: `data:image/jpeg;base64,${b64}` }))
      }
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  const dropPhoto = async () => {
    try {
      if (draft.id) await removeDriverPhoto(draft.id)
      setStagedPhoto(null)
      setDraft(d => ({ ...d, photoUrl: '' }))
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const bgVehicles = editing
    ? [...vehiclesForCompany(draft.companyId)].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
    : []
  // Who drives the picked vehicle now, if not this driver — saving takes it off them.
  const holder = editing && draft.vehicleId ? driverForVehicleId(draft.vehicleId) : null
  const takingFrom = holder && holder.id !== draft.id ? holder : null
  const bgLocked = IS_REAL && editing && !!draft.id
  const suspended = editing && draft.status === 'Suspended'

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)   next.companyId = 'BG is required'
    if (!draft.name.trim()) next.name      = 'Name is required'
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) next.email = 'Enter a valid email address'
    const tag = String(draft.ibuttonCode ?? '').replace(/[\s:-]/g, '').toUpperCase()
    if (tag && !/^[0-9A-F]{4,32}$/.test(tag)) next.ibuttonCode = 'Use the code as the tracker shows it, e.g. 94000001D9DF0801'
    else if (tag && /^0+$/.test(tag)) next.ibuttonCode = 'An all-zero code means no tag is inserted'
    else if (tag && isIbuttonTaken(tag, draft.id)) next.ibuttonCode = 'This iButton is already assigned to another driver.'

    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const trim = k => String(draft[k] ?? '').trim()
    const clean = {
      ...draft,
      name: trim('name'), mobile: trim('mobile'), email: trim('email'), nationality: trim('nationality'),
      employeeId: trim('employeeId'), licenseNo: trim('licenseNo'), licenseCategory: trim('licenseCategory'),
      licenseCountry: trim('licenseCountry'), emiratesId: trim('emiratesId'),
      ibuttonCode: tag,
      notes: trim('notes'),
    }
    const vehicle = clean.vehicleId ? vehicleById.get(clean.vehicleId) : null
    setSaving(true)
    try {
      const { row, movedFrom } = draft.id
        ? await updateDriver(draft.id, clean)
        : await addDriver(clean)
      if (!draft.id && stagedPhoto && row?.id) {
        try { await setDriverPhoto(row.id, stagedPhoto) } catch (err) { handleApiError(err, { push }) }
      }
      push(`${clean.name} ${draft.id ? 'updated' : 'added'}`, { tone: 'success' })
      if (movedFrom) {
        push(`Vehicle ${vehicleLabel(vehicle)} moved from ${movedFrom.name}`, { tone: 'info' })
      }
      setStagedPhoto(null)
      setDraft(null)
    } catch (err) {
      // A vehicle outside the driver's BG comes back 400 against `vehicleId`,
      // the same name the select carries, so it lands under the right control.
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const row = pending
    setPending(null)
    try {
      await removeDriver(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Driver' : draft.id ? 'Edit Driver' : 'Add Driver'
  const filtering = !!search.trim() || !!bgFilter

  const text = (name, label, { placeholder, max = 120, type = 'text', required = false } = {}) => (
    <Field label={label} required={required} error={errors[name]}>
      <input
        name={name}
        type={type}
        value={draft[name] ?? ''}
        onChange={e => set(name, e.target.value)}
        aria-invalid={!!errors[name] || undefined}
        placeholder={placeholder}
        maxLength={max}
        style={inputStyle(!!errors[name])}
      />
    </Field>
  )
  const date = (name, label) => (
    <Field label={label} error={errors[name]}>
      <input name={name} type="date" value={draft[name] ?? ''} onChange={e => set(name, e.target.value)}
        aria-invalid={!!errors[name] || undefined} style={inputStyle(!!errors[name])} />
    </Field>
  )

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? `Driver details · ${driverCode(draft)}` : 'New driver'}
            subtitle="Fields marked with * are required. A vehicle has one driver — choosing one that is already driven moves it to this driver."
          >
            {/* ── Profile ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
              <Avatar driver={draft} size={64} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input ref={photoRef} type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
                <button type="button" className="ft-btn" onClick={() => photoRef.current?.click()} style={{ padding: '7px 12px', fontSize: 12 }}>
                  <Camera size={14} /> {draft.photoUrl ? 'Change photo' : 'Add photo'}
                </button>
                {draft.photoUrl && (
                  <button type="button" className="ft-btn" onClick={dropPhoto} style={{ padding: '7px 12px', fontSize: 12 }}>
                    <Trash2 size={14} /> Remove
                  </button>
                )}
              </div>
            </div>

            <SectionTitle>Profile</SectionTitle>
            <div style={GRID}>
              {/* Locked on an existing driver in real mode: the API takes a
                  driver's BG only at creation, and checks its vehicle against it. */}
              <Field
                label="BG (Business Group)"
                required
                error={errors.companyId}
                hint={bgLocked ? 'A driver cannot be moved to another BG.' : undefined}
              >
                <select
                  ref={firstRef}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  disabled={bgLocked}
                  aria-invalid={!!errors.companyId || undefined}
                  style={bgLocked ? { ...inputStyle(!!errors.companyId), opacity: 0.6, cursor: 'not-allowed' } : inputStyle(!!errors.companyId)}
                >
                  <option value="">— Select —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              {text('name', 'Full Name', { placeholder: 'Ahmed Khan', required: true })}
              {text('employeeId', 'Employee ID', { placeholder: 'EMP-1042', max: 60 })}
              <Field label="Department" error={errors.department}>
                <select name="department" value={draft.department ?? ''} onChange={e => set('department', e.target.value)} style={inputStyle(!!errors.department)}>
                  <option value="">— None —</option>
                  {DRIVER_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              {text('mobile', 'Mobile', { placeholder: '+971 50 123 4567', max: 30, type: 'tel' })}
              {text('email', 'Email', { placeholder: 'ahmed@company.ae', max: 200, type: 'email' })}
              {text('nationality', 'Nationality', { placeholder: 'Pakistan', max: 60 })}
              {date('dateOfBirth', 'Date of Birth')}
              {date('joiningDate', 'Joining Date')}
              <Field label="Status" hint={suspended ? 'Off duty: cannot be given a vehicle.' : undefined}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Active', 'Inactive', 'Suspended'].map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`ft-btn${draft.status === s ? ' ft-btn--active' : ''}`}
                      aria-pressed={draft.status === s}
                      onClick={() => set('status', s)}
                      style={{ flex: 1, justifyContent: 'center', padding: '8px 6px', fontSize: 12 }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* ── Licence ─────────────────────────────────────────────── */}
            <SectionTitle>Driving Licence</SectionTitle>
            <div style={GRID}>
              {text('licenseNo', 'Licence Number', { placeholder: 'AD-4471920', max: 60 })}
              <Field label="Licence Category" error={errors.licenseCategory}>
                <input name="licenseCategory" list="driver-licence-categories" value={draft.licenseCategory ?? ''}
                  onChange={e => set('licenseCategory', e.target.value)} placeholder="Light Vehicle" maxLength={60} style={inputStyle(!!errors.licenseCategory)} />
                <datalist id="driver-licence-categories">
                  {LICENCE_CATEGORIES.map(c => <option key={c} value={c} />)}
                </datalist>
              </Field>
              {date('licenseIssueDate', 'Issue Date')}
              <ExpiryField label="Expiry Date" name="licenseExpiry" value={draft.licenseExpiry} error={errors.licenseExpiry} onChange={set} />
              {text('licenseCountry', 'Issuing Country', { placeholder: 'United Arab Emirates', max: 60 })}
            </div>

            {/* ── IDs and other papers ───────────────────────────────── */}
            <SectionTitle note="An expiry alert can warn before any of these runs out (Settings › Alerts › Driver Licence & Document Expiry).">
              Visa, Emirates ID &amp; Medical
            </SectionTitle>
            <div style={GRID}>
              <ExpiryField label="Visa Expiry" name="visaExpiry" value={draft.visaExpiry} error={errors.visaExpiry} onChange={set} />
              {text('emiratesId', 'Emirates ID Number', { placeholder: '784-1990-1234567-1', max: 30 })}
              <ExpiryField label="Emirates ID Expiry" name="emiratesIdExpiry" value={draft.emiratesIdExpiry} error={errors.emiratesIdExpiry} onChange={set} />
              <ExpiryField label="Medical Fitness Expiry" name="medicalExpiry" value={draft.medicalExpiry} error={errors.medicalExpiry} onChange={set} />
            </div>

            {/* ── Assignment ──────────────────────────────────────────── */}
            <SectionTitle>Vehicle &amp; Driver ID</SectionTitle>
            <div style={GRID}>
              <Field
                label="Vehicle"
                error={errors.vehicleId}
                hint={suspended ? 'A suspended driver cannot be given a vehicle.' : takingFrom ? `Saving moves this vehicle from ${takingFrom.name}.` : undefined}
              >
                <select
                  name="vehicleId"
                  value={draft.vehicleId}
                  onChange={e => set('vehicleId', e.target.value)}
                  disabled={suspended || !draft.companyId || bgVehicles.length === 0}
                  aria-invalid={!!errors.vehicleId || undefined}
                  style={{ ...inputStyle(!!errors.vehicleId), opacity: suspended || !draft.companyId || bgVehicles.length === 0 ? 0.6 : 1 }}
                >
                  <option value="">
                    {!draft.companyId ? '— Select a BG first —' : bgVehicles.length === 0 ? '— No vehicles for this BG —' : '— None —'}
                  </option>
                  {bgVehicles.map(v => {
                    const current = driverForVehicleId(v.id)
                    const other = current && current.id !== draft.id ? current : null
                    return (
                      <option key={v.id} value={v.id}>
                        {vehicleLabel(v)}{other ? ` — currently ${other.name}` : ''}
                      </option>
                    )
                  })}
                </select>
              </Field>
              <Field
                label="iButton / Driver ID"
                error={errors.ibuttonCode}
                hint="The tag code the tracker reports (Live Map › Live Data › ibutton.code)"
              >
                <input
                  name="ibuttonCode"
                  value={draft.ibuttonCode ?? ''}
                  onChange={e => set('ibuttonCode', e.target.value)}
                  aria-invalid={!!errors.ibuttonCode || undefined}
                  placeholder="94000001D9DF0801"
                  maxLength={48}
                  autoComplete="off"
                  style={{ ...inputStyle(!!errors.ibuttonCode), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </Field>
            </div>

            <div style={{ marginTop: 14 }}>
              <Field label="Notes" error={errors.notes}>
                <textarea
                  name="notes"
                  value={draft.notes}
                  onChange={e => set('notes', e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Shift, depot, anything the next operator should know"
                  style={{ ...inputStyle(!!errors.notes), resize: 'vertical', fontFamily: 'inherit' }}
                />
              </Field>
            </div>

            {/* ── Assignment history and incidents (server only) ──────── */}
            <SectionTitle note="Who drove which vehicle when — trips without an iButton tag are credited by these dates.">Assignment History</SectionTitle>
            {!IS_REAL ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Assignment history is kept on the server, so it is not available in demo mode.</div>
            ) : !draft.id ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Save the driver first; the Vehicle above then starts the Primary assignment.</div>
            ) : (
              <DriverAssignments driver={draft} canWrite={access.canWrite} push={push} />
            )}

            <SectionTitle note="Accidents and incidents count against the driver's safety score.">Accident &amp; Incident Records</SectionTitle>
            {!IS_REAL ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Incident records are kept on the server, so they are not available in demo mode.</div>
            ) : !draft.id ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Save the driver first, then open it again to record incidents.</div>
            ) : (
              <DriverIncidents driver={draft} canWrite={access.canWrite} push={push} />
            )}

            {/* ── Documents ───────────────────────────────────────────── */}
            <SectionTitle note="Scanned copies: licence, visa, Emirates ID, passport, medical.">Documents</SectionTitle>
            {!IS_REAL ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Document uploads are kept on the server, so they are not available in demo mode.</div>
            ) : !draft.id ? (
              <div style={{ fontSize: 12, color: 'var(--c-text3)' }}>Save the driver first, then open it again to upload documents.</div>
            ) : (
              <DriverDocuments driver={draft} canWrite={access.canWrite} push={push} />
            )}

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                setStagedPhoto(null)
                const saved = draft.id ? drivers.find(d => d.id === draft.id) : null
                setDraft(saved ? { ...emptyDriver(), ...saved } : emptyDriver())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
              saving={saving}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <PageNotice {...access} />

          {!access.loading && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                  <Search
                    size={13}
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }}
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Name, ID, employee no., licence or vehicle"
                    aria-label="Search drivers"
                    style={{ ...inputStyle(false), paddingLeft: 30 }}
                  />
                </div>
                {companies.length > 1 && (
                  <select
                    value={bgFilter}
                    onChange={e => setBgFilter(e.target.value)}
                    aria-label="Filter by BG"
                    style={{ ...inputStyle(false), flex: '0 1 240px', width: 'auto', minWidth: 180 }}
                  >
                    <option value="">All BGs</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>

              <TableToolbar count={rows.length} noun="driver" plural="drivers">
                {access.canAdd && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                    disabled={noCompanies}
                    // A driver has to belong to a BG, so with none on file the
                    // form would open with an unsatisfiable required dropdown.
                    title={noCompanies ? 'Add a BG first' : undefined}
                    onClick={openAdd}
                  >
                    <Plus size={14} strokeWidth={2.6} />
                    Add Driver
                  </button>
                )}
              </TableToolbar>

              <SettingsTable
                columns={columns}
                rows={rows}
                onEdit={openEdit}
                onDelete={access.canDelete ? setPending : null}
                canWrite={access.canWrite}
                emptyLabel={
                  filtering && drivers.length > 0
                    ? 'No drivers match the current search.'
                    : !access.canWrite
                      ? 'No drivers to show.'
                      : noCompanies
                        ? 'No BGs on file — add a Business Group before adding drivers.'
                        : 'No drivers yet — use Add Driver to add one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete driver?"
          body={`${pending.name} will be removed from ${companyNameFor(pending.companyId)}, with their photo and uploaded documents.`}
          note={[
            pending.vehicleId ? `${vehicleLabel(vehicleById.get(pending.vehicleId))} is left without a driver.` : null,
            modeNote('This cannot be undone.', 'This is mock data — nothing is sent to a server.'),
          ].filter(Boolean).join(' ')}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
