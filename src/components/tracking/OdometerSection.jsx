import { useCallback, useEffect, useState } from 'react'
import { Gauge, Cpu, SlidersHorizontal, PenLine, History, AlertTriangle } from 'lucide-react'
import { getVehicleOdometer, setVehicleOdometer } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { fmtKm, checkReading } from '../../utils/odometer'

/**
 * The vehicle's odometer in "Vehicle information" (client, 2026-11-13): what
 * the vehicle shows now, the tracker's own reading, the correction between the
 * two, and the manual reading that set it — when, by whom, and what the tracker
 * read at that moment — with "Update odometer" and the last adjustments.
 *
 * Like Geotab and Wialon the typed reading is "the odometer now" and the
 * tracker keeps counting from it; like Fleetio a lower or a much higher reading
 * than the current total has to be confirmed. Every update, from here, the
 * Vehicle form or Bulk Action, goes through PUT /api/vehicles/:id/odometer,
 * which keeps the history. Nothing is written to the tracker.
 * Uses the dialog's vi-* styles.
 */

const CSS = `
.vo-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.vo-big{font-size:15px;font-weight:800}
.vo-sub{font-size:11px;color:var(--c-text3);margin-top:4px;line-height:1.45}
.vo-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.vo-form{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr) auto;gap:10px;align-items:start;margin-top:12px;padding:14px;
  border-radius:12px;border:1px solid var(--c-border2);background:color-mix(in srgb,var(--c-input) 55%,var(--c-card))}
.vo-form .vi-label{margin-bottom:6px}
.vo-warn{grid-column:1/-1;display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.5;padding:9px 11px;border-radius:10px;
  background:color-mix(in srgb,#f59e0b 10%,transparent);border:1px solid color-mix(in srgb,#f59e0b 35%,transparent)}
.vo-hist{margin-top:12px;border:1px solid var(--c-border);border-radius:12px;overflow:auto}
.vo-hist table{width:100%;border-collapse:collapse;font-size:12px}
.vo-hist th{text-align:left;padding:8px 10px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text3);background:var(--c-input);white-space:nowrap}
.vo-hist td{padding:8px 10px;border-top:1px solid var(--c-border);vertical-align:top}
@media (max-width:640px){
  .vo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .vo-form{grid-template-columns:minmax(0,1fr)}
  .vo-hist .vo-hide{display:none}
}
`

const fmtWhen = t => {
  if (t == null || t === '') return ''
  const d = typeof t === 'number' ? new Date(t < 1e12 ? t * 1000 : t) : new Date(t)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const fmtSigned = km => (km == null ? null : `${km >= 0 ? '+' : '−'}${fmtKm(Math.abs(km))}`)

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="vi-tile">
      <div className="vi-label"><Icon size={12} />{label}</div>
      <div className="vi-tileval"><span className="vo-big vo-num">{value ?? '—'}</span></div>
      {sub && <div className="vo-sub">{sub}</div>}
    </div>
  )
}

export default function OdometerSection({ vehicleId, canEdit, onSaved }) {
  const [odo, setOdo] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [open, setOpen] = useState(false)
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(null) // the reading whose warning was accepted
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const load = useCallback(() => {
    if (!IS_REAL || !vehicleId) return
    getVehicleOdometer(vehicleId)
      .then(d => { setOdo(d); setLoadError(null) })
      .catch(err => setLoadError(err?.message || 'Could not load the odometer'))
  }, [vehicleId])
  useEffect(load, [load])

  if (!IS_REAL) {
    return (
      <>
        <div className="vi-sechead"><div className="vi-sectitle"><Gauge size={15} />Odometer</div></div>
        <div className="vo-sub">The demo has no tracker readings, so the odometer needs the server.</div>
      </>
    )
  }

  const current = odo?.vehicleKm ?? null
  const last = odo?.adjustments?.[0] ?? null
  const check = checkReading(reading, current)
  const needsConfirm = !!check.warning && confirmed !== reading
  const canUpdate = canEdit && odo?.deviceKm != null

  const manualSub = last
    ? <>{fmtWhen(last.setAt)}{last.setBy ? ` · ${last.setBy}` : ''}<br />Device then {fmtKm(last.deviceKm)}</>
    : odo?.setAt
      ? <>{fmtWhen(odo.setAt)}{odo.setBy ? ` · ${odo.setBy}` : ''}<br />Set before the history was kept</>
      : 'Not set — the device reading is used'

  const startUpdate = () => {
    setReading(current != null ? String(Math.round(current * 10) / 10) : '')
    setNote('')
    setConfirmed(null)
    setSaveError(null)
    setOpen(true)
  }

  const save = async () => {
    if (check.error || saving) return
    if (needsConfirm) { setConfirmed(reading); return }
    setSaving(true)
    setSaveError(null)
    try {
      await setVehicleOdometer(vehicleId, check.value, { note: note.trim() || undefined })
      setOpen(false)
      load()
      onSaved?.(`Odometer set to ${fmtKm(check.value)}`)
    } catch (err) {
      setSaveError(err?.details?.reading || err?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="vi-sechead">
        <div className="vi-sectitle"><Gauge size={15} />Odometer</div>
        {canUpdate && !open && (
          <button type="button" className="vi-btn" onClick={startUpdate}><PenLine size={14} />Update odometer</button>
        )}
      </div>

      {loadError ? (
        <div className="vo-sub" style={{ color: '#ef4444' }}>{loadError}</div>
      ) : (
        <div className="vo-grid">
          <Tile icon={Gauge} label="Current total" value={odo ? fmtKm(current) : '…'} sub="Device reading + correction" />
          <Tile icon={Cpu} label="Device reading now" value={odo ? fmtKm(odo.deviceKm) : '…'}
            sub={odo?.deviceKm == null ? (odo ? 'The tracker has not sent one yet' : null) : odo.ts ? `As of ${fmtWhen(odo.ts)}` : null} />
          <Tile icon={SlidersHorizontal} label="Correction" value={odo ? (fmtSigned(odo.offsetKm) ?? 'None') : '…'} sub="Added to every device reading" />
          <Tile icon={PenLine} label="Manual reading" value={odo ? (last ? fmtKm(last.readingKm) : '—') : '…'} sub={odo ? manualSub : null} />
        </div>
      )}

      {open && (
        <div className="vo-form">
          <div>
            <div className="vi-label">Odometer now (km)</div>
            <input
              className={`vi-input${check.error && reading !== '' ? ' err' : ''}`}
              inputMode="decimal"
              autoFocus
              value={reading}
              onChange={e => { setReading(e.target.value); setSaveError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              aria-label="Odometer now in km"
            />
            {check.error && reading !== '' && <div className="vi-errtxt">{check.error}</div>}
          </div>
          <div>
            <div className="vi-label">Note (optional)</div>
            <input className="vi-input" value={note} maxLength={200} placeholder="e.g. Dashboard photo at service"
              onChange={e => setNote(e.target.value)} aria-label="Note" />
          </div>
          <div style={{ display: 'flex', gap: 8, paddingTop: 19 }}>
            <button type="button" className="vi-btn" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="vi-btn primary" onClick={save} disabled={saving || !!check.error}>
              {saving ? 'Saving…' : check.warning && confirmed === reading ? 'Save anyway' : 'Save'}
            </button>
          </div>
          {check.warning && (
            <div className="vo-warn">
              <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
              <span>{check.warning}{confirmed !== reading && ' Press Save again to confirm.'}</span>
            </div>
          )}
          {saveError && <div className="vi-errtxt" style={{ gridColumn: '1/-1' }}>{saveError}</div>}
          <div className="vo-sub" style={{ gridColumn: '1/-1', marginTop: 0 }}>
            The tracker is not changed: FleetmaxX keeps the difference and keeps counting from this reading.
          </div>
        </div>
      )}

      {odo?.adjustments?.length > 0 && (
        <>
        <div className="vi-label" style={{ marginTop: 14 }}><History size={12} />Adjustment history</div>
        <div className="vo-hist" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Updated</th>
                <th>By</th>
                <th>Reading</th>
                <th className="vo-hide">Device then</th>
                <th className="vo-hide">Correction</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {odo.adjustments.slice(0, 5).map(a => (
                <tr key={a.id}>
                  <td className="vo-num">{fmtWhen(a.setAt)}</td>
                  <td>{a.setBy || '—'}</td>
                  <td className="vo-num">{fmtKm(a.readingKm)}</td>
                  <td className="vo-num vo-hide">{fmtKm(a.deviceKm)}</td>
                  <td className="vo-num vo-hide">{fmtSigned(a.offsetKm)}</td>
                  <td style={{ color: a.note ? undefined : 'var(--c-text3)' }}>{a.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  )
}
