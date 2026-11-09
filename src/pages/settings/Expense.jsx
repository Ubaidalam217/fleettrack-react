import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Search, Receipt, Car, CalendarDays, Banknote, Paperclip, Trash2, Pencil,
  ExternalLink, FileSpreadsheet, X, FileText,
} from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import PageNotice from './PageNotice'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE, inputStyle } from './formStyles'
import { DFM_CSS, ctl } from './alignedFormStyles'
import { DF, DSection, ReadOnly } from './AlignedForm'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { usePageAccess, handleApiError } from './pageChrome'
import { IS_REAL } from '../../data/mode'
import { useVehicles, useCompanies, branchesForCompany, companyNameFor, vehicleLabel } from '../../data/settings'
import {
  EXPENSE_TYPES, EXPENSE_CATEGORIES, FUEL_SOURCES, MAX_BILLS,
  listExpenses, addExpense, updateExpense, deleteExpenses, uploadExpenseBill, deleteExpenseBill, openExpenseBill,
  expenseDay, periodDays,
} from '../../data/expenses'
import { exportExpensesExcel } from '../../utils/expenseExport'
import { reminderStatus, markReminderDone, vehicleMeters, REMINDER_STATUS } from '../../data/reminders'
import { fileToBase64 } from '../../utils/imageUpload'
import { formatExpiryDate } from '../../utils/licenceExpiry'

// Settings › Master › Expense (client, 2026-11-09), after the reference
// system's Expense page: what each vehicle costs. A Variable expense is one
// cost on one day (fuel, a fine, a repair) with the odometer and work hours;
// a Fix one covers a period (insurance, financing). Up to three bills each.
// The form is the aligned Settings form the Driver page uses.

const CSS = `
.exp-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.exp-card{background:var(--c-card);border:1px solid var(--c-border2);border-radius:var(--ft-radius);box-shadow:var(--ft-shadow);
  padding:14px 16px;display:flex;gap:12px;align-items:center;min-width:0}
.exp-ico{width:38px;height:38px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.exp-k{font-size:10.5px;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:var(--c-text3)}
.exp-v{font-size:19px;font-weight:800;color:var(--c-text1);margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.exp-s{font-size:11px;color:var(--c-text3);margin-top:1px}
.exp-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:14px}
.exp-bar > *{flex:0 1 auto}
.exp-sel{display:flex;align-items:center;gap:10px;margin-top:12px;padding:9px 14px;border-radius:10px;
  background:color-mix(in srgb,var(--ft-accent) 9%,transparent);border:1px solid color-mix(in srgb,var(--ft-accent) 30%,transparent);
  font-size:12.5px;font-weight:650;color:var(--c-text1)}
.exp-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1040px}
.exp-table th{position:sticky;top:0;background:var(--c-thead);text-align:left;padding:10px 12px;font-size:10px;font-weight:700;
  text-transform:uppercase;letter-spacing:.05em;color:var(--c-text3);white-space:nowrap;border-bottom:1px solid var(--c-border2)}
.exp-table td{padding:10px 12px;border-bottom:1px solid var(--c-border2);color:var(--c-text1);vertical-align:middle}
.exp-table tbody tr:hover{background:var(--c-hover)}
.exp-table tbody tr[aria-selected="true"]{background:color-mix(in srgb,var(--ft-accent) 7%,transparent)}
.exp-num{text-align:right!important;font-variant-numeric:tabular-nums;white-space:nowrap}
.exp-main{font-weight:650;white-space:nowrap}
.exp-sub{font-size:11px;color:var(--c-text3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.exp-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:750;padding:2px 8px;border-radius:999px;white-space:nowrap}
.exp-pill.var{color:var(--ft-accent);background:color-mix(in srgb,var(--ft-accent) 12%,transparent)}
.exp-pill.fix{color:#7c3aed;background:rgba(124,58,237,.12)}
.exp-icon-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text2);
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.exp-icon-btn:hover{background:var(--c-hover);color:var(--c-text1)}
.exp-bill{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:650;color:var(--ft-accent);background:none;border:0;cursor:pointer;padding:0}
.exp-empty{padding:40px 16px;text-align:center;color:var(--c-text3);font-size:12.5px}
.exp-slot{display:flex;align-items:center;gap:10px;height:56px;padding:0 12px;box-sizing:border-box;border-radius:10px;min-width:0}
.exp-slot.filled{border:1px solid var(--c-border2);background:var(--c-card)}
.exp-slot.empty{border:1.5px dashed var(--c-border2);background:var(--c-input);color:var(--c-text3);cursor:pointer;justify-content:center;
  font-size:12.5px;font-weight:650;width:100%}
.exp-slot.empty:hover{border-color:var(--ft-accent);color:var(--ft-accent)}
.exp-slot-name{font-size:12.5px;font-weight:650;color:var(--c-text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.exp-slot-meta{font-size:11px;color:var(--c-text3)}
@media (max-width: 900px){.exp-sum{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

const today = () => new Date().toLocaleDateString('en-CA')
const aed = n => `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const MAX_BILL_BYTES = 5 * 1024 * 1024

function emptyExpense(companyId = '') {
  return {
    id: null, companyId, branchId: '', vehicleId: '',
    category: 'Variable', type: 'Fuel', subType: '', completesReminder: '',
    expenseDate: today(), fromDate: '', toDate: '',
    odometer: '', workHours: '', fuelSource: '',
    vendor: '', amount: '', referenceNo: '', description: '',
    bills: [],
  }
}

const str = v => (v === null || v === undefined ? '' : String(v))

export default function Expense(props) {
  const access = usePageAccess('expense')
  const vehicles = useVehicles()
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()

  const [filters, setFilters] = useState({ bgId: '', category: '', type: '', from: '', to: '' })
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(() => new Set())
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [staged, setStaged] = useState([]) // files picked on a new expense, uploaded after save
  const [pending, setPending] = useState(null) // { ids, label }
  const [exporting, setExporting] = useState(false)
  const formRef = useRef(null)
  const billRef = useRef(null)
  // The chosen vehicle's open reminders, and whether the odometer came from the tracker.
  const [vehReminders, setVehReminders] = useState([])
  const [odoFromTracker, setOdoFromTracker] = useState(false)

  const reload = () => setReloadKey(k => k + 1)
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v, ...(k === 'category' ? { type: '' } : {}) }))

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    const q = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    listExpenses(q)
      .then(data => { if (live) { setRows(data ?? []); setSelected(new Set()) } })
      .catch(err => { if (live) { setRows([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, reloadKey])

  const vehicleById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles])
  // Branch as the rest of the app shows it: the vehicle's branch, else its Business Group (client, 2026-11-09).
  const branchOf = e => e.vehicle?.branch?.name || e.bg?.name || companyNameFor(e.bgId)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!rows) return []
    if (!q) return rows
    return rows.filter(e => [e.vehicle?.plateNo, e.vehicleLabel, e.vehicle?.fleetNo, e.type, e.subType, e.vendor, e.referenceNo, e.description, e.createdByName]
      .some(s => String(s ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  const totals = useMemo(() => {
    const sum = list => list.reduce((s, e) => s + (e.amount || 0), 0)
    const variable = shown.filter(e => e.category === 'Variable')
    const fix = shown.filter(e => e.category === 'Fix')
    return {
      all: sum(shown), count: shown.length,
      variable: sum(variable), variableCount: variable.length,
      fix: sum(fix), fixCount: fix.length,
      bills: shown.reduce((s, e) => s + (e.bills?.length ?? 0), 0),
    }
  }, [shown])

  // Suggestions from what was typed before.
  const vendorList = useMemo(() => [...new Set((rows ?? []).map(e => e.vendor).filter(Boolean))].sort(), [rows])
  const subTypeList = useMemo(() => [...new Set((rows ?? []).map(e => e.subType).filter(Boolean))].sort(), [rows])

  // ── form ──────────────────────────────────────────────────────────────────
  const editing = draft !== null
  const openAdd = () => { setErrors({}); setStaged([]); setDraft(emptyExpense(filters.bgId || (companies.length === 1 ? companies[0].id : ''))) }
  const openEdit = e => {
    setErrors({})
    setStaged([])
    const v = e.vehicleId ? vehicleById.get(e.vehicleId) : null
    setDraft({
      ...emptyExpense(e.bgId),
      id: e.id, branchId: v?.branchId ?? '', vehicleId: e.vehicleId ?? '',
      category: e.category, type: e.type, subType: str(e.subType),
      expenseDate: str(e.expenseDate), fromDate: str(e.fromDate), toDate: str(e.toDate),
      odometer: str(e.odometer), workHours: str(e.workHours), fuelSource: str(e.fuelSource),
      vendor: str(e.vendor), amount: str(e.amount), referenceNo: str(e.referenceNo), description: str(e.description),
      bills: e.bills ?? [], vehicleLabel: e.vehicleLabel,
    })
  }
  const closeForm = () => { setErrors({}); setStaged([]); setDraft(null) }

  // On picking a vehicle: its open reminders, and (on a new expense with no
  // odometer typed) the tracker's odometer now.
  const pickedVehicle = draft?.vehicleId ?? ''
  const isNew = !draft?.id
  useEffect(() => {
    setVehReminders([])
    setOdoFromTracker(false)
    if (!IS_REAL || !pickedVehicle) return
    let live = true
    reminderStatus({ vehicleId: pickedVehicle })
      .then(rows => { if (live) setVehReminders((rows ?? []).filter(r => r.status !== 'completed' && r.active)) })
      .catch(() => {})
    if (isNew) {
      vehicleMeters([pickedVehicle])
        .then(m => {
          const odo = m?.[pickedVehicle]?.odometer
          if (!live || odo == null) return
          setDraft(d => (d && d.vehicleId === pickedVehicle && d.odometer === '' ? { ...d, odometer: String(Math.round(odo)) } : d))
          setOdoFromTracker(true)
        })
        .catch(() => {})
    }
    return () => { live = false }
  }, [pickedVehicle, isNew])

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      if (key === 'companyId') { next.branchId = ''; next.vehicleId = '' }
      if (key === 'branchId' && d.vehicleId && value && vehicleById.get(d.vehicleId)?.branchId !== value) next.vehicleId = ''
      if (key === 'category' && !EXPENSE_TYPES[value].includes(d.type)) next.type = EXPENSE_TYPES[value][0]
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const bgVehicles = editing
    ? vehicles
      .filter(v => v.companyId === draft.companyId && (!draft.branchId || v.branchId === draft.branchId))
      .sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
    : []
  const bgBranches = editing && draft.companyId ? branchesForCompany(draft.companyId) : []
  const variable = editing && draft.category === 'Variable'

  const submit = async ev => {
    ev.preventDefault()
    if (saving) return
    const next = {}
    if (!draft.companyId) next.companyId = 'Business Group is required'
    if (!draft.vehicleId) next.vehicleId = 'Vehicle is required'
    if (!draft.type) next.type = 'Type is required'
    if (variable) {
      if (!draft.expenseDate) next.expenseDate = 'Expense date is required'
      if (draft.workHours.trim() && !/^\d{1,5}:[0-5]\d$/.test(draft.workHours.trim())) next.workHours = 'Use hours:minutes, e.g. 2:30'
      if (draft.odometer !== '' && !(Number(draft.odometer) >= 0)) next.odometer = 'Zero or more'
    } else {
      if (!draft.fromDate) next.fromDate = 'From date is required'
      if (!draft.toDate) next.toDate = 'To date is required'
      else if (draft.fromDate && draft.toDate < draft.fromDate) next.toDate = 'On or after the From date'
    }
    if (!(Number(draft.amount) > 0)) next.amount = 'Enter an amount above 0'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const body = {
      vehicleId: draft.vehicleId, category: draft.category, type: draft.type, subType: draft.subType.trim(),
      expenseDate: variable ? draft.expenseDate : null,
      fromDate: variable ? null : draft.fromDate, toDate: variable ? null : draft.toDate,
      odometer: variable && draft.odometer !== '' ? draft.odometer : null,
      workHours: variable ? draft.workHours.trim() : null,
      fuelSource: draft.type === 'Fuel' ? draft.fuelSource.trim() : null,
      vendor: draft.vendor.trim(), amount: draft.amount, referenceNo: draft.referenceNo.trim(), description: draft.description.trim(),
    }
    setSaving(true)
    try {
      const row = draft.id ? await updateExpense(draft.id, body) : await addExpense(body)
      // "Marks reminder done": the next cycle starts from this expense.
      const rem = draft.completesReminder ? vehReminders.find(r => r.ruleId === draft.completesReminder) : null
      if (rem) {
        try {
          await markReminderDone({
            ruleId: rem.ruleId, vehicleId: draft.vehicleId,
            doneAt: (variable ? draft.expenseDate : draft.fromDate) > today() ? today() : (variable ? draft.expenseDate : draft.fromDate),
            odometer: variable && draft.odometer !== '' ? Number(draft.odometer) : null,
            note: [draft.type, draft.subType.trim(), draft.referenceNo.trim()].filter(Boolean).join(' · '),
            expenseId: row.id, newExpiry: variable ? null : draft.toDate,
          })
          push(`${rem.ruleName} marked done`, { tone: 'success' })
        } catch (err) {
          handleApiError(err, { push })
        }
      }
      let failed = 0
      for (const f of staged) {
        try { await uploadExpenseBill(row.id, { fileName: f.name, data: await fileToBase64(f) }) } catch { failed += 1 }
      }
      push(`${draft.type} expense ${draft.id ? 'updated' : 'added'}`, { tone: 'success' })
      if (failed) push(`${failed} bill${failed === 1 ? '' : 's'} could not be uploaded`, { tone: 'error' })
      closeForm()
      reload()
    } catch (err) {
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    const saved = draft.id ? rows?.find(e => e.id === draft.id) : null
    if (saved) openEdit(saved)
    else openAdd()
  }

  // Bills: on a saved expense they go up at once; on a new one they wait for Save.
  const billsTaken = editing ? (draft.bills?.length ?? 0) + staged.length : 0
  const pickBill = async file => {
    if (billRef.current) billRef.current.value = ''
    if (!file) return
    if (file.size > MAX_BILL_BYTES) { push('The file is too large (max 5 MB)', { tone: 'error' }); return }
    if (!draft.id) { setStaged(s => [...s, file].slice(0, MAX_BILLS)); return }
    try {
      const bill = await uploadExpenseBill(draft.id, { fileName: file.name, data: await fileToBase64(file) })
      setDraft(d => ({ ...d, bills: [...(d.bills ?? []), bill] }))
      push(`${file.name} uploaded`, { tone: 'success' })
      reload()
    } catch (err) {
      handleApiError(err, { push })
    }
  }
  const dropBill = async bill => {
    try {
      await deleteExpenseBill(draft.id, bill.id)
      setDraft(d => ({ ...d, bills: d.bills.filter(b => b.id !== bill.id) }))
      reload()
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  // ── list actions ──────────────────────────────────────────────────────────
  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOn = shown.length > 0 && shown.every(e => selected.has(e.id))
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(shown.map(e => e.id)))

  const confirmDelete = async () => {
    const { ids } = pending
    setPending(null)
    try {
      const res = await deleteExpenses(ids)
      push(`${res?.deleted ?? ids.length} expense${ids.length === 1 ? '' : 's'} deleted`, { tone: 'success' })
      reload()
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const exportXlsx = async () => {
    setExporting(true)
    try { await exportExpensesExcel(shown, { branchOf }) } catch (err) { push(err.message, { tone: 'error' }) } finally { setExporting(false) }
  }

  const title = !editing ? 'Expense' : draft.id ? 'Edit Expense' : 'Add Expense'
  const busyBtn = saving ? { opacity: 0.6, cursor: 'not-allowed' } : null
  const fid = n => `exp-${n}`
  const text = (name, label, { placeholder, max = 120, span = 4, list, inputMode, required } = {}) => (
    <DF id={fid(name)} label={label} required={required} error={errors[name]} span={span}>
      <input id={fid(name)} name={name} value={draft[name] ?? ''} onChange={e => set(name, e.target.value)} placeholder={placeholder}
        maxLength={max} list={list} inputMode={inputMode} autoComplete="off" aria-invalid={!!errors[name] || undefined} style={ctl(!!errors[name])} />
    </DF>
  )
  const date = (name, label, { span = 4, required, min } = {}) => (
    <DF id={fid(name)} label={label} required={required} error={errors[name]} span={span}>
      <input id={fid(name)} name={name} type="date" value={draft[name] ?? ''} min={min} onChange={e => set(name, e.target.value)}
        aria-invalid={!!errors[name] || undefined} style={ctl(!!errors[name])} />
    </DF>
  )

  if (!IS_REAL) {
    return (
      <SettingsLayout title="Expense" {...props}>
        <div style={{ ...CARD_SURFACE, padding: 24, marginTop: 16, fontSize: 13, color: 'var(--c-text2)' }}>
          Expenses are kept on the server, so they are not available in demo mode.
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

          <DSection icon={Receipt} title="Expense" desc="Variable: one cost on one day. Fix: a cost over a period.">
            <div className="dfm-grid">
              <DF id={fid('category')} label="Category" group>
                <div className="dfm-seg" role="radiogroup" aria-labelledby={`${fid('category')}-label`} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {EXPENSE_CATEGORIES.map(c => (
                    <button key={c.value} type="button" role="radio" aria-checked={draft.category === c.value} title={c.hint} onClick={() => set('category', c.value)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </DF>
              <DF id={fid('type')} label="Type" required error={errors.type}>
                <select id={fid('type')} name="type" value={draft.type} onChange={e => set('type', e.target.value)} style={ctl(!!errors.type)}>
                  {EXPENSE_TYPES[draft.category].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </DF>
              {text('subType', 'Sub type', { placeholder: draft.type === 'Fuel' ? 'Diesel' : 'Optional', max: 80, list: 'exp-subtypes' })}
              <datalist id="exp-subtypes">{subTypeList.map(s => <option key={s} value={s} />)}</datalist>
            </div>
          </DSection>

          <DSection icon={Car} title="Vehicle" desc="The vehicle the cost belongs to. Branch only narrows the vehicle list.">
            <div className="dfm-grid">
              <DF id={fid('companyId')} label="Business Group" required error={errors.companyId}>
                <select id={fid('companyId')} name="companyId" value={draft.companyId} onChange={e => set('companyId', e.target.value)} style={ctl(!!errors.companyId)}>
                  <option value="">— Select —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </DF>
              <DF id={fid('branchId')} label="Branch">
                <select id={fid('branchId')} name="branchId" value={draft.branchId} onChange={e => set('branchId', e.target.value)}
                  disabled={!draft.companyId || bgBranches.length === 0} style={ctl(false, !draft.companyId || bgBranches.length === 0 ? { opacity: 0.6 } : null)}>
                  <option value="">{bgBranches.length ? 'All branches' : '— No branches —'}</option>
                  {bgBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </DF>
              <DF id={fid('vehicleId')} label="Vehicle" required error={errors.vehicleId}
                hint={draft.id && !draft.vehicleId && draft.vehicleLabel ? `Was ${draft.vehicleLabel} (no longer registered)` : undefined}>
                <select id={fid('vehicleId')} name="vehicleId" value={draft.vehicleId} onChange={e => set('vehicleId', e.target.value)}
                  disabled={!draft.companyId} style={ctl(!!errors.vehicleId, !draft.companyId ? { opacity: 0.6 } : null)}>
                  <option value="">{!draft.companyId ? '— Select a Business Group first —' : bgVehicles.length ? '— Select —' : '— No vehicles —'}</option>
                  {bgVehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                </select>
              </DF>
              {vehReminders.length > 0 && (
                <DF id={fid('completesReminder')} label="Marks reminder done (optional)" span={12}
                  hint="Saving this expense marks the reminder done and starts its next cycle.">
                  <select id={fid('completesReminder')} name="completesReminder" value={draft.completesReminder}
                    onChange={e => set('completesReminder', e.target.value)} style={ctl(false)}>
                    <option value="">— None —</option>
                    {vehReminders.map(r => (
                      <option key={r.ruleId} value={r.ruleId}>
                        {r.ruleName} ({r.type}) · {REMINDER_STATUS[r.status].label}{r.detail ? ` · ${r.detail}` : ''}
                      </option>
                    ))}
                  </select>
                </DF>
              )}
            </div>
          </DSection>

          <DSection icon={CalendarDays} title={variable ? 'Date & usage' : 'Period'}
            desc={variable ? 'When the cost was made, with the odometer and work time then.' : 'The period this cost covers.'}>
            <div className="dfm-grid">
              {variable ? (
                <>
                  {date('expenseDate', 'Expense date', { required: true })}
                  <DF id={fid('odometer')} label="Odometer (km)" error={errors.odometer}
                    hint={odoFromTracker && !errors.odometer ? 'From the tracker now; change it if needed.' : undefined}>
                    <input id={fid('odometer')} name="odometer" value={draft.odometer} inputMode="decimal" maxLength={12} placeholder="120450"
                      onChange={e => { set('odometer', e.target.value); setOdoFromTracker(false) }} autoComplete="off"
                      aria-invalid={!!errors.odometer || undefined} style={ctl(!!errors.odometer)} />
                  </DF>
                  {text('workHours', 'Work hours (h:mm)', { placeholder: '2:30', max: 8 })}
                </>
              ) : (
                <>
                  {date('fromDate', 'From date', { required: true })}
                  {date('toDate', 'To date', { required: true, min: draft.fromDate || undefined })}
                  <ReadOnly id={fid('period')} label="Period" value={periodDays(draft.fromDate, draft.toDate) ? `${periodDays(draft.fromDate, draft.toDate)} days` : '—'} />
                </>
              )}
            </div>
          </DSection>

          <DSection icon={Banknote} title="Amount & vendor" desc="What it cost, who was paid, and the bill or invoice number.">
            <div className="dfm-grid">
              {text('amount', 'Amount (AED)', { placeholder: '0.00', max: 14, inputMode: 'decimal', required: true })}
              {text('vendor', 'Vendor', { placeholder: 'ADNOC, Al Futtaim Auto…', list: 'exp-vendors' })}
              <datalist id="exp-vendors">{vendorList.map(s => <option key={s} value={s} />)}</datalist>
              {text('referenceNo', 'Reference number', { placeholder: 'INV-10425', max: 60 })}
              {draft.type === 'Fuel' && (
                <>
                  {text('fuelSource', 'Fuel source', { placeholder: 'Fuel card', max: 40, list: 'exp-fuel-sources' })}
                  <datalist id="exp-fuel-sources">{FUEL_SOURCES.map(s => <option key={s} value={s} />)}</datalist>
                </>
              )}
              <DF id={fid('description')} label="Description" error={errors.description} span={draft.type === 'Fuel' ? 8 : 12}>
                <input id={fid('description')} name="description" value={draft.description} onChange={e => set('description', e.target.value)}
                  placeholder="What was done or bought" maxLength={1000} style={ctl(!!errors.description)} />
              </DF>
            </div>
          </DSection>

          <DSection icon={Paperclip} title="Bills" desc={`Up to ${MAX_BILLS}: invoice, receipt or photo. PDF, JPEG, PNG or WebP, max 5 MB each.`}>
            <input ref={billRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => pickBill(e.target.files?.[0])} />
            <div className="dfm-grid">
              {[0, 1, 2].map(i => {
                const saved = draft.bills?.[i]
                const file = !saved ? staged[i - (draft.bills?.length ?? 0)] : null
                return (
                  <div key={i} className="dfm-c4" style={{ minWidth: 0 }}>
                    {saved || file ? (
                      <div className="exp-slot filled">
                        <FileText size={18} style={{ color: 'var(--ft-accent)', flexShrink: 0 }} aria-hidden="true" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="exp-slot-name" title={saved ? saved.fileName : file.name}>{saved ? saved.fileName : file.name}</div>
                          <div className="exp-slot-meta">{fmtSize((saved || file).size)}{file ? ' · uploads on save' : ''}</div>
                        </div>
                        {saved && (
                          <button type="button" className="exp-icon-btn" aria-label={`Open ${saved.fileName}`} title="Open"
                            onClick={() => openExpenseBill(draft.id, saved.id).catch(err => push(err.message, { tone: 'error' }))}>
                            <ExternalLink size={14} />
                          </button>
                        )}
                        <button type="button" className="exp-icon-btn" aria-label={`Remove ${saved ? saved.fileName : file.name}`} title="Remove"
                          onClick={() => (saved ? dropBill(saved) : setStaged(s => s.filter(x => x !== file)))}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : i === billsTaken ? (
                      <button type="button" className="exp-slot empty" onClick={() => billRef.current?.click()}>
                        <Plus size={15} /> Add bill
                      </button>
                    ) : (
                      <div className="exp-slot empty" aria-hidden="true" style={{ cursor: 'default', opacity: 0.45 }} />
                    )}
                  </div>
                )
              })}
            </div>
          </DSection>

          <div className="dfm-foot">
            <span className="dfm-foot-note"><span className="dfm-req" aria-hidden="true">*</span> Required</span>
            <button type="button" onClick={closeForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Back</button>
            <button type="button" onClick={resetForm} style={{ ...SECONDARY_BTN, height: 40, ...busyBtn }} disabled={saving}>Reset</button>
            <button type="submit" style={{ ...PRIMARY_BTN, height: 40, ...busyBtn }} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Expense'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <PageNotice {...access} />
          {!access.loading && (
            <>
              <div className="exp-sum">
                {[
                  { k: 'Total', v: aed(totals.all), s: `${totals.count} expense${totals.count === 1 ? '' : 's'}`, icon: Receipt, color: 'var(--ft-accent)' },
                  { k: 'Variable', v: aed(totals.variable), s: `${totals.variableCount} one-off`, icon: Banknote, color: '#0ea5e9' },
                  { k: 'Fix', v: aed(totals.fix), s: `${totals.fixCount} over a period`, icon: CalendarDays, color: '#7c3aed' },
                  { k: 'Bills attached', v: String(totals.bills), s: 'invoices and receipts', icon: Paperclip, color: '#d97706' },
                ].map(c => (
                  <div key={c.k} className="exp-card">
                    <span className="exp-ico" style={{ color: c.color, background: `color-mix(in srgb, ${c.color} 14%, transparent)` }} aria-hidden="true">
                      <c.icon size={18} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="exp-k">{c.k}</div>
                      <div className="exp-v" title={c.v}>{c.v}</div>
                      <div className="exp-s">{c.s}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="exp-bar">
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
                  <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, vendor, reference…"
                    aria-label="Search expenses" style={{ ...inputStyle(false), height: 38, paddingLeft: 30 }} />
                </div>
                {companies.length > 1 && (
                  <select value={filters.bgId} onChange={e => setFilter('bgId', e.target.value)} aria-label="Business Group" style={{ ...inputStyle(false), height: 38, width: 'auto', minWidth: 180 }}>
                    <option value="">All Business Groups</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <select value={filters.category} onChange={e => setFilter('category', e.target.value)} aria-label="Category" style={{ ...inputStyle(false), height: 38, width: 'auto' }}>
                  <option value="">All categories</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <select value={filters.type} onChange={e => setFilter('type', e.target.value)} aria-label="Type" style={{ ...inputStyle(false), height: 38, width: 'auto' }}>
                  <option value="">All types</option>
                  {(filters.category ? EXPENSE_TYPES[filters.category] : [...EXPENSE_TYPES.Variable, ...EXPENSE_TYPES.Fix]).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} aria-label="From date" style={{ ...inputStyle(false), height: 38, width: 'auto' }} />
                <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>to</span>
                <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilter('to', e.target.value)} aria-label="To date" style={{ ...inputStyle(false), height: 38, width: 'auto' }} />
                {(filters.bgId || filters.category || filters.type || filters.from || filters.to || search) && (
                  <button type="button" onClick={() => { setFilters({ bgId: '', category: '', type: '', from: '', to: '' }); setSearch('') }} style={{ ...SECONDARY_BTN, height: 38 }}>
                    <X size={14} /> Clear
                  </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button type="button" onClick={exportXlsx} disabled={!shown.length || exporting} style={{ ...SECONDARY_BTN, height: 38, opacity: !shown.length || exporting ? 0.55 : 1 }}>
                    <FileSpreadsheet size={15} /> {exporting ? 'Exporting…' : 'Excel'}
                  </button>
                  {access.canAdd && (
                    <button type="button" onClick={openAdd} disabled={!companies.length} style={{ ...PRIMARY_BTN, height: 38, opacity: companies.length ? 1 : 0.5 }}>
                      <Plus size={14} strokeWidth={2.6} /> Add Expense
                    </button>
                  )}
                </div>
              </div>

              {access.canDelete && selected.size > 0 && (
                <div className="exp-sel" role="status">
                  {selected.size} selected
                  <button type="button" onClick={() => setPending({ ids: [...selected] })} style={{ ...SECONDARY_BTN, height: 32, marginLeft: 'auto', color: '#ef4444' }}>
                    <Trash2 size={14} /> Delete selected
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} style={{ ...SECONDARY_BTN, height: 32 }}>Cancel</button>
                </div>
              )}

              <div style={{ ...CARD_SURFACE, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="exp-table">
                    <thead>
                      <tr>
                        {access.canDelete && (
                          <th style={{ width: 36 }}>
                            <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all expenses" style={{ accentColor: 'var(--ft-accent)' }} />
                          </th>
                        )}
                        <th>Date</th>
                        <th>Vehicle</th>
                        <th>Category</th>
                        <th>Type</th>
                        <th className="exp-num">Odometer</th>
                        <th>Vendor</th>
                        <th>Reference</th>
                        <th className="exp-num">Amount</th>
                        <th>Bills</th>
                        <th>Added by</th>
                        {access.canWrite && <th style={{ textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows === null ? (
                        <tr><td colSpan={12} className="exp-empty">Loading expenses…</td></tr>
                      ) : shown.length === 0 ? (
                        <tr><td colSpan={12} className="exp-empty">
                          {rows.length ? 'No expenses match the current search.' : access.canAdd ? 'No expenses yet — use Add Expense to record one.' : 'No expenses to show.'}
                        </td></tr>
                      ) : shown.map(e => (
                        <tr key={e.id} aria-selected={selected.has(e.id)}>
                          {access.canDelete && (
                            <td>
                              <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)}
                                aria-label={`Select ${e.type} expense of ${e.vehicle?.plateNo || e.vehicleLabel}`} style={{ accentColor: 'var(--ft-accent)' }} />
                            </td>
                          )}
                          <td>
                            <div className="exp-main">{formatExpiryDate(expenseDay(e))}</div>
                            {e.category === 'Fix' && <div className="exp-sub">to {formatExpiryDate(e.toDate)}</div>}
                          </td>
                          <td>
                            <div className="exp-main">{e.vehicle?.plateNo || e.vehicleLabel}</div>
                            <div className="exp-sub">{branchOf(e)}</div>
                          </td>
                          <td><span className={`exp-pill ${e.category === 'Fix' ? 'fix' : 'var'}`}>{e.category}</span></td>
                          <td>
                            <div className="exp-main">{e.type}</div>
                            {(e.subType || e.fuelSource) && <div className="exp-sub">{[e.subType, e.fuelSource].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td className="exp-num">{e.odometer != null ? `${Math.round(e.odometer).toLocaleString('en-US')} km` : '—'}</td>
                          <td><div className="exp-sub" style={{ color: 'var(--c-text1)', fontSize: 12.5 }}>{e.vendor || '—'}</div></td>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.referenceNo || '—'}</td>
                          <td className="exp-num" style={{ fontWeight: 750 }}>{aed(e.amount)}</td>
                          <td>
                            {e.bills?.length ? (
                              <button type="button" className="exp-bill" onClick={() => openExpenseBill(e.id, e.bills[0].id).catch(err => push(err.message, { tone: 'error' }))}
                                title={e.bills.map(b => b.fileName).join(', ')} aria-label={`Open bill of ${e.vehicle?.plateNo || e.vehicleLabel}`}>
                                <Paperclip size={13} /> {e.bills.length}
                              </button>
                            ) : <span style={{ color: 'var(--c-text3)' }}>—</span>}
                          </td>
                          <td><div className="exp-sub" style={{ color: 'var(--c-text2)', fontSize: 12 }}>{e.createdByName || '—'}</div></td>
                          {access.canWrite && (
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button type="button" className="exp-icon-btn" onClick={() => openEdit(e)} aria-label={`Edit ${e.type} expense`} title="Edit"><Pencil size={14} /></button>
                              {access.canDelete && (
                                <button type="button" className="exp-icon-btn" onClick={() => setPending({ ids: [e.id] })} aria-label={`Delete ${e.type} expense`} title="Delete" style={{ marginLeft: 6 }}>
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {shown.length > 0 && (
                      <tfoot>
                        <tr>
                          <td colSpan={access.canDelete ? 8 : 7} style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-text3)', padding: '10px 12px' }}>
                            Total · {shown.length} shown
                          </td>
                          <td className="exp-num" style={{ fontWeight: 800, padding: '10px 12px' }}>{aed(totals.all)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.ids.length === 1 ? 'Delete expense?' : `Delete ${pending.ids.length} expenses?`}
          body={pending.ids.length === 1 ? 'The expense and its bills will be removed.' : 'These expenses and their bills will be removed.'}
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
