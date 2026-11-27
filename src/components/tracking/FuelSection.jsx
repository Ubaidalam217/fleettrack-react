import { useCallback, useEffect, useState } from 'react'
import { Fuel, History, Upload, SlidersHorizontal } from 'lucide-react'
import FuelCalibrationDialog from '../../pages/settings/FuelCalibrationDialog'
import ToastStack from './Toasts'
import { useToasts } from '../../hooks/useToasts'
import { usePageAccess } from '../../pages/settings/pageChrome'
import { fetchVehicleFuel } from '../../data/fuel'
import { IS_REAL } from '../../data/mode'
import { methodLabel } from '../../utils/fuelCalibration'
import { fmtLitres, fmtRaw, flagText } from '../../utils/fuelFormat'

/**
 * "Fuel" in Vehicle information (client, 2026-11-24): the vehicle's fuel
 * sensor as last read — the raw value and the litres the calibration in use
 * makes of it — and that calibration, with the ones it replaced. Uses the
 * dialog's vi-* styles when inside Vehicle information; stands alone in
 * Settings › Master › Fuel. Hidden when the vehicle has neither a reading nor
 * a calibration (`hideEmpty`).
 */

const CSS = `
.vf-note{font-size:11.5px;color:var(--c-text3);line-height:1.5;margin:2px 0 10px}
.vf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 12px;margin-bottom:10px}
.vf-tile{border:1px solid var(--c-border);border-radius:10px;padding:9px 11px;min-width:0}
.vf-k{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vf-v{font-size:17px;font-weight:800;color:var(--c-text1);margin-top:2px;font-variant-numeric:tabular-nums}
.vf-s{font-size:11px;color:var(--c-text3);margin-top:1px}
.vf-warn{color:#b45309}
.vf-hist{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.vf-hist li{font-size:11.5px;color:var(--c-text2)}
.vf-act{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px}
.vf-btn{height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.vf-btn:hover{background:var(--c-hover)}
.vf-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.vf-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--c-text1);margin:16px 0 8px}
`

const when = iso => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export function calibrationText(c) {
  if (!c) return 'None'
  if (c.method === 'CAN') return `CAN %, tank ${fmtLitres(c.tankCapacityL)}`
  if (c.method === 'CAN_VOLUME') return `CAN litres${c.tankCapacityL ? `, tank ${fmtLitres(c.tankCapacityL)}` : ''}`
  return `${methodLabel(c.method)}${c.method === 'PORT' ? ` (${c.port})` : ''} · ${c.points.length} points${c.tankCapacityL ? ` · tank ${fmtLitres(c.tankCapacityL)}` : ''}`
}

/**
 * "Upload calibration" and "Calibrate" for ONE vehicle (client, 2026-11-27: "Calibration
 * file upload can be possible from the device level"): the same dialog as Settings ›
 * Fuel — file upload, typed table, tank capacity, reading method, curve preview — for
 * Uffizio and Flespi vehicles, with the same rights (Fuel screen at Edit; a vehicle
 * shared in is read-only). Renders nothing for a user who cannot write.
 */
export function FuelCalibrateActions({ vehicle, calibration = null, ports = [], onApplied, push }) {
  const access = usePageAccess('fuel')
  const own = useToasts()
  const [mode, setMode] = useState(null) // 'file' | 'manual'
  if (!IS_REAL || !vehicle?.id || !access.canWrite || vehicle.owned === false) return null
  const notify = push ?? own.push
  const known = [...new Set(ports.map(p => p.port).filter(p => !['ain.1', 'ain.2', 'can', 'can.fuel.level', 'can.fuel.volume'].includes(p)))].sort()
  return (
    <>
      <style>{CSS}</style>
      <div className="vf-act">
        <button type="button" className="vf-btn primary" onClick={() => setMode('file')}><Upload size={13} aria-hidden="true" />Upload calibration</button>
        <button type="button" className="vf-btn" onClick={() => setMode('manual')}><SlidersHorizontal size={13} aria-hidden="true" />{calibration ? 'Calibrate again' : 'Calibrate'}</button>
      </div>
      {mode && (
        <FuelCalibrationDialog
          vehicles={[{ id: vehicle.id, label: vehicle.label, company: vehicle.company ?? '', hasFuel: ports.length > 0 }]}
          initialIds={[vehicle.id]}
          current={calibration}
          knownPorts={known}
          initialMode={mode}
          push={notify}
          onClose={() => setMode(null)}
          onApplied={onApplied}
        />
      )}
      {!push && <ToastStack toasts={own.toasts} onDismiss={own.dismiss} />}
    </>
  )
}

export default function FuelSection({ vehicleId, vehicleName = '', hideEmpty = false, inDialog = true, reloadKey = 0, showActions = false, owned = true, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const access = usePageAccess('fuel')

  const load = useCallback(() => {
    if (!IS_REAL || !vehicleId) return
    fetchVehicleFuel(vehicleId).then(d => { setData(d); setError(null) }).catch(err => setError(err?.message || 'Could not load'))
  }, [vehicleId])
  useEffect(load, [load, reloadKey])

  if (!IS_REAL) return null
  const canCalibrate = showActions && access.canWrite && owned
  if (hideEmpty && data && !data.calibration && !data.ports.length && !data.history.length && !canCalibrate) return null

  const title = inDialog
    ? <div className="vi-sechead"><div className="vi-sectitle"><Fuel size={15} />Fuel</div></div>
    : <div className="vf-head"><Fuel size={15} aria-hidden="true" />Fuel sensor</div>
  const cal = data?.calibration

  return (
    <>
      <style>{CSS}</style>
      {title}
      {error && <div className="vf-note" style={{ color: '#ef4444' }}>{error}</div>}
      {!data ? (!error && <div className="vf-note">Loading…</div>) : (
        <>
          {showActions && (
            <FuelCalibrateActions
              vehicle={{ id: vehicleId, label: vehicleName || data.vehicle.label, owned }}
              calibration={data.calibration}
              ports={data.ports}
              onApplied={() => { load(); onChanged?.() }}
            />
          )}
          {data.ports.length === 0 ? (
            <div className="vf-note">No fuel reading in the last 7 days.{data.vehicle.dataSource === 'UFFIZIO' ? ' The Uffizio feed has not sent a fuel value for this vehicle.' : ' A Flespi tracker is read once a fuel input is chosen with Calibrate (Input 1 / 2, CAN litres or CAN percent).'}</div>
          ) : (
            <div className="vf-grid">
              {data.ports.map(p => (
                <div key={p.port} className="vf-tile">
                  <div className="vf-k" title={p.port}>{p.port}</div>
                  <div className="vf-v">{p.litres !== null ? fmtLitres(p.litres) : fmtRaw(p.raw)}</div>
                  <div className={`vf-s${p.flag && p.flag !== 'clamped' ? ' vf-warn' : ''}`}>
                    {p.litres !== null ? `raw ${fmtRaw(p.raw)}` : flagText(p.flag)}
                    {p.flag === 'clamped' ? ' · at the end of the table' : ''}
                  </div>
                  <div className="vf-s">{when(p.ts)}{p.ign === true ? ' · ignition on' : p.ign === false ? ' · ignition off' : ''}</div>
                </div>
              ))}
            </div>
          )}
          <div className="vf-note" style={{ marginBottom: 4 }}>
            <b style={{ color: 'var(--c-text2)' }}>Calibration in use:</b> {calibrationText(cal)}
            {cal && <> · {cal.fileName ? `from ${cal.fileName}` : 'typed in'} · {when(cal.createdAt)}{cal.createdByName ? ` · ${cal.createdByName}` : ''}</>}
            {!cal && ' — readings show raw until one is applied in Settings › Master › Fuel.'}
          </div>
          {data.history.length > 0 && (
            <details>
              <summary className="vf-note" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, margin: 0 }}>
                <History size={12} aria-hidden="true" />{data.history.length} earlier calibration{data.history.length === 1 ? '' : 's'}
              </summary>
              <ul className="vf-hist">
                {data.history.map(h => (
                  <li key={h.id}>{calibrationText(h)} · {h.fileName || 'typed in'} · used {when(h.createdAt)} – {when(h.replacedAt)}{h.replacedByName ? ` (replaced by ${h.replacedByName})` : ''}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  )
}
