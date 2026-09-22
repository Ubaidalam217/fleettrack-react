import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useSubusers, useCompanies, useVehicles,
  addSubuser, updateSubuser, removeSubuser,
  companyNameFor, vehiclesForCompany, emptySubuser, isSubuserEmailTaken,
} from './mockData'

// A sub-user is a restricted login under a company, scoped to the vehicles
// assigned to it. Same control set as the User page; the addition is the
// assignment panel, which is driven by whichever company is selected.

const COLUMNS = [
  { key: 'name',     label: 'Sub-user Name', bold: true },
  { key: 'company',  label: 'Company', render: row => companyNameFor(row.companyId) },
  {
    key: 'vehicles',
    label: 'Assigned Vehicles',
    render: row => {
      const total = vehiclesForCompany(row.companyId).length
      const n = row.vehicleIds.length
      return n === 0 ? 'None' : `${n} of ${total}`
    },
  },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

// ── Vehicle assignment ─────────────────────────────────────────────────────
/**
 * Assign All plus one checkbox per vehicle. The header box is tri-state: ticked
 * when everything is assigned, indeterminate when only some is — "some" and
 * "none" look identical on a plain checkbox, and that is exactly the state an
 * operator most needs to be able to tell apart at a glance.
 */
function VehicleAssignment({ vehicles, selected, onToggle, onToggleAll, companyChosen }) {
  const allRef = useRef(null)
  const all  = vehicles.length > 0 && selected.length === vehicles.length
  const some = selected.length > 0 && !all

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some
  }, [some])

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 8,
      }}>
        <span className="ft-label">Vehicle Assignment</span>
        {vehicles.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
            {selected.length} of {vehicles.length} assigned
          </span>
        )}
      </div>

      <div style={{
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        background: 'var(--c-input)',
        overflow: 'hidden',
      }}>
        {!companyChosen ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            Select a company to see its vehicles.
          </p>
        ) : vehicles.length === 0 ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            No vehicles registered for this company.
          </p>
        ) : (
          <>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '9px 12px', cursor: 'pointer',
              borderBottom: '1px solid var(--c-border2)',
              background: 'var(--c-thead)',
              fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)',
            }}>
              <input
                ref={allRef}
                type="checkbox"
                checked={all}
                onChange={e => onToggleAll(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer' }}
              />
              Assign All
            </label>

            <div style={{
              maxHeight: 220, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            }}>
              {vehicles.map(v => {
                const on = selected.includes(v.id)
                return (
                  <label
                    key={v.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', cursor: 'pointer', minWidth: 0,
                      fontSize: 12.5,
                      color: on ? 'var(--c-text1)' : 'var(--c-text2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(v.id)}
                      style={{ width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    {/* Lead with the name and join whatever identifiers the
                        record actually has. The Vehicle page treats the plate
                        as optional and never collects fleetNo or type, so a
                        fixed "plate — fleetNo · type" line renders blanks and
                        stray separators for anything added there. */}
                    <span style={{ fontWeight: on ? 650 : 500, whiteSpace: 'nowrap' }}>
                      {v.name || v.plateNo}
                    </span>
                    <span style={{
                      fontSize: 11, color: 'var(--c-text3)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {[v.plateNo, v.imei, v.type].filter(Boolean).join(' · ')}
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CompanySubuser(props) {
  const subusers  = useSubusers()
  const companies = useCompanies()
  // Subscribed so the panel re-renders if the vehicle list ever changes under
  // it; the per-company slice itself comes from vehiclesForCompany.
  useVehicles()

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

  const openAdd   = ()  => { setErrors({}); setDraft(emptySubuser()) }
  const openEdit  = row => { setErrors({}); setDraft({ ...row, vehicleIds: [...row.vehicleIds] }) }
  const closeForm = ()  => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // Vehicle ids belong to the old company and mean nothing under the new
      // one, so switching company starts the assignment over.
      if (key === 'companyId') next.vehicleIds = []
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const vehicles = editing ? vehiclesForCompany(draft.companyId) : []

  const toggleVehicle = id => setDraft(d => ({
    ...d,
    vehicleIds: d.vehicleIds.includes(id)
      ? d.vehicleIds.filter(x => x !== id)
      : [...d.vehicleIds, id],
  }))

  const toggleAll = on => setDraft(d => ({
    ...d,
    vehicleIds: on ? vehiclesForCompany(d.companyId).map(v => v.id) : [],
  }))

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.companyId)    next.companyId = 'Company is required'
    if (!draft.name.trim())  next.name      = 'Short Name is required'
    if (!draft.email.trim()) next.email     = 'Email is required'
    // The email is the username, so this is the login-uniqueness check too.
    else if (isSubuserEmailTaken(draft.email, draft.id)) next.email = 'A sub-user with this email already exists.'
    if (Object.keys(next).length) {
      setErrors(next)
      formRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    const clean = { ...draft, name: draft.name.trim(), email: draft.email.trim() }
    if (draft.id) {
      updateSubuser(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addSubuser(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeSubuser(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Company Subuser' : draft.id ? 'Edit Subuser' : 'Add Subuser'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Sub-user details' : 'New sub-user'}
            subtitle="Fields marked with * are required. The username is the email address."
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

              <Field label="Short Name" required error={errors.name}>
                <input
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Mussafah Dispatch"
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Email" required error={errors.email}>
                <input
                  name="email"
                  type="email"
                  value={draft.email}
                  onChange={e => set('email', e.target.value)}
                  aria-invalid={!!errors.email || undefined}
                  placeholder="name@company.ae"
                  style={inputStyle(!!errors.email)}
                />
              </Field>

              {/* Not stored — rendered from the email, same as the User page. */}
              <Field label="Username">
                <input
                  name="username"
                  value={draft.email}
                  readOnly
                  tabIndex={-1}
                  aria-readonly="true"
                  placeholder="Set by the Email field"
                  style={{
                    ...inputStyle(false),
                    background: 'var(--c-thead)',
                    color: 'var(--c-text3)',
                    cursor: 'not-allowed',
                  }}
                />
              </Field>

              <Field label="Password">
                <input
                  name="password"
                  value={draft.password}
                  onChange={e => set('password', e.target.value)}
                  style={inputStyle(false)}
                />
              </Field>
            </div>

            <VehicleAssignment
              vehicles={vehicles}
              selected={draft.vehicleIds}
              onToggle={toggleVehicle}
              onToggleAll={toggleAll}
              companyChosen={!!draft.companyId}
            />

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? subusers.find(s => s.id === draft.id) : null
                setDraft(saved ? { ...saved, vehicleIds: [...saved.vehicleIds] } : emptySubuser())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={subusers.length} noun="sub-user" plural="sub-users">
            <button
              type="button"
              style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
              disabled={noCompanies}
              title={noCompanies ? 'Add a company first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Subuser
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={subusers}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No companies on file — add a company before creating sub-users.'
              : 'No sub-users yet — use Add Subuser to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete sub-user?"
          body={`${pending.name} will lose access to ${companyNameFor(pending.companyId)}.`}
          note="This is mock data — nothing is sent to a server."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
