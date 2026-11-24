import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Fuel, X, Upload, Download, Plus, Trash2, AlertTriangle, Search } from 'lucide-react'
import FuelLineChart from '../../components/fuel/FuelLineChart'
import { applyFuelCalibration } from '../../data/fuel'
import { handleApiError } from './pageChrome'
import {
  METHODS, validateCalibration, parseCalibrationRows, toNumber,
} from '../../utils/fuelCalibration'
import { readCalibrationFile, downloadCalibrationSample } from '../../utils/fuelCalibrationFiles'

/**
 * Settings › Master › Fuel › Calibration (client, 2026-11-24): "calibration
 * files have Fuel Liter and Voltage (millivolts); in the upload window we
 * enter tank capacity and reading method". Upload the client's sheet (.xlsx
 * or .csv) — or type the table in — check it row by row with a curve
 * preview, and apply it to one vehicle or many at once. The vehicle's
 * calibration in use is kept as history on the server, never overwritten.
 */

const CSS = `
.fc-back{position:fixed;inset:0;z-index:1600;background:rgba(5,20,28,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.fc-dlg{width:min(980px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:16px;background:var(--c-card);border:1px solid var(--c-border);box-shadow:0 24px 60px rgba(0,0,0,.35);padding:20px}
.fc-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.fc-ico{width:36px;height:36px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--ft-accent) 14%,transparent);color:var(--ft-accent)}
.fc-x{display:flex;padding:6px;border-radius:8px;border:1px solid var(--c-border2);background:transparent;color:var(--c-text2);cursor:pointer;margin-left:auto}
.fc-cols{display:grid;grid-template-columns:minmax(0,280px) minmax(0,1fr);gap:18px}
.fc-lbl{display:block;font-size:10.5px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);margin:0 0 5px}
.fc-in{width:100%;box-sizing:border-box;height:36px;padding:0 10px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-input);color:var(--c-text1);font-size:13px}
.fc-in[aria-invalid="true"]{border-color:#dc2626}
.fc-field{margin-bottom:12px}
.fc-hint{font-size:11px;color:var(--c-text3);margin-top:4px;line-height:1.45}
.fc-err{font-size:11.5px;color:#dc2626;margin-top:4px}
.fc-veh{border:1px solid var(--c-border2);border-radius:10px;max-height:230px;overflow:auto;padding:4px}
.fc-vrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;font-size:12.5px;cursor:pointer;color:var(--c-text1)}
.fc-vrow:hover{background:var(--c-hover)}
.fc-vrow input{accent-color:var(--ft-accent);width:15px;height:15px}
.fc-vrow small{margin-left:auto;color:var(--c-text3);font-size:10.5px}
.fc-tabs{display:inline-flex;padding:3px;border-radius:10px;background:var(--c-input);border:1px solid var(--c-border2);margin-bottom:12px}
.fc-tab{border:0;background:transparent;color:var(--c-text2);font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:7px;cursor:pointer}
.fc-tab[aria-selected="true"]{background:var(--c-card);color:var(--ft-accent);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.fc-btn{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--c-border2);background:var(--c-card);color:var(--c-text1);font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.fc-btn:hover:not(:disabled){background:var(--c-hover)}
.fc-btn:disabled{opacity:.55;cursor:not-allowed}
.fc-btn.primary{background:var(--ft-accent);border-color:var(--ft-accent);color:#fff}
.fc-drop{border:1.5px dashed var(--c-border2);border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--c-input)}
.fc-table{width:100%;border-collapse:collapse;font-size:12.5px}
.fc-table th{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text3);text-align:left;padding:6px 8px;border-bottom:1px solid var(--c-border);position:sticky;top:0;background:var(--c-card)}
.fc-table td{padding:5px 8px;border-bottom:1px solid var(--c-border);color:var(--c-text1);font-variant-numeric:tabular-nums}
.fc-table tr[data-bad="true"] td{background:color-mix(in srgb,#dc2626 8%,transparent)}
.fc-table input{width:100%;box-sizing:border-box;height:30px;padding:0 8px;border-radius:7px;border:1px solid var(--c-border2);background:var(--c-input);color:var(--c-text1);font-size:12.5px}
.fc-scroll{max-height:260px;overflow:auto;border:1px solid var(--c-border2);border-radius:10px}
.fc-msgs{margin:10px 0 0;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5;list-style:none}
.fc-msgs li{display:flex;gap:6px}
.fc-foot{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border)}
@media (max-width:760px){.fc-cols{grid-template-columns:minmax(0,1fr)}.fc-dlg{padding:14px}}
`

const blankRows = () => [{ litres: '', mv: '' }, { litres: '', mv: '' }]

export default function FuelCalibrationDialog({ vehicles, initialIds = [], current = null, knownPorts = [], onClose, onApplied, push }) {
  const [ids, setIds] = useState(() => new Set(initialIds))
  const [q, setQ] = useState('')
  const [mode, setMode] = useState('file')
  const [method, setMethod] = useState(current?.method ?? (knownPorts.length ? 'PORT' : 'AIN1'))
  const [port, setPort] = useState(current?.method === 'PORT' ? current.port : (knownPorts[0] ?? ''))
  const [tank, setTank] = useState(current?.tankCapacityL != null ? String(current.tankCapacityL) : '')
  const [file, setFile] = useState(null) // { name, parsed }
  const [fileError, setFileError] = useState(null)
  const [rows, setRows] = useState(() => (current?.points?.length ? current.points.map(p => ({ litres: String(p.litres), mv: String(p.mv) })) : blankRows()))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const fileRef = useRef(null)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const needsTable = METHODS.find(m => m.value === method)?.table !== false
  const tankNum = tank.trim() === '' ? null : toNumber(tank)
  const tankBad = tank.trim() !== '' && !(tankNum > 0)

  // The rows to check: the file's, or the typed ones (blank rows skipped).
  const input = useMemo(() => {
    if (mode === 'file') return file?.parsed ?? { points: [], errors: [], warnings: [] }
    const points = rows
      .map((r, i) => ({ row: i + 1, litres: r.litres, mv: r.mv }))
      .filter(r => String(r.litres).trim() !== '' || String(r.mv).trim() !== '')
    return { points, errors: [], warnings: [] }
  }, [mode, file, rows])
  const check = useMemo(() => (needsTable ? validateCalibration(input.points, { tankCapacityL: tankNum }) : null), [needsTable, input, tankNum])
  const allErrors = needsTable ? [...input.errors, ...(check?.errors ?? [])] : []
  const allWarnings = needsTable ? [...(input.warnings ?? []), ...(check?.warnings ?? [])] : []
  const badRows = new Set(allErrors.map(e => e.row).filter(r => r !== null))

  const shown = vehicles.filter(v => !q.trim() || `${v.label} ${v.company}`.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = id => setIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const canApply = ids.size > 0 && !saving && !tankBad
    && (method !== 'CAN' || tankNum > 0)
    && (method !== 'PORT' || port.trim())
    && (!needsTable || (check && !allErrors.length && check.points.length >= 2))

  const pickFile = async f => {
    setFileError(null)
    setFile(null)
    if (!f) return
    try {
      const sheet = await readCalibrationFile(f)
      setFile({ name: f.name, parsed: parseCalibrationRows(sheet) })
    } catch (err) {
      setFileError(err?.message || 'Could not read the file')
    }
  }

  const apply = async () => {
    setSaving(true)
    setErrors({})
    try {
      const d = await applyFuelCalibration({
        vehicleIds: [...ids], method, port: method === 'PORT' ? port.trim() : null,
        tankCapacityL: tankNum, points: needsTable ? check.points : [],
        fileName: needsTable && mode === 'file' ? file?.name ?? null : null,
      })
      push?.(`Calibration applied to ${d.applied.length} vehicle${d.applied.length === 1 ? '' : 's'}`, { tone: 'success' })
      onApplied?.(d)
      onClose()
    } catch (err) {
      handleApiError(err, { push, setErrors })
    } finally {
      setSaving(false)
    }
  }

  const setRow = (i, key, value) => setRows(list => list.map((r, k) => (k === i ? { ...r, [key]: value } : r)))

  return createPortal(
    <div className="fc-back" onClick={() => !saving && onClose()}>
      <style>{CSS}</style>
      <div className="fc-dlg" role="dialog" aria-modal="true" aria-labelledby="fc-title" onClick={e => e.stopPropagation()}>
        <div className="fc-head">
          <div className="fc-ico"><Fuel size={18} aria-hidden="true" /></div>
          <div style={{ minWidth: 0 }}>
            <div id="fc-title" style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text1)' }}>Fuel calibration</div>
            <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 3 }}>The table that turns the sensor’s voltage into litres. The one in use now is kept in the history.</div>
          </div>
          <button type="button" className="fc-x" onClick={onClose} aria-label="Close" disabled={saving}><X size={15} /></button>
        </div>

        <div className="fc-cols">
          <div>
            <div className="fc-field">
              <label className="fc-lbl" htmlFor="fc-q">Vehicles ({ids.size} chosen)</label>
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: 11, color: 'var(--c-text3)' }} />
                <input id="fc-q" className="fc-in" style={{ paddingLeft: 30 }} placeholder="Search vehicles" value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <div className="fc-veh" role="group" aria-label="Vehicles">
                {shown.map(v => (
                  <label key={v.id} className="fc-vrow">
                    <input type="checkbox" checked={ids.has(v.id)} onChange={() => toggle(v.id)} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
                    <small>{v.hasFuel ? 'fuel data' : v.company}</small>
                  </label>
                ))}
                {!shown.length && <div className="fc-hint" style={{ padding: 8 }}>No vehicle matches.</div>}
              </div>
              {errors.vehicleIds && <div className="fc-err">{errors.vehicleIds}</div>}
            </div>
            <div className="fc-field">
              <label className="fc-lbl" htmlFor="fc-method">Reading method</label>
              <select id="fc-method" className="fc-in" value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div className="fc-hint">Where the fuel sensor is wired. CAN sends the level in percent and needs no table.</div>
            </div>
            {method === 'PORT' && (
              <div className="fc-field">
                <label className="fc-lbl" htmlFor="fc-port">Uffizio fuel port</label>
                <input id="fc-port" className="fc-in" list="fc-ports" value={port} aria-invalid={!port.trim() || !!errors.port} onChange={e => setPort(e.target.value)} placeholder="BLE Fuel Level #1" />
                <datalist id="fc-ports">{knownPorts.map(p => <option key={p} value={p} />)}</datalist>
                {errors.port && <div className="fc-err">{errors.port}</div>}
              </div>
            )}
            <div className="fc-field">
              <label className="fc-lbl" htmlFor="fc-tank">Tank capacity (litres){method === 'CAN' ? ' *' : ''}</label>
              <input id="fc-tank" className="fc-in" inputMode="decimal" value={tank} aria-invalid={tankBad || !!errors.tankCapacityL} onChange={e => setTank(e.target.value)} placeholder="e.g. 200" />
              {(tankBad || errors.tankCapacityL) && <div className="fc-err">{errors.tankCapacityL || 'Enter a number above 0'}</div>}
              <div className="fc-hint">Used for “% of tank” alerts and to check the table.</div>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            {!needsTable ? (
              <div className="fc-drop" style={{ display: 'block' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text1)' }}>No table needed</div>
                <div className="fc-hint">The CAN reading is the fuel level in percent; litres = percent × tank capacity.</div>
              </div>
            ) : (
              <>
                <div className="fc-tabs" role="tablist" aria-label="How to enter the table">
                  <button type="button" role="tab" className="fc-tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>Upload file</button>
                  <button type="button" role="tab" className="fc-tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>Type the table</button>
                </div>
                {mode === 'file' ? (
                  <div className="fc-drop">
                    <button type="button" className="fc-btn primary" onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" />Choose file</button>
                    <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
                    <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file?.name ?? 'No file chosen'}</div>
                      <div className="fc-hint" style={{ marginTop: 1 }}>Excel (.xlsx) or CSV with the columns “Fuel Liter *” and “Voltage *” (millivolts). An old .xls must be saved as .xlsx first.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="fc-btn" onClick={() => downloadCalibrationSample('xlsx').catch(e => push?.(e.message, { tone: 'error' }))}><Download size={13} aria-hidden="true" />Sample .xlsx</button>
                      <button type="button" className="fc-btn" onClick={() => downloadCalibrationSample('csv')}>.csv</button>
                    </div>
                  </div>
                ) : (
                  <div className="fc-scroll">
                    <table className="fc-table">
                      <thead><tr><th style={{ width: 48 }}>#</th><th>Fuel Liter</th><th>Voltage (mV)</th><th style={{ width: 40 }} aria-label="Remove" /></tr></thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} data-bad={badRows.has(i + 1)}>
                            <td>{i + 1}</td>
                            <td><input aria-label={`Row ${i + 1} Fuel Liter`} inputMode="decimal" value={r.litres} onChange={e => setRow(i, 'litres', e.target.value)} /></td>
                            <td><input aria-label={`Row ${i + 1} Voltage`} inputMode="decimal" value={r.mv} onChange={e => setRow(i, 'mv', e.target.value)} /></td>
                            <td><button type="button" className="fc-x" style={{ margin: 0 }} aria-label={`Remove row ${i + 1}`} onClick={() => setRows(list => (list.length > 1 ? list.filter((_, k) => k !== i) : blankRows()))}><Trash2 size={13} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ padding: 8 }}><button type="button" className="fc-btn" onClick={() => setRows(list => [...list, { litres: '', mv: '' }])}><Plus size={13} aria-hidden="true" />Add row</button></div>
                  </div>
                )}
                {fileError && <div className="fc-msgs" style={{ background: 'color-mix(in srgb,#dc2626 9%,transparent)', color: 'var(--c-text1)' }}>{fileError}</div>}

                {input.points.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="fc-lbl">Preview — {check?.points.length ?? 0} points{check?.direction ? `, voltage ${check.direction === 'rising' ? 'rises' : 'falls'} as the tank fills` : ''}</div>
                    <FuelLineChart
                      height={180}
                      showDots
                      ariaLabel="Calibration curve: litres by voltage"
                      points={(check?.points ?? []).map(p => ({ x: p.mv, y: p.litres }))}
                      xFormat={v => `${Math.round(v)} mV`}
                      yFormat={v => `${v} L`}
                      tipX={v => `${v} mV`}
                      tipY={v => `${v} L`}
                    />
                    {mode === 'file' && (
                      <div className="fc-scroll" style={{ marginTop: 10, maxHeight: 180 }}>
                        <table className="fc-table">
                          <thead><tr><th>Row</th><th>Fuel Liter</th><th>Voltage (mV)</th><th>Check</th></tr></thead>
                          <tbody>
                            {input.points.map(p => {
                              const e = allErrors.find(x => x.row === p.row)
                              return (
                                <tr key={p.row} data-bad={!!e}>
                                  <td>{p.row}</td><td>{p.litres ?? '—'}</td><td>{p.mv ?? '—'}</td>
                                  <td style={{ color: e ? '#dc2626' : 'var(--c-text3)' }}>{e ? e.message : 'OK'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                {(allErrors.length > 0 || allWarnings.length > 0) && (
                  <ul className="fc-msgs" style={{ background: allErrors.length ? 'color-mix(in srgb,#dc2626 9%,transparent)' : 'color-mix(in srgb,#d97706 10%,transparent)', color: 'var(--c-text1)' }}>
                    {[...allErrors, ...allWarnings].slice(0, 8).map((m, i) => (
                      <li key={i}><AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: i < allErrors.length ? '#dc2626' : '#d97706' }} />{m.row ? `Row ${m.row}: ` : ''}{m.message}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>

        <div className="fc-foot">
          <button type="button" className="fc-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="fc-btn primary" onClick={apply} disabled={!canApply}>
            {saving ? 'Applying…' : `Apply to ${ids.size || 0} vehicle${ids.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
