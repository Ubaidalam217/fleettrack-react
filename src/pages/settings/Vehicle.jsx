import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, FileBadge, BellPlus, ArrowRightLeft, Radio, Unplug, Cpu, Info } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useVehicles, useCompanies, useBranches, useGroups,
  addVehicle, updateVehicle, removeVehicle, listVehicleOdometers, setVehicleOdometer,
  companyNameFor, branchTreeForCompany, branchOptionLabel,
  groupsForCompany, groupIdForCompany,
  groupNameFor, vehicleLabel, emptyVehicle, isImeiTaken,
  SHARING_AVAILABLE, setVehicleShares, TRACKER_ACTIONS_AVAILABLE,
} from '../../data/settings'
import TrackerDialog from './TrackerDialog'
import ShareTargetsField from './ShareTargetsField'
import SharedChip from '../../components/SharedChip'
import { isOwned, sharedFromText, shareTargetsOf, sharesChanged } from '../../utils/vehiclePlacement'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import VehicleMoveDialog from './VehicleMoveDialog'
import { ObjectTabs } from './OrgTabs'
import { IS_REAL } from '../../data/mode'
import { get } from '../../data/http'
import { useFlespiMQTT } from '../../hooks/useFlespiMQTT'
import { flespiStatusFor } from '../../utils/vehicleLabel'

// The fleet register. Writes to the same vehicle store the sub-user assignment
// panel and the alert scope picker read, so a vehicle added here is immediately
// assignable and alertable.
//
// Controls are hand-built from FormKit's Field plus formStyles' inputStyle —
// the primitives FormFields composes internally, so they render identically —
// because Branch and Group depend on the chosen company and the IMEI field
// carries a warning that is not a validation error.

// One vehicle in several places (client, 2026-11-13; utils/vehiclePlacement.js):
// a vehicle shared INTO this account shows where it was shared to, marked
// Shared and read-only; one of its own lists where else it shows.
const placeText = s => s.label || s.companyName || s.groupName || '—'
const COLUMNS = [
  { key: 'vehicleNumber', label: 'Vehicle Number', bold: true },
  { key: 'imei',          label: 'IMEI' },
  {
    key: 'company',
    label: 'Business Group',
    render: row => isOwned(row)
      ? companyNameFor(row.companyId)
      : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {row.shares?.[0] ? placeText(row.shares[0]) : '—'}
          <SharedChip title={`${sharedFromText(row)} — read-only`} />
        </span>
      ),
  },
  {
    key: 'makeModel',
    label: 'Make/Model',
    render: row => [row.make, row.model].filter(Boolean).join(' ') || '—',
  },
  ...(SHARING_AVAILABLE ? [{
    key: 'alsoIn',
    label: 'Also in',
    render: row => {
      const list = isOwned(row) ? row.shares ?? [] : []
      if (!list.length) return '—'
      const first = list.slice(0, 2).map(placeText).join(', ')
      return <span title={list.map(placeText).join('\n')}>{first}{list.length > 2 ? ` +${list.length - 2}` : ''}</span>
    },
  }] : []),
]

/**
 * A word on how the row stands against Flespi (client, 2026-11-16: "Vehicles
 * numbers should be auto updated everywhere"): not in Flespi, a different
 * Flespi name, or no tracker. With `onResolve` (2026-11-17: trackers are
 * changed here, never in the Flespi panel) it is a button that opens the
 * tracker dialog — change the tracker, merge into the vehicle that has it now,
 * mark no tracker, or rename the Flespi device.
 */
function FlespiHint({ status, imei, onResolve }) {
  if (!status) return null
  const missing = status.state === 'missing'
  const none = status.state === 'none'
  const tone = missing ? '#d97706' : 'var(--c-text3)'
  const title = none
    ? 'This vehicle has no tracker. It keeps its history; install one from the tracker dialog.'
    : missing
      ? `No tracker in Flespi has IMEI ${imei}. It was removed, or its Flespi device now carries another IMEI (a tracker changed in the Flespi panel), so this vehicle gets no live data. Resolve: change the tracker, merge into the vehicle that has it now, or mark it as having no tracker.`
      : `In Flespi this tracker is named “${status.flespiName}”. FleetmaxX shows the vehicle number everywhere.${onResolve ? ' Click to rename the Flespi device or change the tracker.' : ''}`
  const Tag = onResolve ? 'button' : 'span'
  return (
    <Tag
      {...(onResolve ? { type: 'button', onClick: e => { e.stopPropagation(); onResolve() } } : {})}
      title={title}
      aria-label={title}
      style={{
        cursor: onResolve ? 'pointer' : 'default', font: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: 220,
        padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600,
        color: tone,
        background: missing ? 'color-mix(in srgb, #d97706 10%, transparent)' : 'var(--c-input)',
        border: `1px solid ${missing ? 'color-mix(in srgb, #d97706 40%, transparent)' : 'var(--c-border2)'}`,
      }}
    >
      {missing || none ? <Unplug size={11} strokeWidth={2.4} aria-hidden="true" /> : <Radio size={11} strokeWidth={2.4} aria-hidden="true" />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {none ? 'No tracker' : missing ? 'Not in Flespi' : `Flespi name: ${status.flespiName}`}
      </span>
      {onResolve && !none && <span style={{ textDecoration: 'underline', flexShrink: 0 }}>{missing ? 'Resolve' : 'Fix'}</span>}
    </Tag>
  )
}

/**
 * Live devices by IMEI, once the device list has loaded (real mode only: the
 * demo's register IMEIs are made up and match no tracker).
 */
function useLiveByImei() {
  const { vehicles: live, devicesLoaded } = useFlespiMQTT()
  return useMemo(() => {
    if (!IS_REAL || !devicesLoaded) return null
    return new Map(live.map(d => [String(d.ident ?? '').replace(/\D/g, ''), d]).filter(([k]) => k))
  }, [live, devicesLoaded])
}

/** The vehicle record's own fields, as the form edits them (what PUT /api/vehicles/:id saves). */
const RECORD_KEYS = ['companyId', 'branchId', 'groupId', 'subGroup', 'vehicleNumber', 'vehicleId', 'imei', 'odometer', 'make', 'model', 'deviceType', 'mobileNo', 'vehicleType', 'validUntil']

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

// Device Type is a Flespi device type's title. On save the server creates the
// tracker's Flespi device from it (or links the one already there by IMEI), so
// nobody has to open the Flespi panel. Mock mode has no Flespi: a short list.
const MOCK_DEVICE_TYPES = {
  types: ['Jimi IoT (Concox)', 'Teltonika FMB120', 'Teltonika FMB920', 'Teltonika FMC130', 'Teltonika FMC150', 'Teltonika FMC230']
    .map((title, i) => ({ id: i + 1, title, protocolId: title.startsWith('Teltonika') ? 14 : 13 })),
  addresses: {},
}

function useDeviceTypes(active) {
  const [data, setData] = useState(IS_REAL ? null : MOCK_DEVICE_TYPES)
  useEffect(() => {
    if (!IS_REAL || !active || data) return
    let alive = true
    get('/api/vehicles/device-types').then(d => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [active, data])
  return data ?? { types: [], addresses: {} }
}

// Trackers in Flespi that no vehicle here points at — added in the Flespi panel
// before FleetmaxX managed devices. The server answers only a Super Admin.
function useUnregistered(active, vehicleCount) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (!IS_REAL || !active) return
    let alive = true
    get('/api/vehicles/unregistered').then(d => { if (alive) setRows(Array.isArray(d) ? d : []) }).catch(() => {})
    return () => { alive = false }
  }, [active, vehicleCount])
  return rows
}

function UnregisteredTrackers({ rows, onAdd }) {
  if (!rows.length) return null
  return (
    <div style={{
      marginBottom: 14, padding: '12px 14px', borderRadius: 10,
      border: '1px solid color-mix(in srgb, #d97706 45%, transparent)',
      backgroundColor: 'color-mix(in srgb, #d97706 8%, transparent)',
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)' }}>
        {rows.length} tracker{rows.length === 1 ? '' : 's'} in Flespi not registered here
      </div>
      <div style={{ fontSize: 11, color: 'var(--c-text3)', margin: '2px 0 10px' }}>
        They show on the Live Map but have no company, branch or reports. Add each one to put it under a BG.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.deviceId} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto',
            gap: 12, alignItems: 'center', fontSize: 12,
          }}>
            <span style={{ fontWeight: 600, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '—'}</span>
            <span style={{ color: 'var(--c-text2)' }}>{r.imei}</span>
            <span style={{ color: 'var(--c-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.deviceType || '—'}</span>
            <button type="button" className="ft-btn" onClick={() => onAdd(r)} style={{ ...PRIMARY_BTN, padding: '5px 12px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Add
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// GSM device identifiers are 15 digits. Anything else is allowed through —
// test units and some trackers report 16 or 17 — but it is worth saying out
// loud, because a mistyped IMEI is a vehicle that silently never reports.
const IMEI_LENGTH = 15

function imeiNotice(imei) {
  const v = String(imei ?? '').trim()
  if (!v) return null
  if (!/^\d+$/.test(v))         return { tone: 'error', text: 'IMEI must be digits only.' }
  if (v.length !== IMEI_LENGTH) return { tone: 'warn',  text: `Usually ${IMEI_LENGTH} digits — this one is ${v.length}.` }
  return null
}

export default function Vehicle(props) {
  const vehicles  = useVehicles()
  const companies = useCompanies()
  // Subscribed so the Branch and Group dropdowns react to rows added on their
  // own pages; the per-BG slices come from the *ForCompany reads.
  const branchList = useBranches()
  const groupList  = useGroups()
  // The places this account can see, for the "Also show in" field.
  const visible = useMemo(() => ({
    companies: new Map(companies.map(c => [c.id, c])),
    groups: new Map(groupList.map(g => [g.id, g])),
    branches: new Map(branchList.map(b => [b.id, b])),
  }), [companies, groupList, branchList])

  const { toasts, push, dismiss } = useToasts()
  // Client, 2026-11-10: one vehicle can move to another Business Group.
  const [moving, setMoving] = useState(null)
  // Client, 2026-11-17: trackers are changed here ({ vehicle, tab }).
  const [tracker, setTracker] = useState(null)
  const access = usePageAccess('vehicle')
  const canTracker = row => TRACKER_ACTIONS_AVAILABLE && access.canWrite && isOwned(row)

  // The Vehicle Number column carries a hint where Flespi disagrees (FlespiHint),
  // which opens the tracker dialog for a vehicle this account may change.
  const liveByImei = useLiveByImei()
  const columns = useMemo(() => COLUMNS.map(c => (c.key !== 'vehicleNumber' ? c : {
    ...c,
    render: row => {
      const status = !row.imei ? (TRACKER_ACTIONS_AVAILABLE ? { state: 'none' } : null) : flespiStatusFor(row, liveByImei)
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {row.vehicleNumber || '—'}
          <FlespiHint status={status} imei={row.imei} onResolve={status && canTracker(row) ? () => setTracker({ vehicle: row }) : undefined} />
        </span>
      )
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [liveByImei, access.canWrite])

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const [saving,  setSaving]  = useState(false)
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null
  const deviceTypes = useDeviceTypes(editing)
  const odo = useVehicleOdometer(draft?.id)
  const navigate = useNavigate()
  const unregistered = useUnregistered(!editing && !access.loading && access.canAdd, vehicles.length)
  const openAddTracker = r => {
    setErrors({})
    setDraft({ ...emptyVehicle(), vehicleNumber: r.name, imei: r.imei, deviceType: r.deviceType, shareTargets: [], sharesBefore: [], sharesFixed: [] })
  }

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  // `shareTargets` is the "Also show in" pick; `sharesBefore` what it was on open.
  const openAdd   = (preset = {}) => { setErrors({}); setDraft({ ...emptyVehicle(), ...preset, shareTargets: [], sharesBefore: [], sharesFixed: [] }) }
  const openEdit  = row => {
    setErrors({})
    const { value, fixed } = shareTargetsOf(row, visible)
    setDraft({ ...row, shareTargets: value, sharesBefore: value, sharesFixed: fixed })
  }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  // Deep link from the Vehicles panel on the GGB / Group / BG / Branch pages:
  // ?new=1&bg=<id>&branch=<id> opens Add with the BG (and branch) filled in.
  // Acted on once, so the save itself cannot reopen the form.
  const [params, setParams] = useSearchParams()
  const handledLink = useRef(null)
  // ?tracker=<IMEI> (Device Data Monitor's "No vehicle"): Add with that
  // unregistered tracker filled in, once the list of them has loaded.
  useEffect(() => {
    const imei = params.get('tracker')
    if (!imei || editing) return
    const hit = unregistered.find(r => r.imei === imei.replace(/\D/g, ''))
    if (!hit) return
    setParams({}, { replace: true })
    openAddTracker(hit)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, unregistered])
  useEffect(() => {
    const key = params.toString()
    if (!key || handledLink.current === key || !params.get('new')) return
    handledLink.current = key
    const bg = params.get('bg') || ''
    // The group follows the BG, as when the BG is chosen in the form.
    openAdd({ companyId: bg, branchId: params.get('branch') || '', groupId: bg ? groupIdForCompany(bg) : '' })
    setParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      if (key === 'companyId') {
        // A branch belongs to exactly one BG, so the old pick is not a valid
        // option under the new one.

        next.branchId = ''
        // The group is the BG's own when it has one; only a BG that acts as
        // its own group leaves this free to choose.
        next.groupId = groupIdForCompany(value)
        // Its own BG cannot also be a place it is shared to.
        next.shareTargets = (d.shareTargets ?? []).filter(t => !(t.level === 'bg' && t.id === value))
      }
      if (key === 'branchId') {
        next.shareTargets = (d.shareTargets ?? []).filter(t => !(t.level === 'branch' && t.id === value))
      }
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  // Depth-first with a `depth` per row, so a vehicle can be filed against a
  // sub-branch at any level and the dropdown still reads as a hierarchy.
  const branches = editing ? branchTreeForCompany(draft.companyId) : []
  const groups   = editing ? groupsForCompany(draft.companyId) : []
  // When the company carries a group, the vehicle inherits it and the field is
  // shown read-only — it is derived, not a choice.
  const groupLocked = editing && !!groupIdForCompany(draft.companyId)
  const notice = editing ? imeiNotice(draft.imei) : null

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!draft.companyId)              next.companyId     = 'Business Group is required'
    if (!draft.vehicleNumber.trim())   next.vehicleNumber = 'Vehicle Number is required'
    // An existing vehicle's tracker changes through the tracker dialog, and a
    // vehicle may have none (Remove tracker), so only Add requires it.
    const imeiLocked = IS_REAL && !!draft.id
    if (imeiLocked) { /* kept as the server has it */ }
    else if (!draft.imei.trim())       next.imei          = 'IMEI Number is required'
    // Digits-only is a hard stop; an unusual *length* is only a warning, so it
    // never appears here.
    else if (!/^\d+$/.test(draft.imei.trim())) next.imei = 'IMEI must be digits only'
    // One device, one vehicle: a duplicate IMEI means telemetry that cannot be
    // attributed to either row once Flespi is wired up.
    else if (isImeiTaken(draft.imei, draft.id)) next.imei = 'This IMEI is already registered to another vehicle.'
    if (odo.changed(draft.odoReading) && !(Number(draft.odoReading) >= 0 && Number(draft.odoReading) < 10_000_000)) {
      next.odoReading = 'A reading from 0 to 9,999,999 km'
    }

    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const { shareTargets = [], sharesBefore = [], sharesFixed: _fixed, ...rest } = draft
    const sharesDirty = SHARING_AVAILABLE && sharesChanged(sharesBefore, shareTargets)
    const clean = {
      ...rest,
      vehicleNumber: draft.vehicleNumber.trim(),
      vehicleId:     draft.vehicleId.trim(),
      imei:          draft.imei.trim(),
      subGroup:      draft.subGroup.trim(),
      odometer:      String(draft.odometer).trim(),
      make:          draft.make.trim(),
      model:         draft.model.trim(),
      deviceType:    String(draft.deviceType ?? '').trim(),
      validUntil:    draft.validUntil ?? '',
    }
    setSaving(true)
    try {
      if (draft.id) {
        // Only "Also show in" changed: no vehicle save, so the Flespi device
        // (renamed by every vehicle save) is not touched for a share.
        const saved = vehicles.find(v => v.id === draft.id)
        const fieldsDirty = !saved || RECORD_KEYS.some(k => String(saved[k] ?? '').trim() !== String(clean[k] ?? '').trim())
        if (fieldsDirty) await updateVehicle(draft.id, clean)
        // A new odometer reading corrects the vehicle's odometer (utils/odometer.js);
        // it never reaches the tracker.
        if (odo.changed(draft.odoReading)) await setVehicleOdometer(draft.id, Number(draft.odoReading))
        // Its other places: their own endpoint, which leaves the tracker alone.
        if (sharesDirty) await setVehicleShares(draft.id, shareTargets)
        push(`${clean.vehicleNumber} updated`, { tone: 'success' })
      } else {
        const created = await addVehicle(clean)
        if (sharesDirty && created?.id) await setVehicleShares(created.id, shareTargets)
        push(`${clean.vehicleNumber} added`, { tone: 'success' })
      }
      setDraft(null)
    } catch (err) {
      // A duplicate IMEI comes back 409 against `imei`, which is the same field the
      // local check above uses — so a clash with a vehicle in another tenant (which
      // this account cannot see, and so cannot check locally) reads identically.
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const row = pending
    setPending(null)
    try {
      await removeVehicle(row.id)
      push(`${vehicleLabel(row)} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Vehicle' : draft.id ? 'Edit Vehicle' : 'Add Vehicle'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Vehicle details' : 'New vehicle'}
            subtitle="Fields marked with * are required. The IMEI and Device Type add the tracker to live tracking on save — no Flespi panel needed."
          >
            <div style={GRID}>
              {/* Locked on an existing vehicle in real mode: the API accepts a
                  vehicle's BG only at creation time. Moving one between BGs would
                  also have to strip its sub-user assignments and alert memberships
                  in the old BG, which is a transfer operation rather than an edit. */}
              <Field
                label="Business Group"
                required
                error={errors.companyId}
                hint={IS_REAL && draft.id ? 'A vehicle cannot be moved to another Business Group.' : undefined}
              >
                <select
                  ref={firstRef}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  disabled={IS_REAL && !!draft.id}
                  aria-invalid={!!errors.companyId || undefined}
                  style={
                    IS_REAL && draft.id
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

              <Field label="Branch">
                <select
                  name="branchId"
                  value={draft.branchId}
                  onChange={e => set('branchId', e.target.value)}
                  disabled={!draft.companyId || branches.length === 0}
                  style={{
                    ...inputStyle(false),
                    opacity: !draft.companyId || branches.length === 0 ? 0.6 : 1,
                  }}
                >
                  <option value="">
                    {!draft.companyId
                      ? '— Select a Business Group first —'
                      : branches.length === 0
                        ? '— No branches for this Business Group —'
                        : '— None —'}
                  </option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{branchOptionLabel(b)}</option>
                  ))}
                </select>
              </Field>

              {/* Derived from the company when it has a group of its own;
                  selectable only when the company acts as its own group. */}
              <Field label="Group">
                {groupLocked ? (
                  <input
                    name="groupId"
                    value={groupNameFor(draft.groupId)}
                    readOnly
                    tabIndex={-1}
                    aria-readonly="true"
                    title="Taken from the selected Business Group's group"
                    style={{
                      ...inputStyle(false),
                      background: 'var(--c-thead)',
                      color: 'var(--c-text3)',
                      cursor: 'not-allowed',
                    }}
                  />
                ) : (
                  <select
                    name="groupId"
                    value={draft.groupId}
                    onChange={e => set('groupId', e.target.value)}
                    disabled={!draft.companyId || groups.length === 0}
                    style={{
                      ...inputStyle(false),
                      opacity: !draft.companyId || groups.length === 0 ? 0.6 : 1,
                    }}
                  >
                    <option value="">
                      {!draft.companyId
                        ? '— Select a Business Group first —'
                        : groups.length === 0
                          ? '— No groups for this Group Global Admin —'
                          : '— None (the Business Group is its own group) —'}
                    </option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </Field>

              {/* Plain text until the client defines a Sub-Group entity; see
                  emptyVehicle() in mockData.js for the upgrade path. */}
              <Field label="Sub-Group">
                <input
                  name="subGroup"
                  value={draft.subGroup}
                  onChange={e => set('subGroup', e.target.value)}
                  placeholder="Heavy"
                  style={inputStyle(false)}
                />
              </Field>

              <Field label="Vehicle Number" required error={errors.vehicleNumber}>
                <input
                  name="vehicleNumber"
                  value={draft.vehicleNumber}
                  onChange={e => set('vehicleNumber', e.target.value)}
                  aria-invalid={!!errors.vehicleNumber || undefined}
                  placeholder="AD 12345-G1"
                  style={inputStyle(!!errors.vehicleNumber)}
                />
              </Field>

              <Field label="Vehicle ID">
                <input
                  name="vehicleId"
                  value={draft.vehicleId}
                  onChange={e => set('vehicleId', e.target.value)}
                  placeholder="FL-01"
                  style={inputStyle(false)}
                />
              </Field>

              {/* The soft warning renders under the input itself rather than
                  through Field's `error` slot, which is styled for hard
                  validation failures and would overstate this. */}
              <Field
                label="IMEI Number"
                required={!(IS_REAL && draft.id)}
                error={errors.imei}
                hint={IS_REAL && draft.id ? 'Change or remove the tracker with Change tracker — FleetmaxX updates Flespi and keeps the history.' : undefined}
              >
                {IS_REAL && draft.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      name="imei"
                      value={draft.imei || 'No tracker'}
                      readOnly
                      tabIndex={-1}
                      aria-readonly="true"
                      style={{ ...inputStyle(false), background: 'var(--c-thead)', color: 'var(--c-text3)', cursor: 'not-allowed', flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="ft-btn"
                      onClick={() => { const row = vehicles.find(v => v.id === draft.id); closeForm(); if (row) setTracker({ vehicle: row }) }}
                      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Cpu size={13} />{draft.imei ? 'Change tracker' : 'Install tracker'}
                    </button>
                  </div>
                ) : (
                  <input
                    name="imei"
                    inputMode="numeric"
                    value={draft.imei}
                    onChange={e => set('imei', e.target.value)}
                    aria-invalid={!!errors.imei || undefined}
                    placeholder="863071011234501"
                    style={inputStyle(!!errors.imei)}
                  />
                )}
                {!errors.imei && notice && !(IS_REAL && draft.id) && (
                  <span style={{
                    display: 'block', marginTop: 3, fontSize: 10.5,
                    color: notice.tone === 'error' ? '#ef4444' : '#d97706',
                  }}>
                    {notice.text}
                  </span>
                )}
              </Field>

              <Field label="Device Type" error={errors.deviceType}>
                <input
                  name="deviceType"
                  list="flespi-device-types"
                  value={draft.deviceType ?? ''}
                  onChange={e => set('deviceType', e.target.value)}
                  aria-invalid={!!errors.deviceType || undefined}
                  placeholder="Teltonika FMC130"
                  style={inputStyle(!!errors.deviceType)}
                />
                <datalist id="flespi-device-types">
                  {deviceTypes.types.map(t => <option key={t.id} value={t.title} />)}
                </datalist>
                {(() => {
                  const t = deviceTypes.types.find(x => x.title.toLowerCase() === String(draft.deviceType ?? '').trim().toLowerCase())
                  const address = t && deviceTypes.addresses[t.protocolId]
                  return address ? (
                    <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: 'var(--c-text3)' }}>
                      Set the tracker to send to <b style={{ userSelect: 'all' }}>{address}</b>
                    </span>
                  ) : null
                })()}
              </Field>

              {IS_REAL ? (
                /* "Update the ODO meter reading" (client, 2026-11-12): the vehicle's
                   real odometer; the server keeps the difference from the tracker's,
                   so it keeps counting from here. Needs a tracker reading first. */
                <Field
                  label="Odometer Reading (km)"
                  error={errors.odoReading}
                  hint={!draft.id
                    ? 'Set it once the tracker has reported, here or in Settings › Bulk Action.'
                    : odo.loading ? 'Reading the tracker…'
                      : odo.deviceKm == null ? 'The tracker has not sent an odometer reading yet.'
                        : `The tracker reads ${odo.deviceKm.toLocaleString('en-US', { maximumFractionDigits: 1 })} km. Type the vehicle’s own reading to correct it.`}
                >
                  <input
                    name="odoReading"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={draft.odoReading ?? odo.value}
                    onChange={e => set('odoReading', e.target.value)}
                    disabled={!draft.id || odo.loading || odo.deviceKm == null}
                    placeholder={draft.id ? '150000' : '—'}
                    style={{ ...inputStyle(!!errors.odoReading), opacity: !draft.id || odo.deviceKm == null ? 0.6 : 1 }}
                  />
                </Field>
              ) : (
                <Field label="Odometer Reading">
                  <input
                    name="odometer"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="numeric"
                    value={draft.odometer}
                    onChange={e => set('odometer', e.target.value)}
                    placeholder="184320"
                    style={inputStyle(false)}
                  />
                </Field>
              )}

              <Field label="Make">
                <input
                  name="make"
                  value={draft.make}
                  onChange={e => set('make', e.target.value)}
                  placeholder="Volvo"
                  style={inputStyle(false)}
                />
              </Field>

              <Field label="Model">
                <input
                  name="model"
                  value={draft.model}
                  onChange={e => set('model', e.target.value)}
                  placeholder="FH16"
                  style={inputStyle(false)}
                />
              </Field>

              <Field label="Validity" hint="Service valid until">
                <input
                  name="validUntil"
                  type="date"
                  value={draft.validUntil ?? ''}
                  onChange={e => set('validUntil', e.target.value)}
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            {/* One vehicle in several places (client, 2026-11-13). Needs the server. */}
            {SHARING_AVAILABLE && draft.companyId && (
              <div style={{ marginTop: 16 }}>
                <ShareTargetsField
                  draft={draft}
                  value={draft.shareTargets ?? []}
                  fixed={draft.sharesFixed ?? []}
                  onChange={v => { setDraft(d => ({ ...d, shareTargets: v })); setErrors(e => (e.targets ? { ...e, targets: null } : e)) }}
                  error={errors.targets}
                />
              </div>
            )}

            <FormActions
              onBack={closeForm}
              onReset={() => {
                const saved = draft.id ? vehicles.find(v => v.id === draft.id) : null
                if (saved) openEdit(saved)
                else openAdd()
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
              saving={saving}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <ObjectTabs />
          <PageNotice {...access} />
          {TRACKER_ACTIONS_AVAILABLE && access.canWrite && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, padding: '9px 12px', borderRadius: 10,
              fontSize: 12, lineHeight: 1.5, color: 'var(--c-text2)',
              background: 'color-mix(in srgb, var(--ft-accent) 7%, transparent)',
              border: '1px solid color-mix(in srgb, var(--ft-accent) 28%, transparent)',
            }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ft-accent)' }} aria-hidden="true" />
              <span>
                <b style={{ color: 'var(--c-text1)' }}>Add and change trackers here; FleetmaxX updates Flespi for you.</b>{' '}
                There is no need to open the Flespi panel — a tracker changed there is not known here. Use <b>Change tracker</b> in a vehicle’s menu,
                and <b>Resolve</b> on a vehicle marked “Not in Flespi”. Every change is kept in the Reallocation History report.
              </span>
            </div>
          )}

          {!access.loading && (
            <>
              <TableToolbar count={vehicles.length} noun="vehicle" plural="vehicles">
                {access.canAdd && (
                  <>
                    <button
                      type="button"
                      className="ft-btn"
                      onClick={() => push('TRACKING APP import will pull vehicles from the Certificate app — not wired up yet.', { tone: 'info' })}
                    >
                      <FileBadge size={13} />
                      Import from Certificate (TRACKING APP)
                    </button>
                    <button
                      type="button"
                      style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
                      disabled={noCompanies}
                      // A vehicle has to belong to a BG, so with none on file the
                      // form would open with an unsatisfiable required dropdown.
                      title={noCompanies ? 'Add a Business Group first' : undefined}
                      onClick={() => openAdd()}
                    >
                      <Plus size={14} strokeWidth={2.6} />
                      Add Vehicle
                    </button>
                  </>
                )}
              </TableToolbar>

              <UnregisteredTrackers rows={unregistered} onAdd={openAddTracker} />

              <SettingsTable
                columns={columns}
                rows={vehicles}
                // Rows are identified by their Vehicle Number, not a `name` field.
                labelKey="vehicleNumber"
                // A vehicle shared into this account: its owner edits it, not this one.
                rowReadOnly={row => !isOwned(row)}
                extraActions={row => [{
                  label: `Create alert for ${vehicleLabel(row)}`,
                  icon: <BellPlus size={13} />,
                  onClick: () => navigate(`/settings/alerts?imei=${encodeURIComponent(row.imei)}`),
                }, ...(canTracker(row) ? [{
                  label: row.imei ? `Change tracker of ${vehicleLabel(row)}` : `Install a tracker in ${vehicleLabel(row)}`,
                  icon: <Cpu size={13} />,
                  onClick: () => setTracker({ vehicle: row }),
                }] : []), ...(access.canWrite && isOwned(row) ? [{
                  label: `Move ${vehicleLabel(row)} to another Business Group`,
                  icon: <ArrowRightLeft size={13} />,
                  onClick: () => setMoving(row),
                }] : [])]}
                onEdit={openEdit}
                onDelete={access.canDelete ? setPending : null}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No vehicles to show.'
                    : noCompanies
                      ? 'No Business Groups on file — add one before registering vehicles.'
                      : 'No vehicles yet — use Add Vehicle to register one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete vehicle?"
          body={`${vehicleLabel(pending)} will be removed from ${companyNameFor(pending.companyId)}.`}
          note={[
            'It is also unassigned from any sub-user or alert that could see it.',
            modeNote('This cannot be undone.', 'This is mock data — nothing is sent to a server.'),
          ].join(' ')}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      {moving && <VehicleMoveDialog vehicle={moving} push={push} onClose={() => setMoving(null)} />}
      {tracker && <TrackerDialog vehicle={tracker.vehicle} initialTab={tracker.tab} push={push} onClose={() => setTracker(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}

/**
 * The vehicle's odometer for the form: the tracker's reading and the vehicle's
 * (GET /api/vehicles/odometers). `changed(v)` says whether the box now holds a
 * new reading worth saving.
 */
function useVehicleOdometer(vehicleId) {
  const [state, setState] = useState({ loading: false, deviceKm: null, vehicleKm: null })
  useEffect(() => {
    if (!IS_REAL || !vehicleId) { setState({ loading: false, deviceKm: null, vehicleKm: null }); return }
    let live = true
    setState({ loading: true, deviceKm: null, vehicleKm: null })
    listVehicleOdometers()
      .then(rows => {
        const r = (rows ?? []).find(x => x.vehicleId === vehicleId)
        if (live) setState({ loading: false, deviceKm: r?.deviceKm ?? null, vehicleKm: r?.vehicleKm ?? null })
      })
      .catch(() => { if (live) setState({ loading: false, deviceKm: null, vehicleKm: null }) })
    return () => { live = false }
  }, [vehicleId])
  const value = state.vehicleKm != null ? String(Math.round(state.vehicleKm * 10) / 10) : ''
  const changed = v => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== value
  return { ...state, value, changed }
}
