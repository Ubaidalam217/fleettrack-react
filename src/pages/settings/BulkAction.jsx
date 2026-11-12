import { useCallback, useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw, Search, Gauge } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE } from './formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useVehicles, useCompanies, useBranches,
  companyNameFor, branchTreeForCompany, branchOptionLabel,
  updateVehicle, updateVehicleDetails, listVehicleOdometers, setVehicleOdometer, refreshAll,
} from '../../data/settings'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import { VEHICLE_TYPES } from '../../services/vehicleMaster'
import { IS_REAL } from '../../data/mode'
import { fmtKm } from '../../utils/odometer'
import { MAX_ROWS_PER_SAVE, DETAIL_KEYS, NAME_KEYS, changedCells } from './bulkUpdate'

/**
 * Settings › Bulk Action › Bulk Object Update (client, 2026-11-12; modelled on
 * AI Revofleet's): one row per vehicle, edited in place, saved together.
 *
 * What a save sends, per changed row and only for the cells that changed:
 *   - Branch, Make, Model, Vehicle Type, SIM / Mobile No, Validity → PATCH
 *     /api/vehicles/:id/details, which never touches the Flespi device;
 *   - Vehicle Number / Fleet No → the full vehicle update, which also renames
 *     the tracker in Flespi (said under the table);
 *   - Odometer → "Update the ODO meter reading": the vehicle's real odometer,
 *     kept as a correction to the tracker's (utils/odometer.js); never written
 *     to the tracker.
 */

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--c-border)', verticalAlign: 'middle', whiteSpace: 'nowrap' }
const head = { ...cell, fontSize: 10, fontWeight: 750, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', background: 'var(--c-card2, var(--c-card))', position: 'sticky', top: 0, zIndex: 1, textAlign: 'left' }
const box = changed => ({
  width: '100%', minWidth: 110, boxSizing: 'border-box', padding: '6px 8px', borderRadius: 7, fontSize: 12.5,
  border: `1px solid ${changed ? 'var(--ft-accent)' : 'var(--c-border)'}`,
  background: changed ? 'color-mix(in srgb, var(--ft-accent) 8%, var(--c-input))' : 'var(--c-input)',
  color: 'var(--c-text1)', outline: 'none',
})

export default function BulkAction(props) {
  const vehicles = useVehicles()
  useCompanies()
  useBranches()
  const access = usePageAccess('vehicle')
  const { toasts, push, dismiss } = useToasts()

  const [edits, setEdits] = useState({})          // vehicle id → { cell: value }
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [odos, setOdos] = useState(new Map())     // vehicle id → odometer row
  const [odoOpen, setOdoOpen] = useState(null)    // the row whose odometer box is open

  const loadOdometers = useCallback(() => {
    listVehicleOdometers()
      .then(rows => setOdos(new Map((rows ?? []).map(r => [r.vehicleId, r]))))
      .catch(() => setOdos(new Map()))
  }, [])
  useEffect(loadOdometers, [loadOdometers])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...vehicles].sort((a, b) => (a.vehicleNumber || a.imei).localeCompare(b.vehicleNumber || b.imei))
    if (!q) return list
    return list.filter(v => [v.vehicleNumber, v.vehicleId, v.imei, v.make, v.model, companyNameFor(v.companyId)]
      .some(x => String(x ?? '').toLowerCase().includes(q)))
  }, [vehicles, query])

  const changed = useMemo(() => {
    const out = []
    for (const v of vehicles) {
      const c = changedCells(v, edits[v.id])
      if (Object.keys(c).length) out.push({ v, c })
    }
    return out
  }, [vehicles, edits])

  const edit = (id, key, value) => setEdits(e => ({ ...e, [id]: { ...e[id], [key]: value } }))
  const valueOf = (v, key) => (edits[v.id] && key in edits[v.id] ? edits[v.id][key] : v[key] ?? '')
  const isChanged = (v, key) => key in changedCells(v, edits[v.id])
  const readOnly = !access.canWrite

  const save = async () => {
    if (saving || !changed.length) return
    if (changed.length > MAX_ROWS_PER_SAVE) {
      push(`Save up to ${MAX_ROWS_PER_SAVE} rows at a time (${changed.length} changed)`, { tone: 'error' })
      return
    }
    for (const { c } of changed) {
      if ('odometer' in c && !(Number(c.odometer) >= 0 && Number(c.odometer) < 10_000_000)) {
        push('An odometer reading must be from 0 to 9,999,999 km', { tone: 'error' })
        return
      }
    }
    setSaving(true)
    let ok = 0
    const failed = {}
    for (const { v, c } of changed) {
      try {
        const details = Object.fromEntries(Object.entries(c).filter(([k]) => DETAIL_KEYS.includes(k)))
        if (Object.keys(details).length) await updateVehicleDetails(v.id, details, { refresh: false })
        if (NAME_KEYS.some(k => k in c)) {
          await updateVehicle(v.id, { ...v, ...details, vehicleNumber: c.vehicleNumber ?? v.vehicleNumber, vehicleId: c.vehicleId ?? v.vehicleId })
        }
        if ('odometer' in c) await setVehicleOdometer(v.id, Number(c.odometer), { refresh: false })
        ok += 1
      } catch (err) {
        failed[v.id] = edits[v.id]
        handleApiError(err, { push })
      }
    }
    await refreshAll().catch(() => {})
    loadOdometers()
    setEdits(failed)
    setOdoOpen(null)
    setSaving(false)
    if (ok) push(`${ok} vehicle${ok === 1 ? '' : 's'} updated`, { tone: 'success' })
  }

  return (
    <SettingsLayout title="Bulk Object Update" {...props}>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '2px 0 12px', maxWidth: 820, lineHeight: 1.5 }}>
        {modeNote(
          'Change several vehicles at once, then Save. Odometer is the vehicle’s own reading: type it once and FleetmaxX keeps counting from it — the tracker is not changed.',
          'Change several vehicles at once, then Save. The demo has no tracker readings, so Odometer needs the server.',
        )}
      </p>

      <div style={{ ...CARD_SURFACE, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ position: 'relative', flex: '0 1 280px' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--c-text3)' }} aria-hidden="true" />
            <input
              value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vehicle, IMEI, make…" aria-label="Search vehicles"
              style={{ ...box(false), paddingLeft: 28 }}
            />
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: changed.length > MAX_ROWS_PER_SAVE ? '#ef4444' : 'var(--c-text2)' }}>
            Update Row : {changed.length} / {MAX_ROWS_PER_SAVE}
          </span>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '62vh', border: '1px solid var(--c-border)', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, color: 'var(--c-text1)' }}>
            <thead>
              <tr>
                {['Vehicle Number', 'Fleet No', 'IMEI', 'Business Group', 'Branch', 'Make', 'Model', 'Vehicle Type', 'SIM / Mobile No', 'Validity', 'Odometer (km)']
                  .map(h => <th key={h} style={head}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(v => {
                const branches = branchTreeForCompany(v.companyId)
                const o = odos.get(v.id)
                const odoEdit = edits[v.id]?.odometer
                return (
                  <tr key={v.id}>
                    <td style={cell}><input aria-label={`Vehicle Number of ${v.vehicleNumber || v.imei}`} value={valueOf(v, 'vehicleNumber')} disabled={readOnly} onChange={e => edit(v.id, 'vehicleNumber', e.target.value)} style={box(isChanged(v, 'vehicleNumber'))} /></td>
                    <td style={cell}><input aria-label="Fleet No" value={valueOf(v, 'vehicleId')} disabled={readOnly} onChange={e => edit(v.id, 'vehicleId', e.target.value)} style={box(isChanged(v, 'vehicleId'))} /></td>
                    <td style={{ ...cell, fontFamily: 'ui-monospace, monospace', color: 'var(--c-text2)' }}>{v.imei}</td>
                    <td style={{ ...cell, color: 'var(--c-text2)' }}>{companyNameFor(v.companyId)}</td>
                    <td style={cell}>
                      <select aria-label="Branch" value={valueOf(v, 'branchId')} disabled={readOnly || !branches.length} onChange={e => edit(v.id, 'branchId', e.target.value)} style={box(isChanged(v, 'branchId'))}>
                        <option value="">— None —</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{branchOptionLabel(b)}</option>)}
                      </select>
                    </td>
                    <td style={cell}><input aria-label="Make" value={valueOf(v, 'make')} disabled={readOnly} onChange={e => edit(v.id, 'make', e.target.value)} style={box(isChanged(v, 'make'))} /></td>
                    <td style={cell}><input aria-label="Model" value={valueOf(v, 'model')} disabled={readOnly} onChange={e => edit(v.id, 'model', e.target.value)} style={box(isChanged(v, 'model'))} /></td>
                    <td style={cell}>
                      <select aria-label="Vehicle Type" value={valueOf(v, 'vehicleType')} disabled={readOnly} onChange={e => edit(v.id, 'vehicleType', e.target.value)} style={box(isChanged(v, 'vehicleType'))}>
                        {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t ? t.charAt(0).toUpperCase() + t.slice(1) : '—'}</option>)}
                      </select>
                    </td>
                    <td style={cell}><input aria-label="SIM / Mobile No" value={valueOf(v, 'mobileNo')} disabled={readOnly} onChange={e => edit(v.id, 'mobileNo', e.target.value)} style={box(isChanged(v, 'mobileNo'))} /></td>
                    <td style={cell}><input aria-label="Validity" type="date" value={valueOf(v, 'validUntil')} disabled={readOnly} onChange={e => edit(v.id, 'validUntil', e.target.value)} style={box(isChanged(v, 'validUntil'))} /></td>
                    <td style={{ ...cell, minWidth: 170 }}>
                      {odoOpen === v.id || odoEdit !== undefined ? (
                        <input
                          aria-label={`Odometer of ${v.vehicleNumber || v.imei}`} type="number" min="0" step="any" inputMode="decimal" autoFocus
                          value={odoEdit ?? ''} placeholder={o?.vehicleKm != null ? String(Math.round(o.vehicleKm * 10) / 10) : ''}
                          onChange={e => edit(v.id, 'odometer', e.target.value)}
                          style={box(odoEdit !== undefined && String(odoEdit).trim() !== '')}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={readOnly || !IS_REAL || o?.deviceKm == null}
                          onClick={() => setOdoOpen(v.id)}
                          title={!IS_REAL ? 'Needs the server' : o?.deviceKm == null ? 'The tracker has not sent an odometer reading yet' : 'Type the vehicle’s own odometer reading'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: 0, cursor: readOnly || o?.deviceKm == null ? 'default' : 'pointer', color: 'var(--c-text1)', fontSize: 12.5 }}
                        >
                          <Gauge size={13} style={{ color: 'var(--ft-accent)' }} aria-hidden="true" />
                          {o?.vehicleKm != null ? fmtKm(o.vehicleKm) : '—'}
                        </button>
                      )}
                      {o?.offsetKm != null && o.deviceKm != null && (
                        <div style={{ fontSize: 10.5, color: 'var(--c-text3)', marginTop: 2 }}>Device {fmtKm(o.deviceKm)}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!shown.length && (
                <tr><td colSpan={11} style={{ ...cell, textAlign: 'center', color: 'var(--c-text3)', padding: 24 }}>{vehicles.length ? 'No vehicle matches the search' : 'No vehicles yet'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={save} disabled={readOnly || saving || !changed.length} style={{ ...PRIMARY_BTN, opacity: readOnly || saving || !changed.length ? 0.55 : 1 }}>
            <Save size={14} aria-hidden="true" />{saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEdits({}); setOdoOpen(null) }} disabled={saving || !Object.keys(edits).length} style={{ ...SECONDARY_BTN, opacity: saving || !Object.keys(edits).length ? 0.55 : 1 }}>
            <RotateCcw size={14} aria-hidden="true" />Reset
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>
            {readOnly ? 'You can view these vehicles but not change them.' : 'A new Vehicle Number or Fleet No also renames the tracker in Flespi. The other columns, and Odometer, never touch the tracker.'}
          </span>
        </div>
      </div>
    </SettingsLayout>
  )
}
