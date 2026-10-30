import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import SettingsTable, { TableToolbar } from './SettingsTable'
import { Field, FormActions, FormCard } from './FormKit'
import { PRIMARY_BTN, inputStyle } from './formStyles'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import ToastStack from '../../components/tracking/Toasts'
import SeverityChip from '../../components/alerts/SeverityChip'
import { useToasts } from '../../hooks/useToasts'
import {
  useAlerts, useCompanies, useVehicles, useGeofences,
  addAlert, updateAlert, removeAlert,
  companyNameFor, vehiclesForCompany, emptyAlert, normalizeAlert,
  vehicleLabel, vehicleSubLabel,
  ALERT_TYPES, ALERT_SEVERITIES, alertTypeLabel, alertTypeOf,
} from '../../data/settings'
import { validateAlertSettings, parseEmails, MAX_RECIPIENTS } from './alertRules'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import PageNotice from './PageNotice'
import { IS_REAL } from '../../data/mode'

// Alert rules. Controls are hand-built from FormKit's Field plus formStyles'
// inputStyle — the primitives FormFields composes internally, so they render
// identically — because this form is conditional on the chosen alert type and
// carries a scope picker and checkbox groups that FormFields cannot express.

// ── Type-specific settings ─────────────────────────────────────────────────
// Adding an alert type means: an entry in ALERT_TYPES (mockData), a renderer
// here, and a validator in alertRules.js. Nothing else in the page knows type
// names. A type with no renderer (Ignition On/Off) simply has no settings block.

function NumberField({ label, name, value, error, onChange, placeholder, hint, step = '1' }) {
  return (
    <Field label={label} required error={error} hint={hint}>
      <input
        name={name}
        type="number"
        step={step}
        inputMode="numeric"
        value={value ?? ''}
        onChange={e => onChange(name, e.target.value)}
        aria-invalid={!!error || undefined}
        placeholder={placeholder}
        style={inputStyle(!!error)}
      />
    </Field>
  )
}

function OverspeedSettings({ settings, errors, onChange }) {
  return (
    <NumberField
      label="Speed Limit (km/h)" name="speedKmh" placeholder="120" hint="10 – 300 km/h"
      value={settings.speedKmh} error={errors.speedKmh} onChange={onChange}
    />
  )
}

function IdleSettings({ settings, errors, onChange }) {
  return (
    <NumberField
      label="Idle For At Least (minutes)" name="minutes" placeholder="15" hint="1 – 1440 minutes"
      value={settings.minutes} error={errors.minutes} onChange={onChange}
    />
  )
}

function OfflineSettings({ settings, errors, onChange }) {
  return (
    <NumberField
      label="No Data For At Least (minutes)" name="minutes" placeholder="60" hint="1 – 1440 minutes"
      value={settings.minutes} error={errors.minutes} onChange={onChange}
    />
  )
}

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

function NightSettings({ settings, errors, onChange }) {
  return (
    <>
      <Field label="Night Starts" required error={errors.from} hint="UAE time">
        <input
          name="from"
          type="time"
          value={settings.from ?? ''}
          onChange={e => onChange('from', e.target.value)}
          aria-invalid={!!errors.from || undefined}
          style={inputStyle(!!errors.from)}
        />
      </Field>
      <Field label="Night Ends" required error={errors.to} hint="May be after midnight">
        <input
          name="to"
          type="time"
          value={settings.to ?? ''}
          onChange={e => onChange('to', e.target.value)}
          aria-invalid={!!errors.to || undefined}
          style={inputStyle(!!errors.to)}
        />
      </Field>
      <NumberField
        label="Moving Faster Than (km/h)" name="minSpeedKmh" placeholder="10" hint="1 – 200 km/h"
        value={settings.minSpeedKmh} error={errors.minSpeedKmh} onChange={onChange}
      />
    </>
  )
}

function LicenceSettings({ settings, errors, onChange }) {
  return (
    <NumberField
      label="Warn Before Expiry (days)" name="days" placeholder="30" hint="1 – 365 days"
      value={settings.days} error={errors.days} onChange={onChange}
    />
  )
}

const SETTINGS_RENDERERS = {
  overspeed:      OverspeedSettings,
  idle:           IdleSettings,
  offline:        OfflineSettings,
  temperature:    TemperatureSettings,
  night_driving:  NightSettings,
  license_expiry: LicenceSettings,
}

// The geofence types render their own full-width picker below the grid rather
// than a grid cell, so they are not in SETTINGS_RENDERERS.
const GEOFENCE_TYPES = new Set(['geofence_enter', 'geofence_exit'])

const watchesVehicles = type => alertTypeOf(type)?.vehicles !== false

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

function vehiclesLabel(row) {
  if (!watchesVehicles(row.type)) return 'All drivers'
  if (row.allVehicles) return 'All'
  const n = row.vehicleIds.length
  return `${n} vehicle${n === 1 ? '' : 's'}`
}

function scopeLabel(row) {
  const company = companyNameFor(row.companyId)
  if (!watchesVehicles(row.type)) return `${company} — all drivers`
  if (row.allVehicles) return `${company} — All vehicles`
  const n = row.vehicleIds.length
  return `${company} — ${n} vehicle${n === 1 ? '' : 's'}`
}

function notifyLabel(row) {
  const on = [row.notify?.inApp && 'In-app', row.notify?.email && 'Email'].filter(Boolean)
  return on.length ? on.join(' · ') : '—'
}

const COLUMNS = [
  { key: 'name',     label: 'Name',       bold: true },
  { key: 'type',     label: 'Alert Type', render: row => alertTypeLabel(row.type) },
  { key: 'severity', label: 'Severity',   render: row => <SeverityChip severity={row.severity} /> },
  { key: 'company',  label: 'BG',         render: row => companyNameFor(row.companyId) },
  { key: 'vehicles', label: 'Vehicles',   render: vehiclesLabel },
  { key: 'notify',   label: 'Notify',     render: notifyLabel },
  { key: 'status',   label: 'Status',     render: row => <StatusPill status={row.status} /> },
]

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '14px 16px',
}

// auto-fill rather than auto-fit: most types have one or two settings, and a
// lone speed-limit box stretched across the whole card reads as a text area.
const SETTINGS_GRID = { ...GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }

const CHECK = { width: 15, height: 15, accentColor: 'var(--ft-accent)', cursor: 'pointer', flexShrink: 0 }

const SECTION_LABEL = { display: 'block', marginBottom: 8 }

const NOTE = { margin: 0, padding: '18px 12px', textAlign: 'center', fontSize: 12, color: 'var(--c-text3)' }

const ERROR_TEXT = { fontSize: 10.5, color: '#ef4444', display: 'block', marginTop: 3 }

// ── Pick list ──────────────────────────────────────────────────────────────
/**
 * An "All …" header box plus one checkbox per item — the same control the
 * sub-user assignment panel uses, so the three pickers read as one idea.
 *
 * The header box is a stored mode rather than a shortcut for ticking
 * everything, so an alert set to all also covers vehicles (or geofences) added
 * to the BG later. Unticking it drops to an explicit list, which is why the
 * individual boxes are disabled while it is on: they are not what the alert is
 * using.
 */
function PickList({
  label, field, items, all, selected, onToggleAll, onToggle,
  allLabel, allNote, emptyNote, error, itemLabel, itemSub,
}) {
  return (
    <div style={{ marginTop: 18 }} data-field={field}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 8,
      }}>
        <span className="ft-label">
          {label}<span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>
        </span>
        {items.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
            {all ? `All ${items.length}` : `${selected.length} of ${items.length}`} selected
          </span>
        )}
      </div>

      <div style={{
        border: `1px solid ${error ? '#ef4444' : 'var(--c-border)'}`,
        borderRadius: 8,
        background: 'var(--c-input)',
        overflow: 'hidden',
      }}>
        {emptyNote ? (
          <p style={NOTE}>{emptyNote}</p>
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
                name={field}
                checked={all}
                onChange={e => onToggleAll(e.target.checked)}
                style={CHECK}
              />
              {allLabel}
              <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--c-text3)' }}>
                {allNote}
              </span>
            </label>

            <div style={{
              maxHeight: 220, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              opacity: all ? 0.55 : 1,
            }}>
              {items.map(item => {
                const on = all || selected.includes(item.id)
                return (
                  <label
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', minWidth: 0, fontSize: 12.5,
                      cursor: all ? 'default' : 'pointer',
                      color: on ? 'var(--c-text1)' : 'var(--c-text2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={all}
                      onChange={() => onToggle(item.id)}
                      style={{ ...CHECK, cursor: all ? 'default' : 'pointer' }}
                    />
                    <span style={{ fontWeight: on ? 650 : 500, whiteSpace: 'nowrap' }}>
                      {itemLabel(item)}
                    </span>
                    <span style={{
                      fontSize: 11, color: 'var(--c-text3)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {itemSub(item)}
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>

      {error && <span style={ERROR_TEXT}>{error}</span>}
    </div>
  )
}

const KIND_LABEL = { GEOFENCE: 'Geofence', ADDRESS: 'Address' }

function geofenceSub(g) {
  return [KIND_LABEL[g.kind] ?? g.kind, g.category, g.active === false && 'inactive'].filter(Boolean).join(' · ')
}

// ── Email recipients ───────────────────────────────────────────────────────
/**
 * Addresses as removable chips with a free-text box after them. Enter, a comma
 * or leaving the box turns what was typed into chips; anything that is not an
 * address stays in the box so it can be corrected rather than silently dropped.
 * The text itself is held by the page, so Save can still pick up an address
 * that was typed but never committed.
 */
function EmailRecipients({ emails, text, onText, onCommit, onRemove, error }) {
  const onKeyDown = e => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      // Enter would otherwise submit the whole form from inside this box.
      e.preventDefault()
      onCommit(text)
    } else if (e.key === 'Backspace' && text === '' && emails.length) {
      onRemove(emails[emails.length - 1])
    }
  }

  return (
    <Field
      label="Email Recipients"
      required
      error={error}
      hint={`Press Enter or comma after each address · up to ${MAX_RECIPIENTS}`}
    >
      <div
        style={{
          ...inputStyle(!!error),
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
          padding: '6px 8px', minHeight: 36, cursor: 'text',
        }}
        onClick={e => e.currentTarget.querySelector('input')?.focus()}
      >
        {emails.map(addr => (
          <span
            key={addr}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 4px 2px 8px', borderRadius: 999,
              background: 'color-mix(in srgb, var(--ft-accent) 12%, transparent)',
              color: 'var(--c-text1)', fontSize: 11.5, fontWeight: 600,
            }}
          >
            {addr}
            <button
              type="button"
              onClick={() => onRemove(addr)}
              aria-label={`Remove ${addr}`}
              title={`Remove ${addr}`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: '50%', border: 'none',
                background: 'transparent', color: 'var(--c-text3)', cursor: 'pointer', padding: 0,
              }}
            >
              <X size={11} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        <input
          name="emails"
          type="text"
          inputMode="email"
          autoComplete="off"
          value={text}
          onChange={e => {
            const v = e.target.value
            // A pasted list arrives in one change; split it straight away.
            if (/[,;\n]/.test(v)) onCommit(v)
            else onText(v)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onCommit(text)}
          aria-invalid={!!error || undefined}
          placeholder={emails.length ? '' : 'name@company.com'}
          style={{
            flex: 1, minWidth: 160, border: 'none', outline: 'none',
            background: 'transparent', color: 'var(--c-text1)', fontSize: 12.5, padding: '2px 0',
          }}
        />
      </div>
    </Field>
  )
}

/** Recipients after folding in whatever is still in the text box. */
function mergeEmails(list, text) {
  const { valid, invalid } = parseEmails(text)
  return { emails: [...new Set([...list, ...valid])], invalid }
}

/**
 * The server's 400 names its own fields; most match the form's, a few do not.
 * `vehicleIds` is the scope picker, a bad recipient comes back as `emails.3`,
 * and anything under `params.` is one of the type's own settings.
 */
function formErrorKey(key) {
  if (key === 'vehicleIds') return 'scope'
  if (key.startsWith('emails')) return 'emails'
  if (key.startsWith('params.')) return key.slice('params.'.length)
  return key
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Alerts(props) {
  const alerts    = useAlerts()
  const companies = useCompanies()
  const geofences = useGeofences()
  // Subscribed so the scope picker reacts to fleet changes made on the Vehicle
  // page; the per-company slice itself comes from vehiclesForCompany.
  useVehicles()

  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('alerts')

  const [draft,     setDraft]     = useState(null)
  const [errors,    setErrors]    = useState({})
  const [pending,   setPending]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [emailText, setEmailText] = useState('')
  const firstRef = useRef(null)
  const formRef  = useRef(null)

  const editing = draft !== null

  useEffect(() => {
    if (editing) firstRef.current?.focus()
  }, [editing])

  const bgGeofences = useMemo(
    () => (draft?.companyId ? geofences.filter(g => g.companyId === draft.companyId) : []),
    [geofences, draft?.companyId]
  )

  /**
   * A stored rule widened to the form's shape. Geofence ids that no longer
   * resolve are dropped here — the server would reject the save over them — but
   * the All box is read from what was stored, so a rule whose chosen fences have
   * all been deleted opens with nothing ticked and asks for a choice, rather
   * than quietly widening to every fence.
   */
  const toDraft = row => {
    const d = normalizeAlert(row)
    if (Array.isArray(d.settings.geofenceIds)) {
      const live = new Set(geofences.filter(g => g.companyId === d.companyId).map(g => g.id))
      d.settings.geofenceIds = d.settings.geofenceIds.filter(id => live.has(id))
    }
    return d
  }

  const open      = d   => { setErrors({}); setEmailText(''); setDraft(d) }
  const openAdd   = ()  => open(emptyAlert())
  const openEdit  = row => open(toDraft(row))
  const closeForm = ()  => { setErrors({}); setEmailText(''); setDraft(null) }

  const clearError = key => setErrors(e => (e[key] ? { ...e, [key]: null } : e))

  const set = (key, value) => {
    setDraft(d => {
      const next = { ...d, [key]: value }
      // A vehicle list from the old company means nothing under the new one, and
      // neither does a geofence list: fences belong to one BG too.
      if (key === 'companyId') {
        next.vehicleIds = []
        next.allVehicles = true
        if (Array.isArray(d.settings.geofenceIds)) {
          next.settings = { ...d.settings, geofenceIds: [], allGeofences: true }
        }
      }
      // Each type owns its own settings bag; carrying the old one over would
      // leave a temperature range attached to, say, an over-speed rule.
      if (key === 'type') {
        next.settings = alertTypeOf(value)?.defaults() ?? {}
      }
      return next
    })
    // A new type brings new settings fields, so the old type's messages go; the
    // ones about fields every type shares stay.
    if (key === 'type') setErrors(e => ({ name: e.name, companyId: e.companyId, scope: e.scope, emails: e.emails }))
    else clearError(key)
  }

  const setSetting = (key, value) => {
    setDraft(d => ({ ...d, settings: { ...d.settings, [key]: value } }))
    clearError(key)
  }

  const setNotify = (key, value) => {
    setDraft(d => ({ ...d, notify: { ...d.notify, [key]: value } }))
    if (key === 'email' && !value) clearError('emails')
  }

  const toggleVehicle = id => {
    setDraft(d => ({
      ...d,
      vehicleIds: d.vehicleIds.includes(id)
        ? d.vehicleIds.filter(x => x !== id)
        : [...d.vehicleIds, id],
    }))
    clearError('scope')
  }

  const toggleAll = on => {
    setDraft(d => ({
      ...d,
      allVehicles: on,
      // Dropping to an explicit list starts from what "all" currently covers,
      // so turning the toggle off does not blank the selection under the user.
      vehicleIds: on ? [] : vehiclesForCompany(d.companyId).map(v => v.id),
    }))
    clearError('scope')
  }

  const toggleGeofence = id => {
    setDraft(d => {
      const ids = d.settings.geofenceIds ?? []
      return {
        ...d,
        settings: {
          ...d.settings,
          geofenceIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
        },
      }
    })
    clearError('geofenceIds')
  }

  const toggleAllGeofences = on => {
    setDraft(d => ({
      ...d,
      // Same rule as the vehicle picker: unticking All starts from everything.
      settings: {
        ...d.settings,
        allGeofences: on,
        geofenceIds: on ? [] : bgGeofences.map(g => g.id),
      },
    }))
    clearError('geofenceIds')
  }

  const commitEmails = text => {
    const { emails, invalid } = mergeEmails(draft.emails, text)
    setDraft(d => ({ ...d, emails: emails.slice(0, MAX_RECIPIENTS) }))
    setEmailText(invalid.join(', '))
    setErrors(e => ({
      ...e,
      emails: invalid.length
        ? `Not a valid email address: ${invalid[0]}`
        : emails.length > MAX_RECIPIENTS ? `At most ${MAX_RECIPIENTS} recipients` : null,
    }))
  }

  const removeEmail = addr => {
    setDraft(d => ({ ...d, emails: d.emails.filter(x => x !== addr) }))
    clearError('emails')
  }

  const vehicles = editing ? vehiclesForCompany(draft.companyId) : []
  const SettingsFields = editing ? SETTINGS_RENDERERS[draft.type] : null
  const byVehicle = editing && watchesVehicles(draft.type)
  const typeMeta = editing ? alertTypeOf(draft.type) : null

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    // An address typed but never turned into a chip still counts.
    const { emails, invalid } = mergeEmails(draft.emails, emailText)

    const next = {}
    if (!draft.name.trim()) next.name      = 'Alert Name is required'
    if (!draft.type)        next.type      = 'Alert Type is required'
    if (!draft.companyId)   next.companyId = 'BG is required'

    Object.assign(next, validateAlertSettings(draft.type, draft.settings))

    // An alert that watches nothing can never fire, so an empty explicit scope
    // is a hard stop rather than a saved no-op.
    if (draft.companyId && byVehicle) {
      if (vehicles.length === 0) {
        next.scope = 'This BG has no vehicles to watch.'
      } else if (!draft.allVehicles && draft.vehicleIds.length === 0) {
        next.scope = 'Select at least one vehicle, or switch on All Vehicles.'
      }
    }

    if (invalid.length) {
      next.emails = `Not a valid email address: ${invalid[0]}`
    } else if (emails.length > MAX_RECIPIENTS) {
      next.emails = `At most ${MAX_RECIPIENTS} recipients`
    } else if (draft.notify.email && emails.length === 0) {
      next.emails = 'Add at least one email address, or turn Email off.'
    }

    if (Object.keys(next).length) {
      setErrors(next)
      const first = Object.keys(next)[0]
      const el = formRef.current?.querySelector(`[name="${first}"], [data-field="${first}"]`)
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      el?.focus?.()
      return
    }

    const clean = {
      ...draft,
      name: draft.name.trim(),
      emails,
      // SMS has no delivery behind it; never store it as switched on.
      notify: { ...draft.notify, sms: false },
      // Nothing reads vehicleIds while allVehicles is on; clearing it keeps a
      // stale list from reappearing if the mode is flipped back later.
      allVehicles: byVehicle ? draft.allVehicles : true,
      vehicleIds: byVehicle && !draft.allVehicles ? draft.vehicleIds : [],
    }
    setSaving(true)
    try {
      if (draft.id) {
        await updateAlert(draft.id, clean)
        push(`${clean.name} updated`, { tone: 'success' })
      } else {
        await addAlert(clean)
        push(`${clean.name} added`, { tone: 'success' })
      }
      setDraft(null)
      setEmailText('')
    } catch (err) {
      handleApiError(err, {
        push,
        // Re-keyed onto the form's own field names; see formErrorKey().
        setErrors: update => setErrors(prev => {
          const out = { ...prev }
          for (const [k, v] of Object.entries(update({}))) out[formErrorKey(k)] = v
          return out
        }),
      })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const row = pending
    setPending(null)
    try {
      await removeAlert(row.id)
      push(`${row.name} deleted`, { tone: 'success' })
    } catch (err) {
      handleApiError(err, { push })
    }
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
                  placeholder="Highway over speed"
                  style={inputStyle(!!errors.name)}
                />
              </Field>

              <Field label="Alert Type" required error={errors.type} hint={typeMeta?.hint}>
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

              {/* Locked on an existing alert in real mode: the API takes an alert's
                  BG only at creation time, since its explicit vehicle list is
                  validated against that BG and re-pointing it would leave the rule
                  watching vehicles from a tenant it no longer belongs to. */}
              <Field
                label="Apply To — BG"
                required
                error={errors.companyId}
                hint={IS_REAL && draft.id ? 'An alert cannot be moved to another BG.' : undefined}
              >
                <select
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

              <Field label="Severity" required error={errors.severity}>
                <select
                  name="severity"
                  value={draft.severity}
                  onChange={e => set('severity', e.target.value)}
                  aria-invalid={!!errors.severity || undefined}
                  style={inputStyle(!!errors.severity)}
                >
                  {ALERT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
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

            {SettingsFields && (
              <div style={{ marginTop: 18 }}>
                <span className="ft-label" style={SECTION_LABEL}>
                  {alertTypeLabel(draft.type)} settings
                </span>
                <div style={SETTINGS_GRID}>
                  <SettingsFields settings={draft.settings} errors={errors} onChange={setSetting} />
                </div>
              </div>
            )}

            {GEOFENCE_TYPES.has(draft.type) && (
              <PickList
                label="Geofences"
                field="geofenceIds"
                items={bgGeofences}
                all={!!draft.settings.allGeofences}
                selected={draft.settings.geofenceIds ?? []}
                onToggleAll={toggleAllGeofences}
                onToggle={toggleGeofence}
                allLabel="All geofences"
                allNote="including any added later"
                emptyNote={
                  !draft.companyId
                    ? 'Select a Business Group to choose which geofences this alert watches.'
                    : bgGeofences.length === 0
                      ? 'No geofences for this BG yet. The alert will watch any you add under Settings > Geofence.'
                      : null
                }
                error={errors.geofenceIds}
                itemLabel={g => g.name}
                itemSub={geofenceSub}
              />
            )}

            {byVehicle ? (
              <PickList
                label="Vehicles"
                field="scope"
                items={vehicles}
                all={draft.allVehicles}
                selected={draft.vehicleIds}
                onToggleAll={toggleAll}
                onToggle={toggleVehicle}
                allLabel="All Vehicles"
                allNote="including any added later"
                emptyNote={
                  !draft.companyId
                    ? 'Select a Business Group to choose which vehicles this alert watches.'
                    : vehicles.length === 0
                      ? 'No vehicles registered for this BG.'
                      : null
                }
                error={errors.scope}
                // Via the shared helpers, not hardcoded field names: the vehicle
                // shape changed once already and a literal v.name here is how
                // every row silently goes blank.
                itemLabel={vehicleLabel}
                itemSub={vehicleSubLabel}
              />
            ) : (
              <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: '18px 0 0' }}>
                Applies to every driver in this BG who has a licence expiry date on file.
              </p>
            )}

            <div style={{ marginTop: 18 }}>
              <span className="ft-label" style={SECTION_LABEL}>Notify Via</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 20px' }}>
                {[
                  { key: 'inApp', label: 'In-App' },
                  { key: 'email', label: 'Email' },
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
                      checked={!!draft.notify[c.key]}
                      onChange={e => setNotify(c.key, e.target.checked)}
                      style={CHECK}
                    />
                    {c.label}
                  </label>
                ))}
                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    fontSize: 12.5, color: 'var(--c-text3)', cursor: 'not-allowed',
                  }}
                >
                  <input type="checkbox" checked={false} disabled readOnly style={{ ...CHECK, cursor: 'not-allowed' }} />
                  SMS
                  <span style={{ fontSize: 11 }}>· SMS not enabled</span>
                </label>
              </div>

              {draft.notify.email && (
                <div style={{ marginTop: 14, maxWidth: 640 }}>
                  <EmailRecipients
                    emails={draft.emails}
                    text={emailText}
                    onText={v => { setEmailText(v); clearError('emails') }}
                    onCommit={commitEmails}
                    onRemove={removeEmail}
                    error={errors.emails}
                  />
                </div>
              )}
            </div>

            <FormActions
              onBack={closeForm}
              onReset={() => {
                setErrors({})
                setEmailText('')
                const saved = draft.id ? alerts.find(a => a.id === draft.id) : null
                setDraft(saved ? toDraft(saved) : emptyAlert())
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
              <TableToolbar count={alerts.length} noun="alert" plural="alerts">
                {access.canWrite && (
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
                )}
              </TableToolbar>

              <SettingsTable
                columns={COLUMNS}
                rows={alerts}
                onEdit={openEdit}
                onDelete={setPending}
                canWrite={access.canWrite}
                emptyLabel={
                  !access.canWrite
                    ? 'No alerts to show.'
                    : noCompanies
                      ? 'No BGs on file — add a Business Group before creating alerts.'
                      : 'No alerts yet — use Add Alert to create one.'
                }
              />
            </>
          )}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete alert?"
          body={`${pending.name} will stop watching ${scopeLabel(pending)}.`}
          note={modeNote(
            'The rule is deleted. This cannot be undone.',
            'This is mock data — nothing is sent to a server.'
          )}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
