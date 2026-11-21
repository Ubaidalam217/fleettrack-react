import { useCallback, useEffect, useState } from 'react'
import { BellOff } from 'lucide-react'
import { getVehicleMutedAlerts, setVehicleMutedAlerts } from '../../data/settings'
import { IS_REAL } from '../../data/mode'

/**
 * "Alerts" in Vehicle information (client, 2026-11-21): any event can be
 * switched off for one vehicle so it no longer reaches the front end — a fuel
 * tanker or a resting driver takes the battery off, and that is no tamper.
 * The server (alert engine) raises none of a muted type for the vehicle.
 * Uses the dialog's vi-* styles.
 */

const CSS = `
.vm-note{font-size:11.5px;color:var(--c-text3);line-height:1.5;margin:2px 0 10px}
.vm-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}
.vm-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:10px;border:1px solid var(--c-border);font-size:12.5px;cursor:pointer;min-height:36px}
.vm-row[data-off='true']{border-color:color-mix(in srgb,#f59e0b 45%,transparent);background:color-mix(in srgb,#f59e0b 9%,transparent)}
.vm-row input{width:16px;height:16px;accent-color:#d97706;flex-shrink:0}
.vm-row small{margin-left:auto;font-size:10.5px;font-weight:700;color:#b45309;letter-spacing:.04em;text-transform:uppercase}
.vm-foot{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
@media (max-width:640px){.vm-list{grid-template-columns:minmax(0,1fr)}}
`

export default function MutedAlertsSection({ vehicleId, canEdit, onSaved }) {
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!IS_REAL || !vehicleId) return
    getVehicleMutedAlerts(vehicleId)
      .then(d => { setData(d); setPicked(d.muted); setError(null) })
      .catch(err => setError(err?.message || 'Could not load'))
  }, [vehicleId])
  useEffect(load, [load])

  if (!IS_REAL) return null
  const dirty = data && [...picked].sort().join() !== [...data.muted].sort().join()
  const toggle = key => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const d = await setVehicleMutedAlerts(vehicleId, picked)
      setData(d)
      setPicked(d.muted)
      onSaved?.(d.muted.length ? `${d.muted.length} alert type(s) switched off for this vehicle` : 'All alerts are on for this vehicle')
    } catch (err) {
      setError(err?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="vi-sechead"><div className="vi-sectitle"><BellOff size={15} />Alerts for this vehicle</div></div>
      <div className="vm-note">Tick an event to switch it off for this vehicle: it will not be raised, so it will not show in Notifications, the bell or the violation reports. Rules of other vehicles are not affected.</div>
      {error && <div className="vm-note" style={{ color: '#ef4444' }}>{error}</div>}
      {!data ? (!error && <div className="vm-note">Loading…</div>) : (
        <>
          <div className="vm-list">
            {data.types.map(t => (
              <label key={t.key} className="vm-row" data-off={picked.includes(t.key)}>
                <input type="checkbox" checked={picked.includes(t.key)} disabled={!canEdit} onChange={() => toggle(t.key)} />
                <span>{t.label}</span>
                {picked.includes(t.key) && <small>Off</small>}
              </label>
            ))}
          </div>
          {canEdit && (
            <div className="vm-foot">
              <button type="button" className="vi-btn" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save alerts'}</button>
              {dirty && <button type="button" className="vi-btn" onClick={() => setPicked(data.muted)}>Undo</button>}
            </div>
          )}
        </>
      )}
    </>
  )
}
