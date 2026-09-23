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
  useAlerts, useCompanies, useVehicles,
  addAlert, updateAlert, removeAlert,
  companyNameFor, vehiclesForCompany, emptyAlert,
  vehicleLabel, vehicleSubLabel,
  ALERT_TYPES, alertTypeLabel,
} from './mockData'

// Alert rules. Controls are hand-built from FormKit's Field plus formStyles'
// inputStyle — the primitives FormFields composes internally, so they render
// identically — because this form is conditional on the chosen alert type and
// carries a scope picker and checkbox groups that FormFields cannot express.

// ── Type-specific settings ─────────────────────────────────────────────────
// Adding an alert type means: an entry in ALERT_TYPES (mockData), a renderer
// here, and a validator below. Nothing else in the page knows type names.

function TemperatureSettings({ settings, errors, onChange }) {
  return (
    <>
      <Field label="Min Temperature (°C)" error={errors.minTemp}>
        <input
          name="minTemp"
          type="number"
          step="any"
          inputMode="decimal"
          value={settings.minTemp}
          onChange={e => onChange('minTemp', e.target.value)}
          aria-invalid={!!errors.minTemp || undefined}
          placeholder="-18"
          style={inputStyle(!!errors.minTemp)}
        />
      </Field>
      <Field label="Max Temperature (°C)" error={errors.maxTemp}>
        <input
          name="maxTemp"
          type="number"
          step="any"
          inputMode="decimal"
          value={settings.maxTemp}
          onChange={e => onChange('maxTemp', e.target.value)}
          aria-invalid={!!errors.maxTemp || undefined}
          placeholder="-2"
          style={inputStyle(!!errors.maxTemp)}
        />
      </Field>
    </>
  )
}

// '' is unset. Parsed apart from 0, which is a real temperature, and negatives
// are ordinary for a reefer — so neither falsiness nor a sign check will do.
function toNum(v) {
  const s = String(v ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function validateTemperature(settings) {
  const out = {}
  const min = toNum(settings.minTemp)
  const max = toNum(settings.maxTemp)

  if (Number.isNaN(min)) out.minTemp = 'Must be a number'
  if (Number.isNaN(max)) out.maxTemp = 'Must be a number'
  if (Object.keys(out).length) return out

  if (min === null && max === null) {
    out.minTemp = 'Set a minimum, a maximum, or both.'
  } else if (min !== null && max !== null && max < min) {
    out.maxTemp = 'Maximum must be greater than or equal to the minimum.'
  }
  return out
}

const SETTINGS_RENDERERS = { temperature: TemperatureSettings }
const SETTINGS_VALIDATORS = { temperature: validateTemperature }

// ── Table ──────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  Active:   { color: '#16a34a', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' },
  Inactive: { color: 'var(--c-text3)', bg: 'var(--c-progress)', border: 'transparent' },
}

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.Inactive
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
      {status}
    </span>
  )
}

function scopeLabel(row) {
  const company = companyNameFor(row.companyId)
  if (row.allVehicles) return `${company} — All vehicles`
  const n = row.vehicleIds.length
  return `${company} — ${n} vehicle${n === 1 ? '' : 's'}`
}

const COLUMNS = [
  { key: 'name',      label: 'Alert Name', bold: true },
  { key: 'type',      label: 'Type',       render: row => alertTypeLabel(row.type) },
  { key: 'appliedTo', label: 'Applied To', render: scopeLabel },
  { key: 'status',    label: 'Status',     render: row => <StatusPill status={row.status} /> },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

const CHECK = { width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }

// ── Scope picker ───────────────────────────────────────────────────────────
/**
 * All Vehicles plus one checkbox per vehicle — the same control the sub-user
 * assignment panel uses, so the two read as one idea.
 *
 * The difference is what the header box means. Here "All Vehicles" is a stored
 * mode rather than a shortcut for ticking everything, so an alert set to all
 * also covers vehicles added to the BG later. Unticking it drops to an
 * explicit list, which is why the individual boxes are disabled while it is on:
 * they are not what the alert is using.
 */
function ScopePicker({ vehicles, allVehicles, selected, onToggleAll, onToggle, companyChosen, error }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 8,
      }}>
        <span className="ft-label">
          Vehicles<span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>
        </span>
        {companyChosen && vehicles.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
            {allVehicles ? `All ${vehicles.length}` : `${selected.length} of ${vehicles.length}`} selected
          </span>
        )}
      </div>

      <div style={{
        border: `1px solid ${error ? '#ef4444' : 'var(--c-border)'}`,
        borderRadius: 8,
        background: 'var(--c-input)',
        overflow: 'hidden',
      }}>
        {!companyChosen ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            Select a Business Group to choose which vehicles this alert watches.
          </p>
        ) : vehicles.length === 0 ? (
          <p style={{ margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }}>
            No vehicles registered for this BG.
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
                type="checkbox"
                name="allVehicles"
                checked={allVehicles}
                onChange={e => onToggleAll(e.target.checked)}
                style={CHECK}
              />
              All Vehicles
              <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--c-text3)' }}>
                including any added later
              </span>
            </label>

            <div style={{
              maxHeight: 220, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              opacity: allVehicles ? 0.55 : 1,
            }}>
              {vehicles.map(v => {
                const on = allVehicles || selected.includes(v.id)
                return (
                  <label
                    key={v.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', minWidth: 0, fontSize: 12.5,
                      cursor: allVehicles ? 'default' : 'pointer',
                      color: on ? 'var(--c-text1)' : 'var(--c-text2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={allVehicles}
                      onChange={() => onToggle(v.id)}
                      style={{ ...CHECK, cursor: allVehicles ? 'default' : 'pointer' }}
                    />
                    {/* Via the shared helpers, not hardcoded field names: the
                        vehicle shape changed once already and a literal
                        v.name here is how every row silently goes blank. */}
                    <span style={{ fontWeight: on ? 650 : 500, whiteSpace: 'nowrap' }}>
                      {vehicleLabel(v)}
                    </span>
                    <span style={{
                      fontSize: 11, color: 'var(--c-text3)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {vehicleSubLabel(v)}
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>

      {error && (
        <span style={{ fontSize: 10.5, color: '#ef4444', display: 'block', marginTop: 3 }}>
          {error}
        </span>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Alerts(props) {
  const alerts    = useAlerts()
  const companies = useCompanies()
  // Subscribed so the scope picker reacts to fleet changes made on the Vehicle
  // page; the per-company slice itself comes from vehiclesForCompany.
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

  const openAdd   = ()  => { setErrors({}); setDraft(emptyAlert()) }
  const openEdit  = row => {
    setErrors({})
    setDraft({ ...row, vehicleIds: [...row.vehicleIds], settings: { ...row.settings }, notify: { ...row.notify } })
  }
  const closeForm = () => { setErrors({}); setDraft(null) }

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A vehicle list from the old company means nothing under the new one.
      if (key === 'companyId') { next.vehicleIds = []; next.allVehicles = true }
      // Each type owns its own settings bag; carrying the old one over would
      // leave a temperature range attached to, say, a braking rule.
      if (key === 'type') {
        next.settings = ALERT_TYPES.find(t => t.value === value)?.defaults() ?? {}
      }
      return next
    })
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const setSetting = (key, value) => {
    setDraft(d => ({ ...d, settings: { ...d.settings, [key]: value } }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const setNotify = (key, value) =>
    setDraft(d => ({ ...d, notify: { ...d.notify, [key]: value } }))

  const toggleVehicle = id => setDraft(d => ({
    ...d,
    vehicleIds: d.vehicleIds.includes(id)
      ? d.vehicleIds.filter(x => x !== id)
      : [...d.vehicleIds, id],
  }))

  const toggleAll = on => setDraft(d => ({
    ...d,
    allVehicles: on,
    // Dropping to an explicit list starts from what "all" currently covers,
    // so turning the toggle off does not blank the selection under the user.
    vehicleIds: on ? [] : vehiclesForCompany(d.companyId).map(v => v.id),
  }))

  const vehicles = editing ? vehiclesForCompany(draft.companyId) : []
  const SettingsFields = editing ? SETTINGS_RENDERERS[draft.type] : null

  const submit = e => {
    e.preventDefault()

    const next = {}
    if (!draft.name.trim()) next.name      = 'Alert Name is required'
    if (!draft.type)        next.type      = 'Alert Type is required'
    if (!draft.companyId)   next.companyId = 'BG is required'

    // An alert that watches nothing can never fire, so an empty explicit scope
    // is a hard stop rather than a saved no-op.
    if (draft.companyId) {
      if (vehicles.length === 0) {
        next.scope = 'This BG has no vehicles to watch.'
      } else if (!draft.allVehicles && draft.vehicleIds.length === 0) {
        next.scope = 'Select at least one vehicle, or switch on All Vehicles.'
      }
    }

    Object.assign(next, SETTINGS_VALIDATORS[draft.type]?.(draft.settings) || {})

    if (Object.keys(next).length) {
      setErrors(next)
      const first = Object.keys(next)[0]
      formRef.current?.querySelector(`[name="${first}"]`)?.focus()
      return
    }

    const clean = {
      ...draft,
      name: draft.name.trim(),
      // Nothing reads vehicleIds while allVehicles is on; clearing it keeps a
      // stale list from reappearing if the mode is flipped back later.
      vehicleIds: draft.allVehicles ? [] : draft.vehicleIds,
    }
    if (draft.id) {
      updateAlert(draft.id, clean)
      push(`${clean.name} updated`, { tone: 'success' })
    } else {
      addAlert(clean)
      push(`${clean.name} added`, { tone: 'success' })
    }
    setDraft(null)
  }

  const confirmDelete = () => {
    removeAlert(pending.id)
    push(`${pending.name} deleted`, { tone: 'success' })
    setPending(null)
  }

  const noCompanies = companies.length === 0
  const title = !editing ? 'Alerts' : draft.id ? 'Edit Alert' : 'Add Alert'

  return (
    <SettingsLayout title={title} {...props}>
      {editing ? (
        <form ref={formRef} onSubmit={submit} noValidate>
          <FormCard
            title={draft.id ? 'Alert details' : 'New alert'}
            subtitle="Fields marked with * are required."
          >
            <div style={GRID}>
              <Field label="Alert Name" required error={errors.name}>
                <input
                  ref={firstRef}
                  name="name"
                  value={draft.name}
                  onChange={e => set('name', e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                  placeholder="Reefer temperature breach"
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Alert Type" required error={errors.type}>
                <select
                  name="type"
                  value={draft.type}
                  onChange={e => set('type', e.target.value)}
                  aria-invalid={!!errors.type || undefined}
                  style={inputStyle(!!errors.type)}
                >
                  <option value="">— Select —</option>
                  {ALERT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Apply To — BG" required error={errors.companyId}>
                <select
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

            <ScopePicker
              vehicles={vehicles}
              allVehicles={draft.allVehicles}
              selected={draft.vehicleIds}
              onToggleAll={toggleAll}
              onToggle={toggleVehicle}
              companyChosen={!!draft.companyId}
              error={errors.scope}
            />

            {SettingsFields && (
              <div style={{ marginTop: 18 }}>
                <span className="ft-label" style={{ display: 'block', marginBottom: 8 }}>
                  {alertTypeLabel(draft.type)} settings
                </span>
                <div style={GRID}>
                  <SettingsFields settings={draft.settings} errors={errors} onChange={setSetting} />
                </div>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <span className="ft-label" style={{ display: 'block', marginBottom: 8 }}>Notify Via</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                {[
                  { key: 'inApp', label: 'In-App' },
                  { key: 'email', label: 'Email' },
                  { key: 'sms',   label: 'SMS' },
                ].map(c => (
                  <label
                    key={c.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      cursor: 'pointer', fontSize: 12.5, color: 'var(--c-text2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      name={`notify-${c.key}`}
                      checked={draft.notify[c.key]}
                      onChange={e => setNotify(c.key, e.target.checked)}
                      style={CHECK}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: 'var(--c-text3)', margin: '7px 0 0' }}>
                Delivery is not wired up yet — these are stored with the alert for a later phase.
              </p>
            </div>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                const saved = draft.id ? alerts.find(a => a.id === draft.id) : null
                setDraft(saved
                  ? { ...saved, vehicleIds: [...saved.vehicleIds], settings: { ...saved.settings }, notify: { ...saved.notify } }
                  : emptyAlert())
              }}
              saveLabel={draft.id ? 'Save Changes' : 'Save'}
            />
          </FormCard>
        </form>
      ) : (
        <>
          <TableToolbar count={alerts.length} noun="alert" plural="alerts">
            <button
              type="button"
              style={{ ...PRIMARY_BTN, opacity: noCompanies ? 0.5 : 1, cursor: noCompanies ? 'not-allowed' : 'pointer' }}
              disabled={noCompanies}
              // An alert has to be scoped to a BG, so with none on file the
              // form would open with an unsatisfiable required dropdown.
              title={noCompanies ? 'Add a BG first' : undefined}
              onClick={openAdd}
            >
              <Plus size={14} strokeWidth={2.6} />
              Add Alert
            </button>
          </TableToolbar>

          <SettingsTable
            columns={COLUMNS}
            rows={alerts}
            onEdit={openEdit}
            onDelete={setPending}
            emptyLabel={noCompanies
              ? 'No BGs on file — add a Business Group before creating alerts.'
              : 'No alerts yet — use Add Alert to create one.'}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete alert?"
          body={`${pending.name} will stop watching ${scopeLabel(pending)}.`}
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
