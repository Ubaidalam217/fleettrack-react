import { useState, useRef, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, Search, Camera, Trash2, FileText, Upload, ExternalLink,
  UserRound, IdCard, ShieldCheck, Car, History, TriangleAlert, Paperclip,
  ClipboardList, CalendarX, MapPin, Check, HeartPulse,
} from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import { DFM_CSS, ctl, ACTION_BTN } from './alignedFormStyles'
import { DF, DAction, DSection, ReadOnly } from './AlignedForm'
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
  listDriverLeaves, addDriverLeave, deleteDriverLeave, LEAVE_TYPES, TAG_TYPES,
  listUnregisteredDriverIds,
} from '../../data/settings'
import UnregisteredDriverIds from './UnregisteredDriverIds'
import UnregisteredDriverDialog from '../../components/tracking/UnregisteredDriverDialog'
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
  ['lifeInsuranceExpiry', 'Life insurance'],
  ['mediclaimExpiry',     'Mediclaim'],
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
  { key: 'driverNo',  label: 'Driver No.', render: row => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{driverCode(row)}</span> },
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
  { key: 'company',    label: 'Business Group', render: row => companyNameFor(row.companyId) },
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
  { key: 'ibuttonCode', label: 'Driver ID', render: row => row.ibuttonCode || '—' },
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

/** A date with its expiry chip on the label line (a valid save even when expired). */
function ExpiryField({ label, name, value, error, onChange, span = 6 }) {
  const id = `drv-${name}`
  return (
    <DF id={id} label={label} error={error} span={span}
      aside={!error && licenceExpiryState(value).state !== 'none' ? <ExpiryChip expiry={value} /> : null}>
      <input id={id} name={name} type="date" value={value ?? ''} onChange={e => onChange(name, e.target.value)}
        aria-invalid={!!error || undefined} style={ctl(!!error)} />
    </DF>
  )
}

/** Whole years from a "YYYY-MM-DD" date to today; null when unset or in the future. */
function yearsSince(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let y = now.getFullYear() - d.getFullYear()
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) y -= 1
  return y >= 0 ? y : null
}
const yearsLabel = n => (n === null ? '—' : `${n} year${n === 1 ? '' : 's'}`)

/** Yes / No as the same 40px segmented control the Status field uses. */
function YesNo({ id, value, onChange, disabled }) {
  return (
    <div className="dfm-seg" role="radiogroup" aria-labelledby={`${id}-label`} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
        <button key={l} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

/**
 * Licence classes as toggle chips ("License to Drive" takes several in the
 * reference). Stored comma separated in licenseCategory, so a single class
 * saved before reads back as one chip; a class typed in "Other" becomes a chip.
 */
function LicenceClasses({ value, onChange, disabled }) {
  const picked = String(value ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const all = [...LICENCE_CATEGORIES, ...picked.filter(x => !LICENCE_CATEGORIES.includes(x))]
  const [other, setOther] = useState('')
  const save = list => onChange(list.join(', '))
  const toggle = c => save(picked.includes(c) ? picked.filter(x => x !== c) : [...picked, c])
  const addOther = () => {
    const c = other.trim()
    if (c && !picked.some(x => x.toLowerCase() === c.toLowerCase())) save([...picked, c])
    setOther('')
  }
  return (
    <div className="dfm-chips" role="group" aria-labelledby="drv-licenseCategory-label">
      {all.map(c => {
        const on = picked.includes(c)
        return (
          <button key={c} type="button" className="dfm-chip" role="checkbox" aria-checked={on} disabled={disabled} onClick={() => toggle(c)}>
            {on && <Check size={13} strokeWidth={3} aria-hidden="true" />}{c}
          </button>
        )
      })}
      <input
        className="dfm-chip-add"
        value={other}
        onChange={e => setOther(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOther() } }}
        onBlur={addOther}
        placeholder="+ Other class"
        aria-label="Add another licence class"
        maxLength={40}
        disabled={disabled}
      />
    </div>
  )
}

const UAE_EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']
const COUNTRIES = ['United Arab Emirates', 'Saudi Arabia', 'Oman', 'Qatar', 'Bahrain', 'Kuwait', 'Pakistan', 'India', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Philippines', 'Egypt']

/** Which tab holds each form field, so a failed save can open the right one. */
const PROFILE_FIELDS = new Set([
  'companyId', 'name', 'employeeId', 'department', 'status', 'nationality', 'mobile', 'contactNumber2', 'email',
  'street1', 'street2', 'city', 'state', 'country', 'zipCode', 'vehicleId', 'tagType', 'ibuttonCode', 'notes',
])
const tabOfField = f => (PROFILE_FIELDS.has(f) ? 'profile' : 'additional')

const FORM_TABS = [
  { id: 'profile',    label: 'Profile',         icon: UserRound },
  { id: 'additional', label: 'Additional Info', icon: ClipboardList },
  { id: 'leave',      label: 'Leave',           icon: CalendarX },
  { id: 'documents',  label: 'Documents',       icon: FileText },
  { id: 'history',    label: 'History',         icon: History },
]

const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Scanned copies of a saved driver's papers (real mode only — they live on the server). */
function DriverDocuments({ driver, canWrite, push }) {
  const [docs, setDocs] = useState(null)
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState(DRIVER_DOC_TYPES[0])
  const [issued, setIssued] = useState('')
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
        title: title.trim() || file.name, docType, issueDate: issued || null, expiryDate: expiry || null, fileName: file.name, data: await fileToBase64(file),
      })
      push(`${title.trim() || file.name} uploaded`, { tone: 'success' })
      setTitle(''); setIssued(''); setExpiry(''); setFile(null)
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
        <div className="dfm-empty">Loading documents…</div>
      ) : docs.length === 0 ? (
        <div className="dfm-empty">No documents uploaded yet.</div>
      ) : (
        <div className="dfm-list">
          {docs.map(d => (
            <div key={d.id} className="dfm-row">
              <FileText size={16} style={{ color: 'var(--ft-accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{d.title}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
                  {d.docType} · {d.fileName} · {fmtSize(d.size)}
                  {d.issueDate ? ` · issued ${formatExpiryDate(d.issueDate)}` : ''}{d.expiryDate ? ` · expires ${formatExpiryDate(d.expiryDate)}` : ''}
                </div>
              </div>
              {d.expiryDate && <ExpiryChip expiry={d.expiryDate} />}
              <button type="button" className="ft-btn" onClick={() => openDriverDocument(driver.id, d.id).catch(err => push(err.message, { tone: 'error' }))}
                style={SMALL_BTN} title="Open">
                <ExternalLink size={13} /> Open
              </button>
              {canWrite && (
                <button type="button" className="ft-btn" onClick={() => remove(d)} style={SMALL_BTN} aria-label={`Delete ${d.title}`} title="Delete">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <>
          <div className="dfm-grid">
            <DF id="drv-doc-type" label="Document type" span={6}>
              <select id="drv-doc-type" value={docType} onChange={e => setDocType(e.target.value)} style={ctl(false)}>
                {DRIVER_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </DF>
            <DF id="drv-doc-title" label="Document name" span={6}>
              <input id="drv-doc-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Licence (front)" maxLength={120} style={ctl(false)} />
            </DF>
          </div>
          <div className="dfm-grid">
            <DF id="drv-doc-issued" label="Issue date" span={3}>
              <input id="drv-doc-issued" type="date" value={issued} onChange={e => setIssued(e.target.value)} style={ctl(false)} />
            </DF>
            <DF id="drv-doc-expiry" label="Expiry date" span={3}>
              <input id="drv-doc-expiry" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} style={ctl(false)} />
            </DF>
            <DF id="drv-doc-file" label="File" span={3} hint="PDF, JPEG, PNG or WebP · max 5 MB">
              <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <button id="drv-doc-file" type="button" className="dfm-file" onClick={() => fileRef.current?.click()} title={file?.name}>
                <Paperclip size={15} style={{ color: 'var(--ft-accent)', flexShrink: 0 }} />
                <span>{file ? file.name : 'Choose a file…'}</span>
              </button>
            </DF>
            <DAction>
              <button type="button" onClick={upload} disabled={!file || busy} style={{ ...ACTION_BTN, opacity: !file || busy ? 0.55 : 1 }}>
                <Upload size={14} /> {busy ? 'Uploading…' : 'Upload'}
              </button>
            </DAction>
          </div>
        </>
      )}
    </>
  )
}

const todayStr = () => new Date().toLocaleDateString('en-CA')
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
        <div className="dfm-empty">Loading assignments…</div>
      ) : rows.length === 0 ? (
        <div className="dfm-empty">No assignments yet. The Default vehicle on the Profile tab starts the Primary one.</div>
      ) : (
        <div className="dfm-list">
          {rows.map(a => (
            <div key={a.id} className="dfm-row">
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
                <button type="button" className="ft-btn" onClick={() => drop(a)} style={SMALL_BTN} aria-label="Delete assignment" title="Delete"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {canWrite && driver.status !== 'Suspended' && (
        <>
          <div className="dfm-grid">
            <DF id="drv-asg-vehicle" label="Temporary vehicle" span={6}>
              <select id="drv-asg-vehicle" value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={ctl(false)}>
                <option value="">— Choose —</option>
                {bgVehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
              </select>
            </DF>
            <DF id="drv-asg-from" label="From" span={3}>
              <input id="drv-asg-from" type="date" value={from} onChange={e => setFrom(e.target.value)} style={ctl(false)} />
            </DF>
            <DF id="drv-asg-to" label="To (optional)" span={3}>
              <input id="drv-asg-to" type="date" value={to} onChange={e => setTo(e.target.value)} style={ctl(false)} />
            </DF>
          </div>
          <div className="dfm-grid">
            <DF id="drv-asg-note" label="Note" span={9}>
              <input id="drv-asg-note" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Leave cover" maxLength={300} style={ctl(false)} />
            </DF>
            <DAction>
              <button type="button" onClick={add} disabled={!vehicleId || !from || busy}
                style={{ ...ACTION_BTN, opacity: !vehicleId || !from || busy ? 0.55 : 1 }}>
                <Plus size={14} /> Add assignment
              </button>
            </DAction>
          </div>
        </>
      )}
    </>
  )
}

/** Days from one "YYYY-MM-DD" to another, both counted; '' when either is missing. */
const spanDays = (from, to) => {
  if (!from || !to) return ''
  const n = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000) + 1
  return n > 0 ? String(n) : ''
}

/** The driver's leave register ("Leave" tab in the reference). */
function DriverLeaves({ driver, canWrite, push }) {
  const [rows, setRows] = useState(null)
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0])
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState('')
  const [days, setDays] = useState('')
  const [daysTouched, setDaysTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => listDriverLeaves(driver.id).then(setRows).catch(err => { setRows([]); handleApiError(err, { push }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [driver.id])
  // The number of days follows the dates until it is typed over (working days differ).
  const shownDays = daysTouched ? days : spanDays(from, to)

  const add = async () => {
    setBusy(true)
    try {
      await addDriverLeave(driver.id, { leaveType, validFrom: from, validTo: to || null, days: shownDays === '' ? null : shownDays, notes: notes.trim() || null })
      push(`${leaveType} leave added`, { tone: 'success' })
      setTo(''); setDays(''); setDaysTouched(false); setNotes('')
      await load()
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setBusy(false)
    }
  }
  const drop = async l => {
    try { await deleteDriverLeave(driver.id, l.id); await load() } catch (err) { handleApiError(err, { push }) }
  }
  const today = todayStr()

  return (
    <>
      {rows === null ? (
        <div className="dfm-empty">Loading leave…</div>
      ) : rows.length === 0 ? (
        <div className="dfm-empty">No leave on record.</div>
      ) : (
        <div className="dfm-list">
          {rows.map(l => {
            const now = l.validFrom <= today && (!l.validTo || l.validTo >= today)
            return (
              <div key={l.id} className="dfm-row">
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                  color: 'var(--ft-accent)', background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
                }}>{l.leaveType}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>
                    {formatExpiryDate(l.validFrom)} → {l.validTo ? formatExpiryDate(l.validTo) : 'open'}
                    {l.days != null ? ` · ${l.days} day${l.days === 1 ? '' : 's'}` : ''}
                  </div>
                  {l.notes && <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>{l.notes}</div>}
                </div>
                {now && <Pill tone={EXPIRY_TONE.expiring}>On leave now</Pill>}
                {canWrite && (
                  <button type="button" className="ft-btn" onClick={() => drop(l)} style={SMALL_BTN} aria-label={`Delete ${l.leaveType} leave`} title="Delete"><Trash2 size={13} /></button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canWrite && (
        <>
          <div className="dfm-grid">
            <DF id="drv-lv-type" label="Leave type" span={4}>
              <select id="drv-lv-type" value={leaveType} onChange={e => setLeaveType(e.target.value)} style={ctl(false)}>
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </DF>
            <DF id="drv-lv-from" label="Valid from" required span={4}>
              <input id="drv-lv-from" type="date" value={from} onChange={e => setFrom(e.target.value)} style={ctl(false)} />
            </DF>
            <DF id="drv-lv-to" label="Valid to" span={4}>
              <input id="drv-lv-to" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={ctl(false)} />
            </DF>
          </div>
          <div className="dfm-grid">
            <DF id="drv-lv-days" label="No. of days" span={3}>
              <input id="drv-lv-days" type="number" min="0" max="366" inputMode="numeric" value={shownDays}
                onChange={e => { setDaysTouched(true); setDays(e.target.value) }} placeholder="Auto" style={ctl(false)} />
            </DF>
            <DF id="drv-lv-note" label="Note" span={6}>
              <input id="drv-lv-note" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Travelling home" maxLength={300} style={ctl(false)} />
            </DF>
            <DAction>
              <button type="button" onClick={add} disabled={!from || busy} style={{ ...ACTION_BTN, opacity: !from || busy ? 0.55 : 1 }}>
                <Plus size={14} /> Add leave
              </button>
            </DAction>
          </div>
        </>
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
        <div className="dfm-empty">Loading incidents…</div>
      ) : rows.length === 0 ? (
        <div className="dfm-empty">No incidents on record.</div>
      ) : (
        <div className="dfm-list">
          {rows.map(i => (
            <div key={i.id} className="dfm-row">
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, color: '#ef4444', background: 'rgba(239,68,68,0.1)', flexShrink: 0 }}>{i.type}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text1)' }}>{i.description || i.type}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text3)' }}>
                  {formatExpiryDate(i.date)}{i.vehicle ? ` · ${i.vehicle.plateNo || i.vehicle.fleetNo || i.vehicle.imei}` : ''}{i.cost != null ? ` · AED ${i.cost.toLocaleString()}` : ''}
                </div>
              </div>
              {canWrite && <button type="button" className="ft-btn" onClick={() => drop(i)} style={SMALL_BTN} aria-label={`Delete ${i.type}`} title="Delete"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {canWrite && (
        <>
          <div className="dfm-grid">
            <DF id="drv-inc-date" label="Date" span={3}>
              <input id="drv-inc-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={ctl(false)} />
            </DF>
            <DF id="drv-inc-type" label="Type" span={3}>
              <select id="drv-inc-type" value={type} onChange={e => setType(e.target.value)} style={ctl(false)}>
                {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </DF>
            <DF id="drv-inc-vehicle" label="Vehicle (optional)" span={6}>
              <select id="drv-inc-vehicle" value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={ctl(false)}>
                <option value="">— None —</option>
                {bgVehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
              </select>
            </DF>
          </div>
          <div className="dfm-grid">
            <DF id="drv-inc-what" label="What happened" span={6}>
              <input id="drv-inc-what" value={description} onChange={e => setDescription(e.target.value)} placeholder="Rear bumper, minor" maxLength={1000} style={ctl(false)} />
            </DF>
            <DF id="drv-inc-cost" label="Cost (AED, optional)" span={3}>
              <input id="drv-inc-cost" type="number" min="0" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0" style={ctl(false)} />
            </DF>
            <DAction>
              <button type="button" onClick={add} disabled={!date || busy} style={{ ...ACTION_BTN, opacity: !date || busy ? 0.55 : 1 }}>
                <Plus size={14} /> Record
              </button>
            </DAction>
          </div>
        </>
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
  const [tab, setTab] = useState('profile')

  useEffect(() => {
    if (editing) {
      setTab('profile')
      firstRef.current?.focus()
    }
  }, [editing])

  // A field error that appears on another tab (a server reply, say) opens that tab.
  const errKeysRef = useRef([])
  useEffect(() => {
    const keys = Object.keys(errors).filter(k => errors[k])
    const added = keys.filter(k => !errKeysRef.current.includes(k))
    errKeysRef.current = keys
    if (added.length && !keys.some(k => tabOfField(k) === tab)) setTab(tabOfField(added[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors])
  const invalidTabs = new Set(Object.keys(errors).filter(k => errors[k]).map(tabOfField))

  // Driver IDs the trackers read that no driver holds (client, 2026-11-09).
  // Fetched again whenever the drivers change, so a registered one drops off.
  const [unregistered, setUnregistered] = useState([])
  const [assigning, setAssigning] = useState(null)
  useEffect(() => {
    let live = true
    listUnregisteredDriverIds().then(rows => { if (live) setUnregistered(rows ?? []) }).catch(() => {})
    return () => { live = false }
  }, [drivers])

  // "Register" from the Live Map arrives as ?register=<Driver ID>&bg=<Business Group>.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const code = params.get('register')
    if (!code || access.loading || !access.canAdd) return
    setErrors({})
    setStagedPhoto(null)
    setDraft({ ...emptyDriver(), companyId: params.get('bg') || bgFilter, ibuttonCode: code })
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, access.loading, access.canAdd])

  const registerId = row => {
    setErrors({})
    setStagedPhoto(null)
    setDraft({ ...emptyDriver(), companyId: row.vehicle?.bgId || bgFilter, ibuttonCode: row.code })
  }

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
    if (!draft.companyId)   next.companyId = 'Business Group is required'
    if (!draft.name.trim()) next.name      = 'Name is required'
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) next.email = 'Enter a valid email address'
    const tag = String(draft.ibuttonCode ?? '').replace(/[\s:-]/g, '').toUpperCase()
    if (tag && !/^[0-9A-F]{4,32}$/.test(tag)) next.ibuttonCode = 'Use the code as the tracker shows it, e.g. 94000001D9DF0801'
    else if (tag && /^0+$/.test(tag)) next.ibuttonCode = 'An all-zero code means no tag is inserted'
    else if (tag && isIbuttonTaken(tag, draft.id)) next.ibuttonCode = 'This Driver ID is already assigned to another driver.'

    if (Object.keys(next).length) {
      setErrors(next)
      const first = Object.keys(next)[0]
      setTab(tabOfField(first))
      setTimeout(() => formRef.current?.querySelector(`[name="${first}"]`)?.focus(), 0)
      return
    }

    const trim = k => String(draft[k] ?? '').trim()
    const clean = {
      ...draft,
      name: trim('name'), mobile: trim('mobile'), email: trim('email'), nationality: trim('nationality'),
      employeeId: trim('employeeId'), licenseNo: trim('licenseNo'), licenseCategory: trim('licenseCategory'),
      licenseCountry: trim('licenseCountry'), emiratesId: trim('emiratesId'),
      contactNumber2: trim('contactNumber2'), country: trim('country'), state: trim('state'), city: trim('city'),
      zipCode: trim('zipCode'), street1: trim('street1'), street2: trim('street2'),
      lifeInsuranceNo: trim('lifeInsuranceNo'), mediclaimNo: trim('mediclaimNo'),
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

  const fid = name => `drv-${name}`
  const text = (name, label, { placeholder, max = 120, type = 'text', required = false, span = 4, inputMode } = {}) => (
    <DF id={fid(name)} label={label} required={required} error={errors[name]} span={span}>
      <input
        id={fid(name)}
        name={name}
        type={type}
        inputMode={inputMode}
        value={draft[name] ?? ''}
        onChange={e => set(name, e.target.value)}
        aria-invalid={!!errors[name] || undefined}
        aria-required={required || undefined}
        placeholder={placeholder}
        maxLength={max}
        // The form is about someone else: the browser's own name and e-mail would be wrong.
        autoComplete="off"
        style={ctl(!!errors[name])}
      />
    </DF>
  )
  const date = (name, label, span = 4) => (
    <DF id={fid(name)} label={label} error={errors[name]} span={span}>
      <input id={fid(name)} name={name} type="date" value={draft[name] ?? ''} onChange={e => set(name, e.target.value)}
        aria-invalid={!!errors[name] || undefined} style={ctl(!!errors[name])} />
    </DF>
  )
  const resetForm = () => {
    setErrors({})
    setStagedPhoto(null)
    const saved = draft.id ? drivers.find(d => d.id === draft.id) : null
    setDraft(saved ? { ...emptyDriver(), ...saved } : emptyDriver())
  }
  const busyBtn = saving ? { opacity: 0.6, cursor: 'not-allowed' } : null
  const serverOnly = (what, after) => (
    <div className="dfm-empty">
      {!IS_REAL ? `${what} kept on the server, so not available in demo mode.` : after}
    </div>
  )

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate className="dfm">
          <style>{DFM_CSS}</style>

          {/* ── Who ─────────────────────────────────────────────────── */}
          <div className="dfm-hero">
            <Avatar driver={draft} size={72} />
            <div className="dfm-hero-main">
              <div className={`dfm-hero-name${draft.name.trim() ? '' : ' empty'}`}>{draft.name.trim() || 'New driver'}</div>
              <div className="dfm-hero-meta">
                {draft.id && <span className="dfm-code">{driverCode(draft)}</span>}
                {draft.companyId && <span>{companyNameFor(draft.companyId)}</span>}
                <Pill tone={STATUS_TONE[draft.status] || STATUS_TONE.Inactive}>{draft.status}</Pill>
              </div>
            </div>
            <div className="dfm-hero-act">
              <input ref={photoRef} type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
              <button type="button" onClick={() => photoRef.current?.click()} style={{ ...SECONDARY_BTN, height: 38 }}>
                <Camera size={14} /> {draft.photoUrl ? 'Change photo' : 'Add photo'}
              </button>
              {draft.photoUrl && (
                <button type="button" onClick={dropPhoto} style={{ ...SECONDARY_BTN, height: 38 }}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </div>

          {/* ── Tabs, as in the reference: Profile / Additional Info / Leave / Document ── */}
          <div className="dfm-tabs" role="tablist" aria-label="Driver form">
            {FORM_TABS.map((t, i) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  id={`drv-tab-${t.id}`}
                  type="button"
                  role="tab"
                  className="dfm-tab"
                  aria-selected={tab === t.id}
                  aria-controls={`drv-panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={e => {
                    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                    if (!step) return
                    e.preventDefault()
                    const next = FORM_TABS[(i + step + FORM_TABS.length) % FORM_TABS.length].id
                    setTab(next)
                    document.getElementById(`drv-tab-${next}`)?.focus()
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {t.label}
                  {invalidTabs.has(t.id) && <span className="dfm-tab-dot" aria-label="has errors" />}
                </button>
              )
            })}
          </div>

          {/* ── Profile ─────────────────────────────────────────────── */}
          <div role="tabpanel" id="drv-panel-profile" aria-labelledby="drv-tab-profile" hidden={tab !== 'profile'}>
            <DSection icon={UserRound} title="Personal details" desc="Who the driver is.">
              <div className="dfm-grid">
                {/* Locked on an existing driver in real mode: the API takes a
                    driver's BG only at creation, and checks its vehicle against it. */}
                <DF
                  id={fid('companyId')}
                  label="Business Group"
                  required
                  error={errors.companyId}
                  span={6}
                  hint={bgLocked ? 'A driver cannot be moved to another Business Group.' : undefined}
                >
                  <select
                    ref={firstRef}
                    id={fid('companyId')}
                    name="companyId"
                    value={draft.companyId}
                    onChange={e => set('companyId', e.target.value)}
                    disabled={bgLocked}
                    aria-invalid={!!errors.companyId || undefined}
                    aria-required="true"
                    style={ctl(!!errors.companyId, bgLocked ? { opacity: 0.6, cursor: 'not-allowed' } : null)}
                  >
                    <option value="">— Select —</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </DF>
                {text('name', 'Full name', { placeholder: 'Ahmed Khan', required: true, span: 6 })}

                {text('employeeId', 'Employee number', { placeholder: 'EMP-1042', max: 60 })}
                <DF id={fid('department')} label="Department" error={errors.department}>
                  <select id={fid('department')} name="department" value={draft.department ?? ''} onChange={e => set('department', e.target.value)} style={ctl(!!errors.department)}>
                    <option value="">— None —</option>
                    {DRIVER_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </DF>
                <DF id={fid('status')} label="Status" group hint={suspended ? 'Off duty: cannot be given a vehicle.' : undefined}>
                  <div className="dfm-seg" role="radiogroup" aria-labelledby={`${fid('status')}-label`}>
                    {['Active', 'Inactive', 'Suspended'].map(s => (
                      <button key={s} type="button" role="radio" aria-checked={draft.status === s} onClick={() => set('status', s)}>
                        <i style={{ background: STATUS_TONE[s].color }} aria-hidden="true" />{s}
                      </button>
                    ))}
                  </div>
                </DF>
                {text('nationality', 'Nationality', { placeholder: 'Pakistan', max: 60, span: 12 })}
              </div>
            </DSection>

            <DSection icon={MapPin} title="Contact & address" desc="How to reach the driver, and where they live.">
              <div className="dfm-grid">
                {text('mobile', 'Contact number 1', { placeholder: '+971 50 123 4567', max: 30, type: 'tel', inputMode: 'tel' })}
                {text('contactNumber2', 'Contact number 2', { placeholder: '+971 4 555 1234', max: 30, type: 'tel', inputMode: 'tel' })}
                {text('email', 'Email', { placeholder: 'ahmed@company.ae', max: 200, type: 'email' })}

                {text('street1', 'Street 1', { placeholder: 'Building, street', max: 200, span: 6 })}
                {text('street2', 'Street 2', { placeholder: 'Area, landmark', max: 200, span: 6 })}

                {text('city', 'City', { placeholder: 'Mussafah', max: 60, span: 3 })}
                <DF id={fid('state')} label="State / Emirate" error={errors.state} span={3}>
                  <input id={fid('state')} name="state" list={/emirates|uae/i.test(draft.country ?? '') ? 'drv-emirates' : undefined}
                    value={draft.state ?? ''} onChange={e => set('state', e.target.value)} placeholder="Abu Dhabi" maxLength={60} autoComplete="off" style={ctl(!!errors.state)} />
                  <datalist id="drv-emirates">{UAE_EMIRATES.map(c => <option key={c} value={c} />)}</datalist>
                </DF>
                <DF id={fid('country')} label="Country" error={errors.country} span={3}>
                  <input id={fid('country')} name="country" list="drv-countries" value={draft.country ?? ''}
                    onChange={e => set('country', e.target.value)} placeholder="United Arab Emirates" maxLength={60} autoComplete="off" style={ctl(!!errors.country)} />
                  <datalist id="drv-countries">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>
                </DF>
                {text('zipCode', 'Zip code', { placeholder: '00000', max: 20, span: 3 })}
              </div>
            </DSection>

            <DSection
              icon={Car}
              title="Vehicle & Driver ID"
              desc="A vehicle has one driver: choosing one that is already driven moves it to this driver on save."
            >
              <div className="dfm-grid">
                <DF
                  id={fid('vehicleId')}
                  label="Default vehicle"
                  error={errors.vehicleId}
                  span={12}
                  hint={suspended ? 'A suspended driver cannot be given a vehicle.' : takingFrom ? `Saving moves this vehicle from ${takingFrom.name}.` : undefined}
                >
                  <select
                    id={fid('vehicleId')}
                    name="vehicleId"
                    value={draft.vehicleId}
                    onChange={e => set('vehicleId', e.target.value)}
                    disabled={suspended || !draft.companyId || bgVehicles.length === 0}
                    aria-invalid={!!errors.vehicleId || undefined}
                    style={ctl(!!errors.vehicleId, { opacity: suspended || !draft.companyId || bgVehicles.length === 0 ? 0.6 : 1 })}
                  >
                    <option value="">
                      {!draft.companyId ? '— Select a Business Group first —' : bgVehicles.length === 0 ? '— No vehicles for this Business Group —' : '— None —'}
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
                </DF>

                <DF id={fid('tagType')} label="Tag via" error={errors.tagType}>
                  <select id={fid('tagType')} name="tagType" value={draft.tagType ?? ''} onChange={e => set('tagType', e.target.value)} style={ctl(!!errors.tagType)}>
                    <option value="">— Select —</option>
                    {TAG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </DF>
                <DF
                  id={fid('ibuttonCode')}
                  label="Driver ID (tag code)"
                  error={errors.ibuttonCode}
                  span={8}
                  hint="The code the tracker reports (Live Map › Live Data › ibutton.code)"
                >
                  <input
                    id={fid('ibuttonCode')}
                    name="ibuttonCode"
                    value={draft.ibuttonCode ?? ''}
                    onChange={e => set('ibuttonCode', e.target.value)}
                    aria-invalid={!!errors.ibuttonCode || undefined}
                    placeholder="94000001D9DF0801"
                    maxLength={48}
                    autoComplete="off"
                    spellCheck={false}
                    style={ctl(!!errors.ibuttonCode, { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.03em' })}
                  />
                </DF>

                <DF id={fid('notes')} label="Notes" error={errors.notes} span={12}>
                  <textarea
                    id={fid('notes')}
                    name="notes"
                    value={draft.notes}
                    onChange={e => set('notes', e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Shift, depot, anything the next operator should know"
                    style={{ ...inputStyle(!!errors.notes), padding: '10px 12px', fontSize: 13, borderRadius: 10, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                </DF>
              </div>
            </DSection>
          </div>

          {/* ── Additional Info ─────────────────────────────────────── */}
          <div role="tabpanel" id="drv-panel-additional" aria-labelledby="drv-tab-additional" hidden={tab !== 'additional'}>
            <DSection icon={ClipboardList} title="Dates & experience" desc="Age and years of driving are worked out from the dates.">
              <div className="dfm-grid">
                {date('dateOfBirth', 'Date of birth')}
                <ReadOnly id="drv-age" label="Age" value={yearsLabel(yearsSince(draft.dateOfBirth))} />
                <DF id={fid('drivingSince')} label="Driving experience since" error={errors.drivingSince}
                  aside={yearsSince(draft.drivingSince) !== null ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ft-accent)', whiteSpace: 'nowrap' }}>{yearsLabel(yearsSince(draft.drivingSince))}</span> : null}>
                  <input id={fid('drivingSince')} name="drivingSince" type="date" value={draft.drivingSince ?? ''} onChange={e => set('drivingSince', e.target.value)}
                    aria-invalid={!!errors.drivingSince || undefined} style={ctl(!!errors.drivingSince)} />
                </DF>
                {date('joiningDate', 'Date of joining')}
                {date('leavingDate', 'Date of leaving')}
                {date('retirementDate', 'Retirement date')}
              </div>
            </DSection>

            <DSection icon={IdCard} title="Driving licence" desc="The licence the driver holds, the classes it covers and when it runs out.">
              <div className="dfm-grid">
                <DF id={fid('licenseAvailable')} label="Licence available" group>
                  <YesNo id={fid('licenseAvailable')} value={draft.licenseAvailable !== false} onChange={v => set('licenseAvailable', v)} />
                </DF>
                <DF id={fid('licenseNo')} label="Licence number" error={errors.licenseNo}>
                  <input id={fid('licenseNo')} name="licenseNo" value={draft.licenseNo ?? ''} onChange={e => set('licenseNo', e.target.value)}
                    disabled={draft.licenseAvailable === false} placeholder="AD-4471920" maxLength={60} autoComplete="off"
                    style={ctl(!!errors.licenseNo, draft.licenseAvailable === false ? { opacity: 0.5 } : null)} />
                </DF>
                <DF id={fid('licenseCountry')} label="Issuing country" error={errors.licenseCountry}>
                  <input id={fid('licenseCountry')} name="licenseCountry" list="drv-countries" value={draft.licenseCountry ?? ''}
                    onChange={e => set('licenseCountry', e.target.value)} disabled={draft.licenseAvailable === false}
                    placeholder="United Arab Emirates" maxLength={60} autoComplete="off"
                    style={ctl(!!errors.licenseCountry, draft.licenseAvailable === false ? { opacity: 0.5 } : null)} />
                </DF>

                <DF id={fid('licenseCategory')} label="Licence to drive (one or more)" group error={errors.licenseCategory} span={12}>
                  <LicenceClasses value={draft.licenseCategory} onChange={v => set('licenseCategory', v)} disabled={draft.licenseAvailable === false} />
                </DF>

                {date('licenseIssueDate', 'Issue date', 6)}
                <ExpiryField label="Expiry date" name="licenseExpiry" value={draft.licenseExpiry} error={errors.licenseExpiry} onChange={set} />
              </div>
            </DSection>

            <DSection
              icon={ShieldCheck}
              title="Visa, Emirates ID & medical"
              desc="An expiry alert can warn before any of these runs out (Settings › Alerts › Driver Licence & Document Expiry)."
            >
              <div className="dfm-grid">
                {text('emiratesId', 'Emirates ID number', { placeholder: '784-1990-1234567-1', max: 30, span: 6 })}
                <ExpiryField label="Emirates ID expiry" name="emiratesIdExpiry" value={draft.emiratesIdExpiry} error={errors.emiratesIdExpiry} onChange={set} />
                <ExpiryField label="Visa expiry" name="visaExpiry" value={draft.visaExpiry} error={errors.visaExpiry} onChange={set} />
                <ExpiryField label="Medical fitness expiry" name="medicalExpiry" value={draft.medicalExpiry} error={errors.medicalExpiry} onChange={set} />
              </div>
            </DSection>

            <DSection icon={HeartPulse} title="Insurance & mediclaim" desc="The expiry alert watches these dates too.">
              <div className="dfm-grid">
                {text('lifeInsuranceNo', 'Life insurance number', { placeholder: 'LI-000123', max: 60, span: 6 })}
                <ExpiryField label="Life insurance expiry" name="lifeInsuranceExpiry" value={draft.lifeInsuranceExpiry} error={errors.lifeInsuranceExpiry} onChange={set} />
                {text('mediclaimNo', 'Mediclaim number', { placeholder: 'MC-000456', max: 60, span: 6 })}
                <ExpiryField label="Mediclaim expiry" name="mediclaimExpiry" value={draft.mediclaimExpiry} error={errors.mediclaimExpiry} onChange={set} />
              </div>
            </DSection>
          </div>

          {/* ── Leave ───────────────────────────────────────────────── */}
          <div role="tabpanel" id="drv-panel-leave" aria-labelledby="drv-tab-leave" hidden={tab !== 'leave'}>
            <DSection icon={CalendarX} title="Leave" desc="Annual, sick and other leave. The days fill in from the dates, and can be typed over.">
              {!IS_REAL || !draft.id
                ? serverOnly('Leave is', 'Save the driver first, then open it again to record leave.')
                : <DriverLeaves driver={draft} canWrite={access.canWrite} push={push} />}
            </DSection>
          </div>

          {/* ── Documents ───────────────────────────────────────────── */}
          <div role="tabpanel" id="drv-panel-documents" aria-labelledby="drv-tab-documents" hidden={tab !== 'documents'}>
            <DSection icon={FileText} title="Documents" desc="Scanned copies: licence, visa, Emirates ID, passport, medical.">
              {!IS_REAL || !draft.id
                ? serverOnly('Document uploads are', 'Save the driver first, then open it again to upload documents.')
                : <DriverDocuments driver={draft} canWrite={access.canWrite} push={push} />}
            </DSection>
          </div>

          {/* ── History: assignments and incidents ───────────────────── */}
          <div role="tabpanel" id="drv-panel-history" aria-labelledby="drv-tab-history" hidden={tab !== 'history'}>
            <DSection icon={History} title="Assignment history" desc="Who drove which vehicle when. Trips without a tag are credited by these dates.">
              {!IS_REAL || !draft.id
                ? serverOnly('Assignment history is', 'Save the driver first; the Default vehicle then starts the Primary assignment.')
                : <DriverAssignments driver={draft} canWrite={access.canWrite} push={push} />}
            </DSection>
            <DSection icon={TriangleAlert} title="Accidents & incidents" desc="These count against the driver's safety score.">
              {!IS_REAL || !draft.id
                ? serverOnly('Incident records are', 'Save the driver first, then open it again to record incidents.')
                : <DriverIncidents driver={draft} canWrite={access.canWrite} push={push} />}
            </DSection>
          </div>

          <div className="dfm-foot">
            <span className="dfm-foot-note"><span className="dfm-req" aria-hidden="true">*</span> Required</span>
            <button type="button" onClick={closeForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Back</button>
            <button type="button" onClick={resetForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Reset</button>
            <button type="submit" style={{ ...PRIMARY_BTN, height: 40, ...busyBtn }} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Driver'}
            </button>
          </div>
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
                    aria-label="Filter by Business Group"
                    style={{ ...inputStyle(false), flex: '0 1 240px', width: 'auto', minWidth: 180 }}
                  >
                    <option value="">All Business Groups</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>

              <UnregisteredDriverIds
                rows={unregistered}
                canAdd={access.canAdd}
                canWrite={access.canWrite}
                onRegister={registerId}
                onAssign={row => setAssigning(row)}
              />

              <TableToolbar count={rows.length} noun="driver" plural="drivers">
                {access.canAdd && (
                  <button
                    type="button"
                    style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                    disabled={noCompanies}
                    // A driver has to belong to a BG, so with none on file the
                    // form would open with an unsatisfiable required dropdown.
                    title={noCompanies ? 'Add a Business Group first' : undefined}
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
                        ? 'No Business Groups on file — add one before adding drivers.'
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

      {assigning && (
        <UnregisteredDriverDialog
          code={assigning.code}
          vehicleName={assigning.vehicle?.plateNo || ''}
          bgId={assigning.vehicle?.bgId || ''}
          onClose={() => setAssigning(null)}
          onDone={msg => push(msg, { tone: 'success' })}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
