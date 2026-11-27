import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Upload, ChevronDown, ChevronRight, SlidersHorizontal, Search, Ban } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import ToastStack from '../../components/tracking/Toasts'
import ConfirmDialog from '../../components/tracking/ConfirmDialog'
import { useToasts } from '../../hooks/useToasts'
import { IS_REAL } from '../../data/mode'
import { CARD_SURFACE } from './formStyles'
import { usePageAccess, handleApiError } from './pageChrome'
import { useVehicles, useCompanies } from '../../data/settings'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { fetchFuelOverview, removeFuelCalibration } from '../../data/fuel'
import { fmtLitres, fmtRaw, flagText } from '../../utils/fuelFormat'
import UffizioCard from './UffizioCard'
import FuelCalibrationDialog from './FuelCalibrationDialog'
import FuelSection, { calibrationText } from '../../components/tracking/FuelSection'

/**
 * Settings › Master › Fuel (client, 2026-11-24): the Uffizio fuel-vehicle
 * feed, and each vehicle's fuel calibration — upload the client's Fuel Liter
 * / Voltage sheet or type the table, with the tank capacity and the reading
 * method, for one vehicle or many at once. A row opens the vehicle's fuel
 * sensor as last read and its calibration history.
 */

const CSS = `
.fu-card{background:var(--c-card);border:1px solid var(--c-border2);border-radius:var(--ft-radius,14px);box-shadow:var(--ft-shadow);margin-top:16px}
.fu-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 16px}
.fu-bar h2{margin:0;font-size:14.5px;font-weight:800;color:var(--c-text1)}
.fu-bar p{margin:2px 0 0;font-size:12px;color:var(--c-text3)}
.fu-tools{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.fu-in{height:34px;box-sizing:border-box;padding:0 10px 0 30px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-input);color:var(--c-text1);font-size:12.5px;width:200px;max-width:100%}
.fu-chk{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--c-text2);cursor:pointer}
.fu-chk input{accent-color:var(--ft-accent)}
.fu-btn{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.fu-btn:hover:not(:disabled){background:var(--c-hover)}
.fu-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.fu-btn.sm{height:28px;padding:0 9px;font-size:11.5px}
.fu-scroll{overflow-x:auto}
.fu-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:760px}
.fu-t th{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);text-align:left;padding:9px 12px;border-top:1px solid var(--c-border);border-bottom:1px solid var(--c-border);white-space:nowrap;background:var(--c-thead)}
.fu-t td{padding:10px 12px;border-bottom:1px solid var(--c-border);color:var(--c-text1);vertical-align:middle}
.fu-t tr.fu-row:hover td{background:var(--c-hover)}
.fu-sub{font-size:11px;color:var(--c-text3);margin-top:2px}
.fu-pill{display:inline-flex;align-items:center;font-size:10.5px;font-weight:750;padding:2px 8px;border-radius:999px;white-space:nowrap}
.fu-exp{background:none;border:0;color:var(--c-text2);cursor:pointer;display:inline-flex;padding:2px}
.fu-detail td{background:color-mix(in srgb,var(--ft-accent) 4%,transparent)}
.fu-empty{padding:30px 16px;text-align:center;font-size:12.5px;color:var(--c-text3)}
`

const pill = (c, text) => <span className="fu-pill" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{text}</span>

export default function Fuel(props) {
  const { toasts, push, dismiss } = useToasts()
  const access = usePageAccess('fuel')
  const vehicles = useVehicles()
  const companies = useCompanies()
  const [overview, setOverview] = useState(null)
  const [onlyFuel, setOnlyFuel] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // vehicle id whose detail is shown
  const [dialog, setDialog] = useState(null) // { ids, current }
  const [removing, setRemoving] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!IS_REAL) return
    fetchFuelOverview().then(setOverview).catch(err => { setOverview([]); handleApiError(err, { push }) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(load, [load])

  const byVehicle = useMemo(() => new Map((overview ?? []).map(o => [o.vehicleId, o])), [overview])
  const companyName = id => companies.find(c => String(c.id) === String(id))?.name ?? ''
  const all = useMemo(() => (vehicles ?? []).map(v => {
    const o = byVehicle.get(v.id)
    return {
      id: v.id, label: vehicleLabel(v) || v.imei || v.id, company: companyName(v.companyId),
      dataSource: v.dataSource, owned: v.owned !== false,
      calibration: o?.calibration ?? null, ports: o?.ports ?? [], hasFuel: !!o?.ports?.length,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }).sort((a, b) => (b.hasFuel - a.hasFuel) || a.label.localeCompare(b.label)), [vehicles, byVehicle, companies])
  const anyFuel = all.some(v => v.hasFuel || v.calibration)
  const rows = all.filter(v => (!onlyFuel || !anyFuel || v.hasFuel || v.calibration)
    && (!q.trim() || `${v.label} ${v.company}`.toLowerCase().includes(q.trim().toLowerCase())))
  const knownPorts = [...new Set((overview ?? []).flatMap(o => o.ports.map(p => p.port)).filter(p => !['ain.1', 'ain.2', 'can', 'can.fuel.level', 'can.fuel.volume'].includes(p)))].sort()
  const writable = all.filter(v => v.owned)

  const refresh = () => { load(); setReloadKey(k => k + 1) }
  const remove = async () => {
    const cal = removing.calibration
    setRemoving(null)
    try {
      await removeFuelCalibration(cal.id)
      push(`Calibration of ${removing.label} is no longer used (kept in its history)`, { tone: 'success' })
      refresh()
    } catch (err) {
      handleApiError(err, { push })
    }
  }

  return (
    <SettingsLayout title="Fuel" subtitle="Fuel sensors: where the readings come from, and how each vehicle’s reading turns into litres." {...props}>
      <style>{CSS}</style>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, marginTop: 16, fontSize: 13, color: 'var(--c-text2)' }}>
          Fuel readings are kept on the server, so this page needs the server and is not available in demo mode.
        </div>
      ) : (
        <>
          <UffizioCard push={push} />

          <section className="fu-card" aria-labelledby="fu-cal">
            <div className="fu-bar">
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <h2 id="fu-cal">Calibration</h2>
                <p>Upload the Fuel Liter / Voltage sheet for one vehicle or many. Without a calibration a vehicle’s fuel shows as the raw sensor value.</p>
              </div>
              <div className="fu-tools">
                <div style={{ position: 'relative' }}>
                  <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: 10, color: 'var(--c-text3)' }} />
                  <input className="fu-in" placeholder="Search vehicles" aria-label="Search vehicles" value={q} onChange={e => setQ(e.target.value)} />
                </div>
                {anyFuel && <label className="fu-chk"><input type="checkbox" checked={onlyFuel} onChange={e => setOnlyFuel(e.target.checked)} />Fuel vehicles only</label>}
                {access.canWrite && (
                  <button type="button" className="fu-btn primary" onClick={() => setDialog({ ids: [], current: null })} disabled={!writable.length}>
                    <Upload size={14} aria-hidden="true" />Upload calibration
                  </button>
                )}
              </div>
            </div>
            {overview === null ? (
              <div className="fu-empty">Loading…</div>
            ) : !rows.length ? (
              <div className="fu-empty">{q ? 'No vehicle matches.' : 'No vehicles.'}</div>
            ) : (
              <div className="fu-scroll">
                <table className="fu-t">
                  <thead>
                    <tr><th style={{ width: 28 }} aria-label="Details" /><th>Vehicle</th><th>Latest reading</th><th>Calibration in use</th><th style={{ width: 1 }} aria-label="Actions" /></tr>
                  </thead>
                  <tbody>
                    {rows.map(v => {
                      const p = v.ports[0]
                      const isOpen = open === v.id
                      return (
                        <Fragment key={v.id}>
                          <tr className="fu-row">
                            <td>
                              <button type="button" className="fu-exp" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} fuel details of ${v.label}`} onClick={() => setOpen(isOpen ? null : v.id)}>
                                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </button>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{v.label}{v.dataSource === 'UFFIZIO' && pill('var(--ft-accent)', 'Uffizio')}</div>
                              <div className="fu-sub">{v.company}</div>
                            </td>
                            <td>
                              {p ? (
                                <>
                                  <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.litres !== null ? fmtLitres(p.litres) : `raw ${fmtRaw(p.raw)}`}</div>
                                  <div className="fu-sub">{p.litres !== null ? `raw ${fmtRaw(p.raw)} · ${p.port}` : `${flagText(p.flag)} · ${p.port}`}{v.ports.length > 1 ? ` · +${v.ports.length - 1} port` : ''}</div>
                                </>
                              ) : <span className="fu-sub">No reading in 7 days</span>}
                            </td>
                            <td>
                              {v.calibration
                                ? <><div>{calibrationText(v.calibration)}</div><div className="fu-sub">{v.calibration.fileName || 'typed in'}{v.calibration.createdByName ? ` · ${v.calibration.createdByName}` : ''}</div></>
                                : pill('#d97706', 'Not calibrated')}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {access.canWrite && v.owned && (
                                <span style={{ display: 'inline-flex', gap: 6 }}>
                                  <button type="button" className="fu-btn sm" onClick={() => setDialog({ ids: [v.id], current: v.calibration })}><SlidersHorizontal size={13} aria-hidden="true" />{v.calibration ? 'Change' : 'Calibrate'}</button>
                                  {v.calibration && <button type="button" className="fu-btn sm" aria-label={`Stop using the calibration of ${v.label}`} title="Stop using this calibration (kept in the history)" onClick={() => setRemoving(v)}><Ban size={13} aria-hidden="true" /></button>}
                                </span>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="fu-detail"><td /><td colSpan={4} style={{ paddingTop: 0 }}><FuelSection vehicleId={v.id} inDialog={false} reloadKey={reloadKey} /></td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {dialog && (
        <FuelCalibrationDialog
          vehicles={writable}
          initialIds={dialog.ids}
          current={dialog.current}
          knownPorts={knownPorts}
          push={push}
          onClose={() => setDialog(null)}
          onApplied={refresh}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Stop using this calibration?"
          body={`${removing.label} will show raw fuel values until a new calibration is applied. The table stays in its history.`}
          confirmLabel="Stop using it"
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </SettingsLayout>
  )
}
