import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
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
  driverForVehicleId, emptyDriver,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'
import { licenceExpiryState, formatExpiryDate } from '../../utils/licenceExpiry'

// Settings > Driver. A BG's drivers, each optionally assigned to one of its
// vehicles; the Live Map panel and the Movement/Daywise reports read the
// assignment back through driverForVehicleImei().
//
// A vehicle has one driver at most. Picking a vehicle someone else drives MOVES
// it on save — the server does that in one transaction, mock mode mirrors it —
// so the dropdown names the current driver beside each vehicle, and the save
// toast says who lost it.
//
// Hand-built from Field + inputStyle like the Vehicle form, because the Vehicle
// options depend on the chosen BG and the Licence Expiry carries a live chip.

// Mirrors the badge vocabulary in components/VehicleStatus.jsx, as User.jsx does.
const STATUS_TONE = {
  Active:   { color: '#16a34a', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  Inactive: { color: 'var(--c-text3)', bg: 'var(--c-progress)', border: 'transparent' },
}

const EXPIRY_TONE = {
  valid:    STATUS_TONE.Active,
  expiring: { color: '#d97706', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.28)' },
  expired:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)' },
}

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

// A function of the vehicle lookup rather than a constant, so the Vehicle column
// re-renders when a vehicle is renamed on its own page.
const columnsFor = vehicleById => [
  { key: 'name',      label: 'Driver Name', bold: true },
  { key: 'company',   label: 'BG', render: row => companyNameFor(row.companyId) },
  { key: 'mobile',    label: 'Mobile' },
  { key: 'licenseNo', label: 'Licence No' },
  {
    key: 'licenseExpiry',
    label: 'Licence Expiry',
    render: row => (row.licenseExpiry ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {formatExpiryDate(row.licenseExpiry)}
        <ExpiryChip expiry={row.licenseExpiry} />
      </span>
    ) : '—'),
  },
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
  const firstRef = useRef(null)
  const formRef  = useRef(null)

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
      return [d.name, d.mobile, d.licenseNo, companyNameFor(d.companyId), vehicle && vehicleLabel(vehicle)]
        .some(s => String(s ?? '').toLowerCase().includes(q))
    })
    return list.sort((a, b) => a.name.localeCompare(b.name))
    // companies: BG names are searched through companyNameFor, which reads that store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, vehicleById, companies, search, bgFilter])

  const openAdd = () => {
    setErrors({})
    // A BG already narrowed in the filter is almost certainly the one being added to.
    setDraft({ ...emptyDriver(), companyId: bgFilter })
  }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A vehicle belongs to one BG, so the old pick is not an option under the new one.
      if (key === 'companyId') next.vehicleId = ''
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const bgVehicles = editing
    ? [...vehiclesForCompany(draft.companyId)].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
    : []
  // Who drives the picked vehicle now, if not this driver — saving takes it off them.
  const holder = editing && draft.vehicleId ? driverForVehicleId(draft.vehicleId) : null
  const takingFrom = holder && holder.id !== draft.id ? holder : null
  const expiry = editing ? licenceExpiryState(draft.licenseExpiry) : null
  const bgLocked = IS_REAL && editing && !!draft.id

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)   next.companyId = 'BG is required'
    if (!draft.name.trim()) next.name      = 'Name is required'

    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = {
      ...draft,
      name:      draft.name.trim(),
      mobile:    draft.mobile.trim(),
      licenseNo: draft.licenseNo.trim(),
      notes:     draft.notes.trim(),
    }
    const vehicle = clean.vehicleId ? vehicleById.get(clean.vehicleId) : null
    setSaving(true)
    try {
      const { movedFrom } = draft.id
        ? await updateDriver(draft.id, clean)
        : await addDriver(clean)
      push(`${clean.name} ${draft.id ? 'updated' : 'added'}`, { tone: 'success' })
      if (movedFrom) {
        push(`Vehicle ${vehicleLabel(vehicle)} moved from ${movedFrom.name}`, { tone: 'info' })
      }
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

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Driver details' : 'New driver'}
            subtitle="Fields marked with * are required. A vehicle has one driver — choosing one that is already driven moves it to this driver."
          >
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
                  style={
                    bgLocked
                      ? { ...inputStyle(!!errors.companyId), opacity: 0.6, cursor: 'not-allowed' }
                      : inputStyle(!!errors.companyId)
                  }
                >
                  <option value="">— Select —</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Driver Name" required error={errors.name}>
                <input
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Ahmed Khan"
                  maxLength={120}
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Mobile" error={errors.mobile}>
                <input
                  name="mobile"
                  type="tel"
                  value={draft.mobile}
                  onChange={e => set('mobile', e.target.value)}
                  aria-invalid={!!errors.mobile || undefined}
                  placeholder="+971 50 123 4567"
                  maxLength={30}
                  style={inputStyle(!!errors.mobile)}
                />
              </Field>

              <Field label="Licence Number" error={errors.licenseNo}>
                <input
                  name="licenseNo"
                  value={draft.licenseNo}
                  onChange={e => set('licenseNo', e.target.value)}
                  aria-invalid={!!errors.licenseNo || undefined}
                  placeholder="AD-4471920"
                  maxLength={60}
                  style={inputStyle(!!errors.licenseNo)}
                />
              </Field>

              {/* The chip renders under the input rather than through Field's
                  `hint`, so an expired licence can read red without being
                  styled as a validation failure — it is still a valid save. */}
              <Field label="Licence Expiry" error={errors.licenseExpiry}>
                <input
                  name="licenseExpiry"
                  type="date"
                  value={draft.licenseExpiry}
                  onChange={e => set('licenseExpiry', e.target.value)}
                  aria-invalid={!!errors.licenseExpiry || undefined}
                  style={inputStyle(!!errors.licenseExpiry)}
                />
                {!errors.licenseExpiry && expiry.state !== 'none' && (
                  <span style={{ display: 'block', marginTop: 5 }}>
                    <ExpiryChip expiry={draft.licenseExpiry} />
                  </span>
                )}
              </Field>

              <Field
                label="Vehicle"
                error={errors.vehicleId}
                hint={takingFrom ? `Saving moves this vehicle from ${takingFrom.name}.` : undefined}
              >
                <select
                  name="vehicleId"
                  value={draft.vehicleId}
                  onChange={e => set('vehicleId', e.target.value)}
                  disabled={!draft.companyId || bgVehicles.length === 0}
                  aria-invalid={!!errors.vehicleId || undefined}
                  style={{
                    ...inputStyle(!!errors.vehicleId),
                    opacity: !draft.companyId || bgVehicles.length === 0 ? 0.6 : 1,
                  }}
                >
                  <option value="">
                    {!draft.companyId
                      ? '— Select a BG first —'
                      : bgVehicles.length === 0
                        ? '— No vehicles for this BG —'
                        : '— None —'}
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

              <Field label="Status">
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Active', 'Inactive'].map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`ft-btn${draft.status === s ? ' ft-btn--active' : ''}`}
                      aria-pressed={draft.status === s}
                      onClick={() => set('status', s)}
                      style={{ flex: 1, justifyContent: 'center', padding: '8px 10px' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
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

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? drivers.find(d => d.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyDriver())
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
                    placeholder="Name, mobile, licence or vehicle"
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
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <TableToolbar count={rows.length} noun="driver" plural="drivers">
                {access.canWrite && (
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
                onDelete={setPending}
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
          body={`${pending.name} will be removed from ${companyNameFor(pending.companyId)}.`}
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
