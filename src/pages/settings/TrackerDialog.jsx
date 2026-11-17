import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cpu, GitMerge, Unplug, X, Radio, Lightbulb, AlertTriangle } from 'lucide-react'
import { Field } from './FormKit'
import { PRIMARY_BTN, SECONDARY_BTN, inputStyle } from './formStyles'
import { handleApiError } from './pageChrome'
import { get } from '../../data/http'
import {
  useVehicles, changeVehicleTracker, removeVehicleTracker, mergeVehicle, previewVehicleMerge,
  getTrackerStatus, listUnregisteredTrackers, syncVehicleTrackerName,
} from '../../data/settings'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { isOwned } from '../../utils/vehiclePlacement'

/**
 * Tracker changes, made in FleetmaxX and never in the Flespi panel (client,
 * 2026-11-17: "we will add front end and that will link with flespi"). One
 * dialog for a vehicle's tracker, and the "Resolve" of a row whose tracker is
 * no longer in Flespi:
 *
 *   Change tracker   another tracker in the same vehicle record — one already
 *                    in Flespi that no vehicle has, or a new IMEI
 *   Merge            a stale vehicle into the one that has its tracker now;
 *                    this one is archived, its history moves over
 *   No tracker       the vehicle stays, with no tracker
 *
 * Each writes a history row with the note (Reallocation History report, and
 * History in the Vehicle information dialog). Server: lib/trackers.js.
 */

const TABS = [
  { key: 'change', icon: Cpu,      label: 'Change tracker' },
  { key: 'merge',  icon: GitMerge, label: 'Merge into another vehicle' },
  { key: 'remove', icon: Unplug,   label: 'No tracker' },
]

const box = tone => ({
  padding: '10px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-text1)',
  background: tone ? `color-mix(in srgb, ${tone} 9%, transparent)` : 'var(--c-hover)',
  border: `1px solid ${tone ? `color-mix(in srgb, ${tone} 35%, transparent)` : 'var(--c-border2)'}`,
})
const small = { fontSize: 11.5, color: 'var(--c-text3)', lineHeight: 1.45 }
const fmtDay = t => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function StatusLine({ vehicle, status }) {
  if (!vehicle.imei) return <span>No tracker</span>
  const s = status?.state
  return (
    <span>
      Tracker <b style={{ fontFamily: 'ui-monospace, monospace' }}>{vehicle.imei}</b>
      {s === 'ok' && <> · in Flespi as device #{status.device?.deviceId}{status.device?.name ? ` “${status.device.name}”` : ''}</>}
      {s === 'missing' && <span style={{ color: '#d97706', fontWeight: 700 }}> · not in Flespi</span>}
      {!status && ' · checking Flespi…'}
    </span>
  )
}

function useDeviceTypes() {
  const [types, setTypes] = useState([])
  useEffect(() => {
    let alive = true
    get('/api/vehicles/device-types').then(d => { if (alive) setTypes(d?.types ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return types
}

export default function TrackerDialog({ vehicle, initialTab, onClose, push }) {
  const label = vehicleLabel(vehicle)
  const vehicles = useVehicles()
  const types = useDeviceTypes()
  const [status, setStatus] = useState(null)
  const [unregistered, setUnregistered] = useState(null)
  const [tab, setTab] = useState(initialTab || 'change')
  const [source, setSource] = useState('flespi') // 'flespi' | 'new'
  const [pick, setPick] = useState(null)         // an unregistered tracker
  const [imei, setImei] = useState('')
  const [deviceType, setDeviceType] = useState(vehicle.deviceType || '')
  const [targetId, setTargetId] = useState('')
  // Which record stays: 'other' (merge this one into it) or 'this' (it is
  // merged into this one, which takes its tracker: "AD 149 stays").
  const [keep, setKeep] = useState('other')
  const [preview, setPreview] = useState(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  useEffect(() => {
    let alive = true
    getTrackerStatus(vehicle.id).then(s => {
      if (!alive) return
      setStatus(s)
      // What the vehicle's old Flespi device carries now decides the first step.
      if (!initialTab && s?.suggestion?.kind === 'merge' && s.suggestion.target) { setTab('merge'); setTargetId(s.suggestion.target.id) }
    }).catch(() => { if (alive) setStatus({ state: 'unknown' }) })
    listUnregisteredTrackers().then(rows => {
      if (!alive) return
      const list = Array.isArray(rows) ? rows : []
      setUnregistered(list)
      if (!list.length) setSource('new')
    }).catch(() => { if (alive) { setUnregistered([]); setSource('new') } })
    return () => { alive = false }
  }, [vehicle.id, initialTab])

  // A suggested tracker (the one the old device carries now) is picked for the user.
  useEffect(() => {
    const s = status?.suggestion
    if (s?.kind !== 'link' || !unregistered) return
    const hit = unregistered.find(r => r.imei === s.imei)
    if (hit) { setSource('flespi'); setPick(hit) }
  }, [status, unregistered])

  // Merge targets: the other vehicles of its Business Group this account owns.
  const targets = useMemo(() => vehicles
    .filter(v => v.id !== vehicle.id && v.companyId === vehicle.companyId && isOwned(v))
    .sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b))), [vehicles, vehicle.id, vehicle.companyId])
  const target = targets.find(v => v.id === targetId)

  // keep 'this': the other vehicle is the one merged (the source), into this one.
  const mergeIds = keep === 'this' ? [targetId, vehicle.id] : [vehicle.id, targetId]
  useEffect(() => {
    setPreview(null)
    if (!targetId) return
    let alive = true
    const [from, into] = keep === 'this' ? [targetId, vehicle.id] : [vehicle.id, targetId]
    previewVehicleMerge(from, into, { takeTracker: keep === 'this' })
      .then(p => { if (alive) setPreview(p) })
      .catch(err => { if (alive) setPreview({ error: err?.message || 'Could not check the merge' }) })
    return () => { alive = false }
  }, [vehicle.id, targetId, keep])

  const tabs = TABS.map(t => (t.key === 'change' && !vehicle.imei ? { ...t, label: 'Install tracker' } : t))
    .filter(t => t.key !== 'remove' || vehicle.imei)

  const inFlespi = status?.state === 'ok'
  const flespiText = source === 'flespi'
    ? pick
      ? `FleetmaxX links ${label} to Flespi device #${pick.deviceId} and names it “${vehicle.vehicleNumber || label}”.${vehicle.imei ? ' The old tracker’s Flespi device is not changed; its messages stay in Flespi.' : ''}`
      : 'Choose the tracker that is now in the vehicle.'
    : inFlespi
      ? `The vehicle’s Flespi device #${status.device?.deviceId} takes the new IMEI and device type, so its message history carries on in one device. Nothing is deleted.`
      : 'FleetmaxX creates a Flespi device for the new tracker (the Flespi plan needs a free device slot).'

  const submit = async () => {
    const errs = {}
    if (tab === 'change') {
      if (source === 'flespi' && !pick) errs.pick = 'Choose a tracker'
      if (source === 'new') {
        const v = imei.replace(/\D/g, '')
        if (!v) errs.imei = 'Type the new tracker’s IMEI'
        else if (!/^\d{10,20}$/.test(v)) errs.imei = 'IMEI must be 10-20 digits'
        else if (v === vehicle.imei) errs.imei = 'This is already the vehicle’s tracker'
      }
    }
    if (tab === 'merge' && !targetId) errs.targetId = 'Choose the vehicle that has the tracker now'
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      if (tab === 'change') {
        const body = source === 'flespi'
          ? { imei: pick.imei, deviceType: pick.deviceType || null, note }
          : { imei: imei.replace(/\D/g, ''), deviceType: deviceType.trim(), note }
        await changeVehicleTracker(vehicle.id, body)
        push?.(`${label}: tracker ${body.imei} installed`, { tone: 'success' })
      } else if (tab === 'merge') {
        await mergeVehicle(mergeIds[0], mergeIds[1], note, { takeTracker: keep === 'this' })
        push?.(keep === 'this'
          ? `${vehicleLabel(target)} merged into ${label}, which has its tracker now`
          : `${label} merged into ${vehicleLabel(target)} and archived`, { tone: 'success' })
      } else {
        await removeVehicleTracker(vehicle.id, note)
        push?.(`${label} has no tracker now`, { tone: 'success' })
      }
      onClose()
    } catch (err) {
      handleApiError(err, { push, setErrors })
      setSaving(false)
    }
  }

  const syncName = async () => {
    setSaving(true)
    try {
      await syncVehicleTrackerName(vehicle.id)
      push?.(`Flespi device renamed to ${label}`, { tone: 'success' })
      onClose()
    } catch (err) {
      handleApiError(err, { push })
      setSaving(false)
    }
  }

  const plan = preview?.plan
  const suggestion = status?.suggestion
  const actionLabel = tab === 'change'
    ? (vehicle.imei ? 'Change tracker' : 'Install tracker')
    : tab === 'merge' ? (!target ? 'Merge' : keep === 'this' ? `Merge ${vehicleLabel(target)} into ${label}` : `Merge into ${vehicleLabel(target)}`) : 'Save as no tracker'

  return createPortal(
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog" aria-modal="true" aria-label={`Tracker of ${label}`}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(620px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', borderRadius: 16, background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', padding: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)' }}>
            <Cpu size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)' }}>Tracker of “{label}”</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 3 }}><StatusLine vehicle={vehicle} status={status} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" disabled={saving}
            style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--c-border2)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>

        {suggestion && (
          <div style={{ ...box('#0ea5e9'), display: 'flex', gap: 8, marginBottom: 12 }}>
            <Lightbulb size={15} style={{ flexShrink: 0, marginTop: 2, color: '#0284c7' }} />
            <span>
              Its Flespi device #{suggestion.deviceId} now carries tracker <b>{suggestion.imei}</b>
              {suggestion.kind === 'merge'
                ? suggestion.target ? <>, registered as <b>{suggestion.target.label}</b>. If that is the same vehicle, merge into it.</> : ', registered to a vehicle in another account.'
                : <>{suggestion.name ? ` (“${suggestion.name}”)` : ''}, which no vehicle has. If it was fitted to this vehicle, change the tracker to it.</>}
            </span>
          </div>
        )}
        {status?.state === 'ok' && status.device?.name && status.device.name !== (vehicle.vehicleNumber || label) && (
          <div style={{ ...box(), display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <Radio size={15} style={{ flexShrink: 0, color: 'var(--c-text3)' }} />
            <span style={{ flex: 1 }}>In Flespi this tracker is named “{status.device.name}”.</span>
            <button type="button" style={{ ...SECONDARY_BTN, padding: '5px 10px', fontSize: 12 }} onClick={syncName} disabled={saving}>Rename in Flespi to {vehicle.vehicleNumber || label}</button>
          </div>
        )}

        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {tabs.map(t => {
            const on = tab === t.key
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.key); setErrors({}) }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                  background: on ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'transparent',
                  color: on ? 'var(--ft-accent)' : 'var(--c-text2)',
                }}>
                <t.icon size={14} />{t.label}
              </button>
            )
          })}
        </div>

        {tab === 'change' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="tsource" checked={source === 'flespi'} onChange={() => setSource('flespi')} />
                A tracker already in Flespi{unregistered ? ` (${unregistered.length})` : ''}
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="tsource" checked={source === 'new'} onChange={() => setSource('new')} />
                A new tracker (type its IMEI)
              </label>
            </div>

            {source === 'flespi' ? (
              <div>
                {unregistered === null ? <div style={small}>Reading Flespi…</div>
                  : !unregistered.length ? <div style={small}>Every tracker in Flespi is already in a vehicle (or this account cannot list them). Type the new IMEI instead.</div>
                    : (
                      <div role="radiogroup" aria-label="Trackers in Flespi with no vehicle" style={{ display: 'grid', gap: 6, maxHeight: 210, overflowY: 'auto' }}>
                        {unregistered.map(r => {
                          const on = pick?.deviceId === r.deviceId
                          return (
                            <label key={r.deviceId} style={{
                              display: 'grid', gridTemplateColumns: 'auto minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr)', gap: 10, alignItems: 'center',
                              padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 12,
                              border: `1px solid ${on ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
                              background: on ? 'color-mix(in srgb, var(--ft-accent) 8%, transparent)' : 'transparent',
                            }}>
                              <input type="radio" name="tpick" checked={on} onChange={() => { setPick(r); setErrors({}) }} />
                              <span style={{ fontWeight: 700, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.name || '—'}
                                {r.lastVehicle && <span style={{ display: 'block', fontWeight: 500, ...small }}>was in {r.lastVehicle.label}{r.lastVehicle.at ? ` until ${fmtDay(r.lastVehicle.at)}` : ''}</span>}
                              </span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--c-text2)' }}>{r.imei}</span>
                              <span style={{ color: 'var(--c-text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.deviceType || '—'}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                {errors.pick && <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 4 }}>{errors.pick}</div>}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="New IMEI" required error={errors.imei}>
                  <input name="imei" inputMode="numeric" value={imei} onChange={e => { setImei(e.target.value); setErrors({}) }} placeholder="869166081174012" style={inputStyle(!!errors.imei)} />
                </Field>
                <Field label="Device Type" error={errors.deviceType} hint="Needed when the tracker is not in Flespi yet.">
                  <input name="deviceType" list="tracker-device-types" value={deviceType} onChange={e => { setDeviceType(e.target.value); setErrors({}) }} placeholder="Teltonika FMC130" style={inputStyle(!!errors.deviceType)} />
                  <datalist id="tracker-device-types">{types.map(t => <option key={t.id} value={t.title} />)}</datalist>
                </Field>
              </div>
            )}
            <div style={box()}>
              {flespiText}
              <div style={{ ...small, marginTop: 4 }}>The vehicle keeps its number, history, drivers, documents and reports. Set its odometer again once the new tracker reports.</div>
            </div>
          </div>
        )}

        {tab === 'merge' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="The same vehicle as" required error={errors.targetId} hint="The vehicle that has this vehicle’s tracker now, in the same Business Group.">
              <select value={targetId} onChange={e => { setTargetId(e.target.value); setKeep('other'); setErrors({}) }} style={inputStyle(!!errors.targetId)} disabled={saving}>
                <option value="">— Select —</option>
                {targets.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}{v.imei ? ` · ${v.imei}` : ' · no tracker'}</option>)}
              </select>
            </Field>
            {target && (
              <div role="radiogroup" aria-label="Which record stays" style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input type="radio" name="tkeep" checked={keep === 'other'} onChange={() => setKeep('other')} style={{ marginTop: 3 }} />
                  <span><b>Keep {vehicleLabel(target)}</b> — {label} is merged into it and archived.</span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: target.imei ? 'pointer' : 'not-allowed', opacity: target.imei ? 1 : 0.55 }}>
                  <input type="radio" name="tkeep" checked={keep === 'this'} disabled={!target.imei} onChange={() => setKeep('this')} style={{ marginTop: 3 }} />
                  <span><b>Keep {label}</b> — {vehicleLabel(target)} is merged into it and archived, and its tracker {target.imei || ''} goes into {label}{target.imei ? ' (its Flespi device, if it has one, takes the name)' : ''}.</span>
                </label>
              </div>
            )}
            {preview?.error && <div style={{ ...box('#ef4444'), display: 'flex', gap: 8 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2, color: '#ef4444' }} />{preview.error}</div>}
            {targetId && !preview && <div style={small}>Checking what moves…</div>}
            {plan && (
              <div style={box()}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>From {preview.source.label} to {preview.target.label}: {plan.summary.replace(/^Moved: /, '')}</div>
                {plan.driver && (
                  <div>
                    Driver {plan.driver.name}: {plan.driver.outcome === 'moved'
                      ? `drives ${preview.target.label} from now on`
                      : `unassigned (${preview.target.label} keeps its driver ${plan.driver.targetDriver}); past trips keep ${plan.driver.name}`}
                  </div>
                )}
                {plan.trackerMoved && <div>Tracker {plan.trackerMoved} goes into {preview.target.label}.</div>}
                {plan.trackerRemoved && <div>Tracker {plan.trackerRemoved} comes out of {plan.trackerMoved ? preview.target.label : preview.source.label}.</div>}
                <div style={{ ...small, marginTop: 6 }}>
                  {preview.source.label} is then archived: it leaves the vehicle list but is never deleted, and its history stays searchable in the Reallocation History report.
                  {plan.trackerMoved ? ` In Flespi, only the tracker’s device name changes to ${preview.target.label}.` : ' Nothing is changed in Flespi.'}
                </div>
              </div>
            )}
            {!targets.length && <div style={small}>There is no other vehicle in this Business Group to merge into.</div>}
          </div>
        )}

        {tab === 'remove' && (
          <div style={box()}>
            {label} stays in the register with its history, drivers, documents and reports, with no tracker. Use it when the tracker is gone and none replaces it.
            <div style={{ ...small, marginTop: 4 }}>
              Nothing is changed in Flespi{inFlespi ? `: device #${status.device?.deviceId} keeps tracker ${vehicle.imei} and its messages, and shows as a tracker with no vehicle` : ''}.
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <Field label="Note" hint="Kept with the change in the history. Optional.">
            <input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder={tab === 'merge' ? 'Same vehicle, tracker replaced in Flespi' : 'Tracker faulty, replaced'} style={inputStyle(false)} />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" style={SECONDARY_BTN} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" style={{ ...PRIMARY_BTN, opacity: saving ? 0.65 : 1, ...(tab === 'merge' ? { background: '#b45309', borderColor: '#b45309' } : {}) }} onClick={submit} disabled={saving || (tab === 'merge' && (!plan || preview?.error))}>
            {saving ? 'Saving…' : actionLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
