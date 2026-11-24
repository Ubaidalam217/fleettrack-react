import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, XCircle, Link2 } from 'lucide-react'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE, FIELD_LABEL, inputStyle } from './formStyles'
import {
  useVehicles, useCompanies, useBranches, branchTreeForCompany, branchOptionLabel, importVehiclesFromSheet,
} from '../../data/settings'
import { get } from '../../data/http'
import { IS_REAL } from '../../data/mode'
import { handleApiError } from './pageChrome'
import { readVehicleRows, MAX_IMPORT_ROWS, IMPORT_NOTES } from '../../utils/vehicleImport'
import { readVehicleSheet, downloadVehicleSample, downloadImportErrors } from '../../utils/vehicleImportFiles'

/**
 * Settings › Bulk Action › Import Vehicles (client, 2026-11-24): the Master Data
 * sheet (Uffizio template) uploaded once for the existing vehicles. Sample file,
 * upload, a row-by-row check (the server re-checks every row), choose where the
 * vehicles go, import the valid rows. The rules and the column mapping live in
 * utils/vehicleImport.js.
 */

const th = { padding: '6px 8px', fontSize: 10, fontWeight: 750, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--c-card2, var(--c-card))', borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }
const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--c-border)', verticalAlign: 'top', color: 'var(--c-text1)' }

const FLESPI_LABEL = { linked: 'Linked to its Flespi device', created: 'New Flespi device', none: 'Not in Flespi' }

function Step({ n, title, children }) {
  return (
    <section style={{ ...CARD_SURFACE, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ft-accent)', color: '#fff', fontSize: 11.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <h2 style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--c-text1)', margin: 0 }}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

export default function VehicleImport({ canWrite, push }) {
  const companies = useCompanies()
  useBranches()
  const vehicles = useVehicles()
  const fileRef = useRef(null)
  const pushRef = useRef(push)
  pushRef.current = push

  const [bgId, setBgId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [fileName, setFileName] = useState('')
  const [read, setRead] = useState(null)          // readVehicleRows result (local check)
  const [server, setServer] = useState(null)      // dry-run answer
  const [checking, setChecking] = useState(false)
  const [createDevices, setCreateDevices] = useState(false)
  const [deviceType, setDeviceType] = useState('')
  const [types, setTypes] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const company = bgId || (companies.length === 1 ? companies[0].id : '')
  const branches = useMemo(() => (company ? branchTreeForCompany(company) : []), [company])
  const existingImeis = useMemo(() => new Set(vehicles.map(v => String(v.imei ?? '').replace(/\D/g, '')).filter(Boolean)), [vehicles])

  useEffect(() => {
    if (!IS_REAL) return undefined
    let alive = true
    get('/api/vehicles/device-types').then(d => { if (alive) setTypes(d?.types ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Re-check against the server whenever the file or the target changes.
  useEffect(() => {
    if (!read?.items?.length || !company || !IS_REAL) { setServer(null); return undefined }
    let alive = true
    setChecking(true)
    importVehiclesFromSheet({
      bgId: company, branchId, dryRun: true, createDevices, deviceType,
      rows: read.items.map(i => ({ row: i.row, raw: i.raw })),
    })
      .then(r => { if (alive) setServer(r) })
      .catch(err => { if (alive) { setServer(null); handleApiError(err, { push: pushRef.current }) } })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [read, company, branchId, createDevices, deviceType])

  const pick = async file => {
    setResult(null)
    setServer(null)
    if (!file) return
    setFileName(file.name)
    try {
      const rows = await readVehicleSheet(file)
      setRead(readVehicleRows(rows, { existingImeis }))
    } catch (err) {
      setRead(null)
      push(err.message || 'Could not read this file', { tone: 'error' })
    }
  }

  // What the table shows: the server's verdict when it has given one, else the local check.
  const rows = useMemo(() => {
    if (!read?.items) return []
    if (server?.rows) {
      const byRow = new Map(server.rows.map(r => [r.row, r]))
      return read.items.map(i => {
        const s = byRow.get(i.row)
        return { row: i.row, name: s?.name ?? i.vehicle.name, imei: s?.imei ?? i.vehicle.imei, ok: s ? s.ok : i.ok, problems: s?.problems ?? i.problems, flespi: s?.flespi, odometer: i.vehicle.odometer }
      })
    }
    return read.items.map(i => ({ row: i.row, name: i.vehicle.name, imei: i.vehicle.imei, ok: i.ok, problems: i.problems, flespi: null, odometer: i.vehicle.odometer }))
  }, [read, server])

  const valid = rows.filter(r => r.ok)
  const bad = rows.filter(r => !r.ok)
  const problems = [...bad.map(r => ({ row: r.row, name: r.name, imei: r.imei, message: r.problems.join('; ') })), ...(read?.errors ?? []).filter(e => !read.items.some(i => i.row === e.row))]
  const linked = valid.filter(r => r.flespi === 'linked').length
  const notInFlespi = valid.filter(r => r.flespi === 'none').length
  const newDevices = valid.filter(r => r.flespi === 'created').length
  const ready = canWrite && IS_REAL && company && valid.length > 0 && !checking && !importing && (!createDevices || deviceType.trim())

  const run = async () => {
    if (!ready) return
    setImporting(true)
    try {
      const r = await importVehiclesFromSheet({
        bgId: company, branchId, dryRun: false, createDevices, deviceType,
        rows: read.items.filter(i => valid.some(v => v.row === i.row)).map(i => ({ row: i.row, raw: i.raw })),
      })
      // The rows left out because of the check come first, then any the server refused.
      const merged = { ...r, errors: [...problems, ...r.errors].sort((a, b) => a.row - b.row) }
      setResult(merged)
      setRead(null)
      setServer(null)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      push(`${r.created.length} vehicle${r.created.length === 1 ? '' : 's'} imported${merged.errors.length ? ` · ${merged.errors.length} not imported` : ''}`, { tone: r.created.length ? 'success' : 'error' })
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '2px 0 12px', maxWidth: 860, lineHeight: 1.5 }}>
        Upload the vehicles of the other system once (the Master Data sheet). Vehicles whose IMEI is already a device in Flespi are linked to it
        and nothing is changed there; their positions keep arriving as before.
      </p>

      <Step n={1} title="Download the sample">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={SECONDARY_BTN} onClick={() => downloadVehicleSample('xlsx').catch(e => push(e.message, { tone: 'error' }))}>
            <FileSpreadsheet size={14} aria-hidden="true" />Sample (.xlsx)
          </button>
          <button type="button" style={SECONDARY_BTN} onClick={() => downloadVehicleSample('csv')}>
            <Download size={14} aria-hidden="true" />Sample (.csv)
          </button>
        </div>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--c-text3)', lineHeight: 1.6 }}>
          {IMPORT_NOTES.map(n => <li key={n}>{n}</li>)}
        </ul>
      </Step>

      <Step n={2} title="Where do the vehicles go?">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <span style={FIELD_LABEL}>Business Group *</span>
            <select value={company} onChange={e => { setBgId(e.target.value); setBranchId('') }} style={inputStyle(false)} aria-label="Business Group">
              <option value="">— Select —</option>
              {[...companies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <span style={FIELD_LABEL}>Branch (optional)</span>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!company || !branches.length} style={inputStyle(false)} aria-label="Branch">
              <option value="">— None —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{branchOptionLabel(b)}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--c-border2)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 650, color: 'var(--c-text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={createDevices} onChange={e => setCreateDevices(e.target.checked)} />
            Also create a device in Flespi for IMEIs that are not there yet
          </label>
          {createDevices && (
            <label style={{ display: 'block', marginTop: 8, maxWidth: 320 }}>
              <span style={FIELD_LABEL}>Device type *</span>
              <input list="import-device-types" value={deviceType} onChange={e => setDeviceType(e.target.value)} placeholder="Teltonika FMC130" style={inputStyle(false)} aria-label="Device type" />
              <datalist id="import-device-types">{types.map(t => <option key={t.id} value={t.title} />)}</datalist>
            </label>
          )}
          <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 6, lineHeight: 1.5 }}>
            {createDevices
              ? 'This writes to Flespi: one new device per missing IMEI, as when a single vehicle is added. A Flespi plan with no device left refuses it, and that vehicle is then not imported.'
              : 'Off (recommended for the first upload): nothing is written to Flespi. A vehicle whose IMEI is not in Flespi is saved without a device link.'}
          </div>
        </div>
      </Step>

      <Step n={3} title="Upload the file">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={e => pick(e.target.files?.[0])} aria-label="Vehicle file" />
          <button type="button" style={SECONDARY_BTN} onClick={() => fileRef.current?.click()} disabled={!canWrite}>
            <Upload size={14} aria-hidden="true" />Choose .xlsx or .csv
          </button>
          <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>{fileName || `Up to ${MAX_IMPORT_ROWS} vehicles`}</span>
        </div>
        {!canWrite && <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 8 }}>You can view this page but not import vehicles.</div>}
        {!IS_REAL && <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 8 }}>The demo can check a file, but importing needs the server.</div>}
        {read?.fatal && (
          <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 6, alignItems: 'center' }}>
            <XCircle size={15} aria-hidden="true" />{read.fatal}
          </div>
        )}
      </Step>

      {rows.length > 0 && (
        <Step n={4} title="Check and import">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12.5 }}>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', color: '#16a34a', fontWeight: 700 }}><CheckCircle2 size={15} aria-hidden="true" />{valid.length} ready</span>
            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', color: bad.length ? '#ef4444' : 'var(--c-text3)', fontWeight: 700 }}><AlertTriangle size={15} aria-hidden="true" />{bad.length} with problems</span>
            {IS_REAL && (
              <span style={{ color: 'var(--c-text3)' }}>
                {checking ? 'Checking with the server…' : `${linked} linked to Flespi${newDevices ? ` · ${newDevices} new device${newDevices === 1 ? '' : 's'}` : ''}${notInFlespi ? ` · ${notInFlespi} not in Flespi` : ''}`}
              </span>
            )}
            {bad.length > 0 && (
              <button type="button" style={{ ...SECONDARY_BTN, padding: '5px 12px', marginLeft: 'auto' }} onClick={() => downloadImportErrors(problems)}>
                <Download size={13} aria-hidden="true" />Problems (.csv)
              </button>
            )}
          </div>
          <div style={{ overflow: 'auto', maxHeight: '48vh', border: '1px solid var(--c-border)', borderRadius: 10 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
              <thead>
                <tr>{['Row', 'Vehicle Name', 'IMEI', 'Flespi', 'Odometer', 'Check'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.row} style={r.ok ? undefined : { background: 'color-mix(in srgb, #ef4444 7%, transparent)' }}>
                    <td style={td}>{r.row}</td>
                    <td style={td}>{r.name || '—'}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{r.imei || '—'}</td>
                    <td style={{ ...td, color: 'var(--c-text2)' }}>
                      {r.ok && r.flespi ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{r.flespi === 'linked' && <Link2 size={12} aria-hidden="true" />}{FLESPI_LABEL[r.flespi]}</span> : '—'}
                    </td>
                    <td style={td}>{r.odometer != null ? r.odometer.toLocaleString() : '—'}</td>
                    <td style={{ ...td, color: r.ok ? '#16a34a' : '#ef4444', fontWeight: r.ok ? 700 : 500 }}>{r.ok ? 'OK' : r.problems.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...PRIMARY_BTN, opacity: ready ? 1 : 0.55 }} disabled={!ready} onClick={run}>
              <Upload size={14} aria-hidden="true" />{importing ? 'Importing…' : `Import ${valid.length} vehicle${valid.length === 1 ? '' : 's'}`}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
              {!company ? 'Choose the Business Group first.' : bad.length ? 'Rows with problems are skipped; fix them in the file and upload them again.' : 'Odometer readings are applied as the vehicle’s own reading once its tracker has reported one.'}
            </span>
          </div>
        </Step>
      )}

      {result && (
        <Step n="✓" title="Import finished">
          <div style={{ fontSize: 12.5, color: 'var(--c-text1)', lineHeight: 1.7 }}>
            <div><strong>{result.created.length}</strong> vehicle{result.created.length === 1 ? '' : 's'} imported
              {' '}({result.created.filter(c => c.flespi === 'linked').length} linked to Flespi
              {result.created.some(c => c.flespi === 'created') ? `, ${result.created.filter(c => c.flespi === 'created').length} new Flespi devices` : ''}
              {result.created.some(c => c.flespi === 'none') ? `, ${result.created.filter(c => c.flespi === 'none').length} not in Flespi` : ''}).</div>
            {result.created.some(c => c.odometer === 'applied') && <div>{result.created.filter(c => c.odometer === 'applied').length} odometer reading(s) applied.</div>}
            {result.created.some(c => c.odometer === 'pending') && (
              <div>{result.created.filter(c => c.odometer === 'pending').length} odometer reading(s) kept in the vehicle’s custom fields: the tracker has not reported a reading yet. Set it under Bulk Object Update once it has.</div>
            )}
            {result.elockPasswordIgnored > 0 && <div>The Elock Unlock Password column is not imported (it is a secret).</div>}
            {result.errors.length > 0 && (
              <div style={{ color: '#ef4444' }}>
                {result.errors.length} not imported:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {result.errors.slice(0, 20).map(e => <li key={e.row}>Row {e.row}{e.name ? ` (${e.name})` : ''}: {e.message}</li>)}
                </ul>
                <button type="button" style={{ ...SECONDARY_BTN, padding: '5px 12px', marginTop: 8 }} onClick={() => downloadImportErrors(result.errors)}>
                  <Download size={13} aria-hidden="true" />Problems (.csv)
                </button>
              </div>
            )}
          </div>
        </Step>
      )}
    </div>
  )
}
