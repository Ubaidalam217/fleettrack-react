import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VEHICLE_TYPES, saveMaster } from '../../services/vehicleMaster'
import { useVehicleUsage, fmtOdometer } from '../../hooks/useVehicleUsage'
import {
  emptyVehicle, addVehicle, updateVehicle,
  settingsProfileForImei, vehicleByImei, imeiKey,
  useCompanies, useBranches, useResellers,
  branchTreeForCompany, branchOptionLabel,
  groupIdForCompany, groupNameFor, resellerNameFor,
} from '../../pages/settings/mockData'

// The vehicle Console — opened from the pencil button on the Live Map's
// vehicle detail panel. One dialog for everything about one asset that a user
// is allowed to change, across both of the places a FleetmaX vehicle lives:
//
//   Vehicle block → the Flespi device's own metadata (saveMaster, a REST PUT)
//   Org block     → the Settings > Object > Vehicle record (the mock store)
//
// The two are joined by IMEI and nothing else, so a device with no Settings
// record yet gets a create-and-link form instead of a disabled one — that is
// the only way the link can ever come into existence from this screen.
//
// Plate No and Fleet No are single fields written to both sides. They used to
// be two pairs (plateNo/fleetNo on the device, vehicleNumber/vehicleId in
// Settings), which is four inputs for two facts and two ways to disagree.
//
// Group and GGB are shown but never chosen: a BG already carries both, so
// picking them again here is an invitation to contradict the BG.

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

const READONLY_INPUT = {
  background: 'var(--c-thead)',
  color: 'var(--c-text3)',
  cursor: 'not-allowed',
}

const GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '13px 14px',
}

function Field({ label, required, error, hint, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={FIELD_LABEL}>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error ? (
        <span style={{ fontSize: 10.5, color: '#ef4444', display: 'block', marginTop: 3 }}>
          {error}
        </span>
      ) : hint ? (
        <span style={{ fontSize: 10.5, color: 'var(--c-text3)', display: 'block', marginTop: 3 }}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/**
 * A value the user cannot change, in the same box as the ones they can.
 *
 * A real <input readOnly> rather than plain text so it keeps its place in the
 * grid: these sit between editable fields, and a bare line of text next to a
 * bordered control reads as a rendering bug rather than as "locked".
 */
function ReadOnlyField({ label, name, value, hint }) {
  return (
    <Field label={label} hint={hint}>
      <input
        name={name}
        value={value ?? '—'}
        readOnly
        tabIndex={-1}
        aria-readonly="true"
        style={{ ...inputStyle(false), ...READONLY_INPUT }}
      />
    </Field>
  )
}

function Block({ title, note, children }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
        marginBottom: 11, paddingBottom: 6, borderBottom: '1px solid var(--c-border)',
      }}>
        <h3 style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>
          {title}
        </h3>
        {note && (
          <span style={{ fontSize: 10.5, color: 'var(--c-text3)' }}>{note}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function LockNote({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em',
      color: 'var(--c-text3)', marginTop: 12,
    }}>
      <LockIcon />
      {children}
    </div>
  )
}

/** Settings-side draft seeded from the device, for the create-and-link case. */
function draftFromDevice(vehicle) {
  return {
    ...emptyVehicle(),
    // The IMEI is the link itself and is never typed here — it comes from the
    // device, which is the only side that can be authoritative about it.
    imei: vehicle?.ident || '',
  }
}

export default function VehicleConsole({ vehicle, onClose, onSaved, onError }) {
  const m = vehicle?.master

  // Subscriptions: the dropdowns and the derived Group/GGB have to reflect a BG,
  // branch or GGB added or renamed on the Settings pages in this same session.
  const companies   = useCompanies()
  const allBranches = useBranches()
  useResellers()

  // Resolved once, at open. A profile that changed underneath an open dialog
  // would swap the form's identity mid-edit, which is worse than being a few
  // seconds stale on a modal the user is actively typing into.
  const [profile] = useState(() => settingsProfileForImei(vehicle?.ident))

  // Read-only, and free: the detail panel behind this dialog has already
  // fetched the same device's messages, and that fetch is cached per device.
  const { loading: odoLoading, usage } = useVehicleUsage(vehicle?.id)

  // Plate No and Fleet No live here and are saved to both sides. On a linked
  // vehicle the Settings record wins the seed — it is the register, and the
  // device's copy is the one that drifts — falling back to the device whenever
  // Settings has nothing to offer.
  const [form, setForm] = useState(() => ({
    plateNo:     (profile.linked && profile.plateNo) || m?.plateNo || '',
    fleetNo:     (profile.linked && profile.fleetNo) || m?.fleetNo || '',
    vehicleType: m?.vehicleType ?? '',
  }))

  // The Settings half. An unmatched device opens straight into the create-and-
  // link form rather than behind a prompt: the Console button is the one edit
  // entry point now, and a dialog that opens onto another button to get at the
  // fields is the same redundancy one layer deeper.
  const [sform, setSform] = useState(() => (
    profile.linked ? { ...emptyVehicle(), ...profile.vehicle } : draftFromDevice(vehicle)
  ))

  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const panelRef = useRef(null)
  const firstRef = useRef(null)
  // Focus is handed back to whatever opened the dialog, otherwise closing drops
  // the caret at the top of the document.
  const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null)

  // Whether the Settings block is an editable form at all.
  //
  // The one case it is not: a device reporting no IMEI has nothing to join on,
  // so there is no record to create. It gets a line saying so instead of a
  // form it could fill in and never save — the device-side fields above stay
  // editable either way.
  const linkable = !!imeiKey(vehicle?.ident)
  const settingsActive = profile.linked || linkable

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => (e[key] ? { ...e, [key]: null } : e))
  }

  const setS = (key, value) => {
    setSform(d => {
      const next = { ...d, [key]: value }
      if (key === 'companyId') {
        // A branch belongs to exactly one BG, so the old pick is not a valid
        // option under the new one. The group comes with the BG.
        next.branchId = ''
        next.groupId  = groupIdForCompany(value)
      }
      return next
    })
    setErrors(e => (e[`s_${key}`] ? { ...e, [`s_${key}`]: null } : e))
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
        'button:not([disabled]), input:not([disabled]):not([readonly]), select:not([disabled])'
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

  // The branch list reads the store directly; `allBranches` is in the deps so a
  // branch added elsewhere this session shows up without reopening the dialog.
  const branches = useMemo(
    () => (settingsActive && sform.companyId ? branchTreeForCompany(sform.companyId) : []),
    [settingsActive, sform.companyId, allBranches]
  )

  // Group and GGB are read off the chosen BG rather than asked for. The
  // vehicle's own groupId wins when it has one — a BG that acts as its own
  // group leaves its vehicles free to sit under a GGB-level group instead.
  const bg      = companies.find(c => c.id === sform.companyId) ?? null
  const groupId = sform.groupId || bg?.groupId || ''
  const groupDisplay = !bg ? '' : groupId ? groupNameFor(groupId) : 'BG is its own group'
  const ggbDisplay   = bg ? resellerNameFor(bg.resellerId) : ''

  const submit = async e => {
    e.preventDefault()
    if (saving) return

    const next = {}
    if (!form.plateNo.trim()) next.plateNo = 'Plate No is required'

    if (settingsActive) {
      // Required on both paths: on an unmatched device it is what makes the
      // link valid, and a linked row cannot be left without its BG either.
      if (!sform.companyId) next.s_companyId = 'BG is required'
      // Only reachable while creating — a matched profile is by definition the
      // row that owns this IMEI. Catches the record being registered in another
      // tab while this dialog sat open.
      if (!profile.linked && vehicleByImei(vehicle.ident)) {
        next.s_companyId = 'This IMEI was registered in Settings a moment ago — close and reopen the Console.'
      }
    }

    if (Object.keys(next).length) {
      setErrors(next)
      const key = Object.keys(next)[0]
      // Land the caret on the first problem rather than making them hunt.
      panelRef.current?.querySelector(`[name="${key.replace(/^s_/, 's-')}"]`)?.focus()
      return
    }

    setSaving(true)

    // Flespi first: it is the write that can fail. Doing it last would leave
    // the Settings record saved and the dialog reporting an error, with no way
    // for the user to tell which half landed.
    //
    // No `driver` key in the patch — the Console no longer edits driver
    // details, and saveMaster merges rather than replaces, so whatever is
    // already stored for this device survives untouched.
    let savedMaster
    try {
      savedMaster = await saveMaster(vehicle.id, {
        plateNo:     form.plateNo.trim(),
        fleetNo:     form.fleetNo.trim(),
        vehicleType: form.vehicleType,
      })
    } catch (err) {
      onError(err.message || 'Could not save vehicle')
      setSaving(false)
      return
    }

    let settingsNote = null
    if (settingsActive) {
      const clean = {
        ...emptyVehicle(),
        // Spread of the whole row, so fields this dialog does not show — the
        // Settings-side odometer among them — are carried over rather than
        // reset to the blank record's defaults.
        ...sform,
        // The IMEI is the join key and is owned by the device, not the form.
        imei:          vehicle.ident || '',
        // The single Plate No / Fleet No, landing on their Settings names.
        vehicleNumber: form.plateNo.trim(),
        vehicleId:     form.fleetNo.trim(),
        subGroup:      String(sform.subGroup ?? '').trim(),
        make:          String(sform.make ?? '').trim(),
        model:         String(sform.model ?? '').trim(),
        deviceType:    String(sform.deviceType ?? '').trim(),
        mobileNo:      String(sform.mobileNo ?? '').trim(),
      }
      if (profile.linked) {
        updateVehicle(profile.vehicle.id, clean)
      } else {
        addVehicle(clean)
        settingsNote = 'linked to a new Settings vehicle'
      }
    }

    onSaved(vehicle.id, savedMaster, settingsNote)
  }

  if (!vehicle) return null

  return createPortal(
    <>
      <style>{`
        @keyframes ft-console-in {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        .ft-console-panel { animation: ft-console-in 0.2s ease-out both; }
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
        className="ft-console-panel"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ft-console-title"
        style={{
          position: 'fixed', zIndex: 9801,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(760px, calc(100vw - 28px))',
          maxHeight: 'calc(100vh - 40px)',
          // Header and footer are pinned and only the field area scrolls, so
          // Save stays reachable at any dialog height.
          display: 'flex', flexDirection: 'column',
          background: 'var(--c-card)',
          border: '1px solid var(--c-border)',
          borderRadius: 15,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexShrink: 0,
          padding: '16px 20px 13px',
          borderBottom: '1px solid var(--c-border2)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="ft-console-title" style={{
              fontSize: 15, fontWeight: 800, color: 'var(--c-text1)', margin: 0,
            }}>
              Console
            </h2>
            <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>
              {vehicle.name || vehicle.ident || `Device ${vehicle.id}`}
              {vehicle.ident && ` · IMEI ${vehicle.ident}`}
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

        <div style={{ padding: '16px 20px 4px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>

          {/* ── Vehicle ── */}
          <Block title="Vehicle" note="On the device, and on its Settings record">
            <div style={GRID}>
              <Field
                label="Plate No"
                required
                error={errors.plateNo}
                hint="Saved to the device and the Settings record"
              >
                <input
                  ref={firstRef}
                  name="plateNo"
                  value={form.plateNo}
                  onChange={e => set('plateNo', e.target.value)}
                  aria-invalid={!!errors.plateNo || undefined}
                  placeholder="AD 12345-G1"
                  style={inputStyle(errors.plateNo)}
                />
              </Field>

              <Field label="Fleet No">
                <input
                  name="fleetNo"
                  value={form.fleetNo}
                  onChange={e => set('fleetNo', e.target.value)}
                  placeholder="FL-01"
                  style={inputStyle(false)}
                />
              </Field>

              <Field label="Vehicle Type" hint="Drives the map marker artwork">
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

              <ReadOnlyField
                label="IMEI"
                name="imei"
                value={vehicle.ident || '—'}
                hint="The link to this device"
              />

              <ReadOnlyField
                label="ODO Reading"
                name="odoReading"
                value={odoLoading ? '…' : (fmtOdometer(usage?.odometerKm) ?? '—')}
                hint="Live from the tracker"
              />
            </div>

            <LockNote>IMEI AND ODO READING ARE REPORTED BY THE DEVICE — READ-ONLY</LockNote>
          </Block>

          {/* ── Settings record ── */}
          <Block
            title="Organisation & Registration"
            note={profile.linked
              ? 'Settings > Object > Vehicle · matched by IMEI'
              : 'Settings > Object > Vehicle · no record for this IMEI'}
          >
            {!settingsActive ? (
              <div style={{
                padding: '13px 14px', borderRadius: 9,
                fontSize: 12, color: 'var(--c-text2)', lineHeight: 1.65,
                border: '1px dashed var(--c-border2)', background: 'var(--c-hover)',
              }}>
                This device reports no IMEI, so there is nothing to join a Settings
                vehicle to and no BG, Group or Sub Group can be assigned. The
                vehicle fields above still save to the device.
              </div>
            ) : (
              <>
                {!profile.linked && (
                  <div style={{
                    marginBottom: 13, padding: '9px 11px', borderRadius: 8,
                    fontSize: 11.5, lineHeight: 1.6, color: 'var(--c-text2)',
                    border: '1px solid var(--c-border2)',
                    background: 'color-mix(in srgb, var(--ft-accent) 8%, transparent)',
                  }}>
                    A new Settings vehicle will be created for IMEI{' '}
                    <strong style={{ color: 'var(--c-text1)' }}>{vehicle.ident}</strong>{' '}
                    when you save. It appears under Settings &gt; Object &gt; Vehicle
                    and becomes assignable to sub-users and alerts.
                  </div>
                )}

                <div style={GRID}>
                  <Field label="BG (Business Group)" required error={errors.s_companyId}>
                    <select
                      name="s-companyId"
                      value={sform.companyId}
                      onChange={e => setS('companyId', e.target.value)}
                      aria-invalid={!!errors.s_companyId || undefined}
                      style={inputStyle(!!errors.s_companyId)}
                    >
                      <option value="">— Select —</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>

                  <ReadOnlyField
                    label="Group"
                    name="s-group"
                    value={groupDisplay || '— Select a BG first —'}
                    hint="From the selected BG"
                  />

                  <ReadOnlyField
                    label="GGB"
                    name="s-ggb"
                    value={ggbDisplay || '— Select a BG first —'}
                    hint="From the selected BG"
                  />

                  <Field label="Branch">
                    <select
                      name="s-branchId"
                      value={sform.branchId}
                      onChange={e => setS('branchId', e.target.value)}
                      disabled={!sform.companyId || branches.length === 0}
                      style={{
                        ...inputStyle(false),
                        opacity: !sform.companyId || branches.length === 0 ? 0.6 : 1,
                      }}
                    >
                      <option value="">
                        {!sform.companyId
                          ? '— Select a BG first —'
                          : branches.length === 0
                            ? '— No branches for this BG —'
                            : '— None —'}
                      </option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{branchOptionLabel(b)}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Sub Group">
                    <input
                      name="s-subGroup"
                      value={sform.subGroup}
                      onChange={e => setS('subGroup', e.target.value)}
                      placeholder="Heavy"
                      style={inputStyle(false)}
                    />
                  </Field>

                  <Field label="Make">
                    <input
                      name="s-make"
                      value={sform.make}
                      onChange={e => setS('make', e.target.value)}
                      placeholder="Volvo"
                      style={inputStyle(false)}
                    />
                  </Field>

                  <Field label="Model">
                    <input
                      name="s-model"
                      value={sform.model}
                      onChange={e => setS('model', e.target.value)}
                      placeholder="FH16"
                      style={inputStyle(false)}
                    />
                  </Field>

                  <Field label="Device Type">
                    <input
                      name="s-deviceType"
                      value={sform.deviceType}
                      onChange={e => setS('deviceType', e.target.value)}
                      placeholder="Teltonika FMB920"
                      style={inputStyle(false)}
                    />
                  </Field>

                  <Field label="Mobile No" hint="SIM in the tracking unit">
                    <input
                      name="s-mobileNo"
                      type="tel"
                      value={sform.mobileNo}
                      onChange={e => setS('mobileNo', e.target.value)}
                      placeholder="+971 50 000 0000"
                      style={inputStyle(false)}
                    />
                  </Field>
                </div>

                <LockNote>GROUP AND GGB COME WITH THE BG — READ-ONLY</LockNote>
              </>
            )}
          </Block>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
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
