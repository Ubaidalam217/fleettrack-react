import { useState, useRef, useEffect } from 'react'
import { Plus, FileBadge } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useVehicles, useCompanies, useBranches, useGroups,
  addVehicle, updateVehicle, removeVehicle,
  companyNameFor, branchesForCompany, groupsForCompany, groupIdForCompany,
  groupNameFor, vehicleLabel, emptyVehicle, isImeiTaken,
} from './mockData'

// The fleet register. Writes to the same vehicle store the sub-user assignment
// panel and the alert scope picker read, so a vehicle added here is immediately
// assignable and alertable.
//
// Controls are hand-built from FormKit's Field plus formStyles' inputStyle —
// the primitives FormFields composes internally, so they render identically —
// because Branch and Group depend on the chosen company and the IMEI field
// carries a warning that is not a validation error.

const COLUMNS = [
  { key: 'vehicleNumber', label: 'Vehicle Number', bold: true },
  { key: 'imei',          label: 'IMEI' },
  { key: 'company',       label: 'Company', render: row => companyNameFor(row.companyId) },
  {
    key: 'makeModel',
    label: 'Make/Model',
    render: row => [row.make, row.model].filter(Boolean).join(' ') || '—',
  },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
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
  // own pages; the per-company slices come from the *ForCompany reads.
  useBranches()
  useGroups()

  const { toasts, push, dismiss } = useToasts()

  const [draft,   setDraft]   = useState(null)
  const [errors,  setErrors]  = useState({})
  const [pending, setPending] = useState(null)
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const openAdd   = ()  => { setErrors({}); setDraft(emptyVehicle()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      if (key === 'companyId') {
        // A branch belongs to exactly one company, so the old pick is not a
        // valid option under the new one.
        next.branchId = ''
        // The group is the company's own when it has one; only a company that
        // acts as its own group leaves this free to choose.
        next.groupId = groupIdForCompany(value)
      }
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const branches = editing ? branchesForCompany(draft.companyId) : []
  const groups   = editing ? groupsForCompany(draft.companyId) : []
  // When the company carries a group, the vehicle inherits it and the field is
  // shown read-only — it is derived, not a choice.
  const groupLocked = editing && !!groupIdForCompany(draft.companyId)
  const notice = editing ? imeiNotice(draft.imei) : null

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.companyId)              next.companyId     = 'Company is required'
    if (!draft.vehicleNumber.trim())   next.vehicleNumber = 'Vehicle Number is required'
    if (!draft.imei.trim())            next.imei          = 'IMEI Number is required'
    // Digits-only is a hard stop; an unusual *length* is only a warning, so it
    // never appears here.
    else if (!/^\d+$/.test(draft.imei.trim())) next.imei = 'IMEI must be digits only'
    // One device, one vehicle: a duplicate IMEI means telemetry that cannot be
    // attributed to either row once Flespi is wired up.
    else if (isImeiTaken(draft.imei, draft.id)) next.imei = 'This IMEI is already registered to another vehicle.'

    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = {
      ...draft,
      vehicleNumber: draft.vehicleNumber.trim(),
      vehicleId:     draft.vehicleId.trim(),
      imei:          draft.imei.trim(),
      subGroup:      draft.subGroup.trim(),
      odometer:      String(draft.odometer).trim(),
      make:          draft.make.trim(),
      model:         draft.model.trim(),
    }
    if (draft.id) {
      updateVehicle(draft.id, clean)
      push(`${clean.vehicleNumber} updated`, { tone: 'success' })
    } else {
      addVehicle(clean)
      push(`${clean.vehicleNumber} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeVehicle(pending.id)
    push(`${vehicleLabel(pending)} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Vehicle' : draft.id ? 'Edit Vehicle' : 'Add Vehicle'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Vehicle details' : 'New vehicle'}
            subtitle="Fields marked with * are required. The IMEI is what matches this vehicle to its tracking device."
          >
            <div style={GRID}>
              <Field label="Company" required error={errors.companyId}>
                <select
                  ref={firstRef}
                  name="companyId"
                  value={draft.companyId}
                  onChange={e => set('companyId', e.target.value)}
                  aria-invalid={!!errors.companyId || undefined}
                  style={inputStyle(!!errors.companyId)}
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
                      ? '— Select a company first —'
                      : branches.length === 0
                        ? '— No branches for this company —'
                        : '— None —'}
                  </option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
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
                    title="Taken from the selected company's group"
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
                        ? '— Select a company first —'
                        : groups.length === 0
                          ? '— No groups for this reseller —'
                          : '— None (company is its own group) —'}
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
              <Field label="IMEI Number" required error={errors.imei}>
                <input
                  name="imei"
                  inputMode="numeric"
                  value={draft.imei}
                  onChange={e => set('imei', e.target.value)}
                  aria-invalid={!!errors.imei || undefined}
                  placeholder="863071011234501"
                  style={inputStyle(!!errors.imei)}
                />
                {!errors.imei && notice && (
                  <span style={{
                    display: 'block', marginTop: 3, fontSize: 10.5,
                    color: notice.tone === 'error' ? '#ef4444' : '#d97706',
                  }}>
                    {notice.text}
                  </span>
                )}
              </Field>

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
            </div>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? vehicles.find(v => v.id === draft.id) : null
                setDraft(saved ? { ...saved } : emptyVehicle())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={vehicles.length} noun="vehicle" plural="vehicles">
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
              // A vehicle has to belong to a company, so with none on file the
              // form would open with an unsatisfiable required dropdown.
              title={noCompanies ? 'Add a company first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Vehicle
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={vehicles}
            // Rows are identified by their Vehicle Number, not a `name` field.
            labelKey="vehicleNumber"
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No companies on file — add a company before registering vehicles.'
              : 'No vehicles yet — use Add Vehicle to register one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete vehicle?"
          body={`${vehicleLabel(pending)} will be removed from ${companyNameFor(pending.companyId)}.`}
          note="It is also unassigned from any sub-user or alert that could see it. This is mock data — nothing is sent to a server."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
