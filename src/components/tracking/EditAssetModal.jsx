import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VEHICLE_TYPES, saveMaster } from '../../services/vehicleMaster'

// Vehicle edit form. Writes straight through to the device's Flespi metadata
// via saveMaster(), which namespaces everything under metadata.fleet and
// read-modify-writes so unrelated keys survive.

const FIELD_LABEL = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--c-text3)',
  display: 'block', marginBottom: 4,
}

function inputStyle(invalid) {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${invalid ? '#ef4444' : 'var(--c-border)'}`,
    background: 'var(--c-input)',
    color: 'var(--c-text1)',
    fontSize: 12.5,
    outline: 'none',
  }
}

function Field({ label, required, error, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={FIELD_LABEL}>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && (
        <span style={{ fontSize: 10.5, color: '#ef4444', display: 'block', marginTop: 3 }}>
          {error}
        </span>
      )}
    </div>
  )
}

export default function EditAssetModal({ vehicle, onClose, onSaved, onError }) {
  const m = vehicle?.master

  const [form, setForm] = useState(() => ({
    plateNo:       m?.plateNo ?? '',
    fleetNo:       m?.fleetNo ?? '',
    vehicleType:   m?.vehicleType ?? '',
    name:          m?.driver?.name ?? '',
    mobile:        m?.driver?.mobile ?? '',
    nationality:   m?.driver?.nationality ?? '',
    licenseExpiry: m?.driver?.licenseExpiry ?? '',
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const panelRef = useRef(null)
  const firstRef = useRef(null)
  // Focus is handed back to whatever opened the modal, otherwise closing drops
  // the caret at the top of the document.
  const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  useEffect(() => {
    firstRef.current?.focus()
    const el = returnTo.current
    return () => { if (el instanceof HTMLElement) el.focus() }
  }, [])

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return

      const focusables = panelRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])'
      )
      if (!focusables?.length) return
      const first = focusables[0]
      const last  = focusables[focusables.length - 1]

      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!form.plateNo.trim()) next.plateNo = 'Plate No is required'
    if (!form.fleetNo.trim()) next.fleetNo = 'Fleet No is required'
    if (Object.keys(next).length) {
      setErrors(next)
      // Land the caret on the first problem rather than making them hunt.
      panelRef.current?.querySelector(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }

    setSaving(true)
    try {
      const saved = await saveMaster(vehicle.id, {
        plateNo:     form.plateNo.trim(),
        fleetNo:     form.fleetNo.trim(),
        vehicleType: form.vehicleType,
        driver: {
          name:          form.name.trim(),
          mobile:        form.mobile.trim(),
          nationality:   form.nationality.trim(),
          // Flespi stores this as a plain ISO date string; '' would round-trip
          // as a value rather than "not set".
          licenseExpiry: form.licenseExpiry || null,
        },
      })
      onSaved(vehicle.id, saved)
    } catch (err) {
      onError(err.message || 'Could not save vehicle')
      setSaving(false)
    }
  }

  if (!vehicle) return null

  return createPortal(
    <>
      <style>{`
        @keyframes ft-asset-in {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .ft-asset-panel { animation: ft-asset-in 0.2s ease-out both; }
      `}</style>

      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9800,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        }}
      />

      <form
        ref={panelRef}
        className="ft-asset-panel"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ft-asset-title"
        style={{
          position: 'fixed', zIndex: 9801,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(520px, calc(100vw - 28px))',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 15,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 13px',
          borderBottom: '1px solid var(--c-border2)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="ft-asset-title" style={{
              fontSize: 15, fontWeight: 800, color: 'var(--c-text1)', margin: 0,
            }}>
              Edit Asset
            </h2>
            <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>
              {vehicle.name || vehicle.ident || `Device ${vehicle.id}`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 27, height: 27, borderRadius: 7, flexShrink: 0,
              border: '1px solid var(--c-border2)', background: 'var(--c-input)',
              color: 'var(--c-text3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '13px 14px',
          }}>
            <Field label="Plate No" required error={errors.plateNo}>
              <input
                ref={firstRef}
                name="plateNo"
                value={form.plateNo}
                onChange={e => set('plateNo', e.target.value)}
                aria-invalid={!!errors.plateNo}
                placeholder="AD 12345-G1"
                style={inputStyle(errors.plateNo)}
              />
            </Field>

            <Field label="Fleet No" required error={errors.fleetNo}>
              <input
                name="fleetNo"
                value={form.fleetNo}
                onChange={e => set('fleetNo', e.target.value)}
                aria-invalid={!!errors.fleetNo}
                placeholder="FL-01"
                style={inputStyle(errors.fleetNo)}
              />
            </Field>

            <Field label="Vehicle Type">
              <select
                name="vehicleType"
                value={form.vehicleType}
                onChange={e => set('vehicleType', e.target.value)}
                style={inputStyle(false)}
              >
                {VEHICLE_TYPES.map(t => (
                  <option key={t || 'none'} value={t}>
                    {t ? t.charAt(0).toUpperCase() + t.slice(1) : '— Not set —'}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Driver Name">
              <input
                name="name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Unassigned"
                style={inputStyle(false)}
              />
            </Field>

            <Field label="Driver Mobile">
              <input
                name="mobile"
                type="tel"
                value={form.mobile}
                onChange={e => set('mobile', e.target.value)}
                placeholder="+971 50 000 0000"
                style={inputStyle(false)}
              />
            </Field>

            <Field label="Nationality">
              <input
                name="nationality"
                value={form.nationality}
                onChange={e => set('nationality', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>

            <Field label="License Expiry">
              <input
                name="licenseExpiry"
                type="date"
                value={form.licenseExpiry ?? ''}
                onChange={e => set('licenseExpiry', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>
          </div>

          <p style={{
            fontSize: 10.5, color: 'var(--c-text3)', lineHeight: 1.55,
            margin: '15px 0 0',
          }}>
            Saved to this device&rsquo;s Flespi metadata. Plate and Fleet No are also
            what the vehicle search matches on.
          </p>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '13px 20px 16px',
          borderTop: '1px solid var(--c-border2)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px', borderRadius: 9,
              border: '1px solid var(--c-border2)', background: 'var(--c-input)',
              color: 'var(--c-text2)', fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '9px 20px', borderRadius: 9, border: 'none',
              background: 'var(--ft-accent)', color: '#fff',
              fontSize: 12.5, fontWeight: 750,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.65 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </>,
    document.body
  )
}
