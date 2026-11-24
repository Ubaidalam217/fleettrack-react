import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import VehicleImport from './VehicleImport'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { Save, RotateCcw, Search, Gauge, Link2, Unlink } from 'lucide-react'
import SettingsLayout from './SettingsLayout'
import { PRIMARY_BTN, SECONDARY_BTN, CARD_SURFACE } from './formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import {
  useVehicles, useCompanies, useBranches, useGroups,
  companyNameFor, branchTreeForCompany, branchOptionLabel,
  updateVehicle, updateVehicleDetails, updateVehicleCustomFields, listVehicleOdometers, setVehicleOdometer, refreshAll,
  SHARING_AVAILABLE, shareVehicles, unshareVehicles,
} from '../../data/settings'
import { isOwned } from '../../utils/vehiclePlacement'
import { usePageAccess, handleApiError, modeNote } from './pageChrome'
import { cachedVehicleTypes } from '../../services/vehicleMaster'
import VehicleTypeSelect from '../../components/VehicleTypeSelect'
import { vehicleTypeOptions } from '../../utils/vehicleTypes'
import { withSite, MAX_SITE } from '../../utils/vehicleSite'
import { IS_REAL } from '../../data/mode'
import { fmtKm } from '../../utils/odometer'
import { MAX_ROWS_PER_SAVE, DETAIL_KEYS, NAME_KEYS, changedCells, cellValue } from './bulkUpdate'

/**
 * Settings › Bulk Action › Bulk Object Update (client, 2026-11-12; modelled on
 * AI Revofleet's): one row per vehicle, edited in place, saved together.
 *
 * What a save sends, per changed row and only for the cells that changed:
 *   - Branch, Make, Model, Vehicle Type, SIM / Mobile No, Validity → PATCH
 *     /api/vehicles/:id/details, which never touches the Flespi device;
 *   - Site → the vehicle's custom fields (PUT /api/vehicles/:id/custom-fields),
 *     which never touch it either;
 *   - Vehicle Number / Fleet No → the full vehicle update, which also renames
 *     the tracker in Flespi (said under the table);
 *   - Odometer → "Update the ODO meter reading": the vehicle's real odometer,
 *     kept as a correction to the tracker's (utils/odometer.js); never written
 *     to the tracker.
 *
 * Share (client, 2026-11-13: one vehicle in several places): tick vehicles,
 * choose a Group / Business Group / Branch, then "Also show there" or "Stop
 * showing there" (POST /api/vehicle-shares/add | remove — no Flespi call).
 * Only this account's own vehicles are listed: one shared into it is changed
 * by its owner.
 */

const cell = { padding: '6px 8px', borderBottom: '1px solid var(--c-border)', verticalAlign: 'middle', whiteSpace: 'nowrap' }
const head = { ...cell, fontSize: 10, fontWeight: 750, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', background: 'var(--c-card2, var(--c-card))', position: 'sticky', top: 0, zIndex: 1, textAlign: 'left' }
const box = changed => ({
  width: '100%', minWidth: 110, boxSizing: 'border-box', padding: '6px 8px', borderRadius: 7, fontSize: 12.5,
  border: `1px solid ${changed ? 'var(--ft-accent)' : 'var(--c-border)'}`,
  background: changed ? 'color-mix(in srgb, var(--ft-accent) 8%, var(--c-input))' : 'var(--c-input)',
  color: 'var(--c-text1)', outline: 'none',
})

/** Every place a vehicle can be shared to, as one indented list: "level:id" → label. */
function usePlaceOptions() {
  const companies = useCompanies()
  const groups = useGroups()
  useBranches()
  return useMemo(() => {
    const out = []
    for (const g of [...groups].sort((a, b) => a.name.localeCompare(b.name))) out.push({ value: `group:${g.id}`, label: `${g.name} (Group)` })
    for (const c of [...companies].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ value: `bg:${c.id}`, label: c.name })
      for (const b of branchTreeForCompany(c.id)) out.push({ value: `branch:${b.id}`, label: `\u00a0\u00a0\u00a0${branchOptionLabel(b)}` })
    }
    return out
  }, [companies, groups])
}

export default function BulkAction(props) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'import' ? 'import' : 'update'
  const allVehicles = useVehicles()
  // Its own vehicles only: a vehicle shared into this account is its owner's to change.
  const vehicles = useMemo(() => allVehicles.filter(isOwned), [allVehicles])
  const places = usePlaceOptions()
  const access = usePageAccess('vehicle')
  const { toasts, push, dismiss } = useToasts()

  const [edits, setEdits] = useState({})          // vehicle id → { cell: value }
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [odos, setOdos] = useState(new Map())     // vehicle id → odometer row
  const [odoOpen, setOdoOpen] = useState(null)    // the row whose odometer box is open
  const [picked, setPicked] = useState(() => new Set()) // vehicle ids ticked for a share
  const [place, setPlace] = useState('')                // "level:id" to share to
  const [sharing, setSharing] = useState(false)

  const loadOdometers = useCallback(() => {
    listVehicleOdometers()
      .then(rows => setOdos(new Map((rows ?? []).map(r => [r.vehicleId, r]))))
      .catch(() => setOdos(new Map()))
  }, [])
  useEffect(loadOdometers, [loadOdometers])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...vehicles].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
    if (!q) return list
    return list.filter(v => [v.vehicleNumber, v.vehicleId, v.imei, v.make, v.model, companyNameFor(v.companyId)]
      .some(x => String(x ?? '').toLowerCase().includes(q)))
  }, [vehicles, query])

  // Built-ins plus the custom types already on these vehicles.
  const typeOptions = useMemo(
    () => vehicleTypeOptions([...cachedVehicleTypes(), ...vehicles.map(v => v.vehicleType)]),
    [vehicles]
  )

  const changed = useMemo(() => {
    const out = []
    for (const v of vehicles) {
      const c = changedCells(v, edits[v.id])
      if (Object.keys(c).length) out.push({ v, c })
    }
    return out
  }, [vehicles, edits])

  const edit = (id, key, value) => setEdits(e => ({ ...e, [id]: { ...e[id], [key]: value } }))
  const valueOf = (v, key) => (edits[v.id] && key in edits[v.id] ? edits[v.id][key] : cellValue(v, key) ?? '')
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
        if ('site' in c) await updateVehicleCustomFields(v.id, withSite(v.customFields, c.site), { refresh: false })
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

  const canShare = SHARING_AVAILABLE && !readOnly
  const pickedShown = shown.filter(v => picked.has(v.id))
  const allPicked = shown.length > 0 && pickedShown.length === shown.length
  const togglePick = id => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const share = async add => {
    if (sharing || !place || !picked.size) return
    const [level, id] = place.split(':')
    const where = places.find(p => p.value === place)?.label.trim() ?? 'there'
    setSharing(true)
    try {
      if (add) {
        const r = await shareVehicles([...picked], level, id)
        const skipped = (r?.skipped?.home?.length ?? 0) + (r?.skipped?.already?.length ?? 0)
        push(`${r?.added?.length ?? 0} vehicle${r?.added?.length === 1 ? '' : 's'} also shown in ${where}${skipped ? ` · ${skipped} already there` : ''}`, { tone: 'success' })
      } else {
        const r = await unshareVehicles([...picked], level, id)
        push(`${r?.removed?.length ?? 0} vehicle${r?.removed?.length === 1 ? '' : 's'} no longer shown in ${where}`, { tone: 'success' })
      }
      setPicked(new Set())
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setSharing(false)
    }
  }

  return (
    <SettingsLayout title={tab === 'import' ? 'Import Vehicles' : 'Bulk Object Update'} {...props}>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div role="tablist" aria-label="Bulk Action" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['update', 'Bulk Object Update'], ['import', 'Import Vehicles']].map(([id, label]) => (
          <button
            key={id} type="button" role="tab" aria-selected={tab === id}
            onClick={() => setParams(id === 'import' ? { tab: 'import' } : {}, { replace: true })}
            style={{
              padding: '7px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: tab === id ? 750 : 600, cursor: 'pointer',
              border: `1px solid ${tab === id ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
              background: tab === id ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
              color: tab === id ? 'var(--ft-accent)' : 'var(--c-text2)',
            }}
          >{label}</button>
        ))}
      </div>
      {tab === 'import' ? <VehicleImport canWrite={access.canWrite} push={push} /> : (<>
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

        {canShare && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', borderRadius: 10, border: '1px dashed var(--c-border2)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text2)' }}>Share {picked.size} ticked</span>
            <select aria-label="Place to share to" value={place} onChange={e => setPlace(e.target.value)} style={{ ...box(false), width: 'auto', minWidth: 220, flex: '0 1 300px' }}>
              <option value="">— Group, Business Group or Branch —</option>
              {places.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button type="button" onClick={() => share(true)} disabled={sharing || !place || !picked.size} style={{ ...SECONDARY_BTN, opacity: sharing || !place || !picked.size ? 0.55 : 1 }}>
              <Link2 size={14} aria-hidden="true" />Also show there
            </button>
            <button type="button" onClick={() => share(false)} disabled={sharing || !place || !picked.size} style={{ ...SECONDARY_BTN, opacity: sharing || !place || !picked.size ? 0.55 : 1 }}>
              <Unlink size={14} aria-hidden="true" />Stop showing there
            </button>
            <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>The vehicles stay in their own Business Group; nothing is sent to the trackers.</span>
          </div>
        )}

        <div style={{ overflow: 'auto', maxHeight: '62vh', border: '1px solid var(--c-border)', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5, color: 'var(--c-text1)' }}>
            <thead>
              <tr>
                {canShare && (
                  <th style={{ ...head, width: 30 }}>
                    <input type="checkbox" aria-label="Tick every vehicle shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map(v => v.id)))} />
                  </th>
                )}
                {['Vehicle Number', 'Fleet No', 'IMEI', 'Business Group', 'Branch', 'Also in', 'Site', 'Make', 'Model', 'Vehicle Type', 'SIM / Mobile No', 'Validity', 'Odometer (km)']
                  .filter(h => h !== 'Also in' || SHARING_AVAILABLE)
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
                    {canShare && (
                      <td style={cell}>
                        <input type="checkbox" aria-label={`Tick ${v.vehicleNumber || v.imei}`} checked={picked.has(v.id)} onChange={() => togglePick(v.id)} />
                      </td>
                    )}
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
                    {SHARING_AVAILABLE && (
                      <td style={{ ...cell, color: 'var(--c-text2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={(v.shares ?? []).map(x => x.label).join('\n')}>
                        {(v.shares ?? []).length ? v.shares.map(x => x.label).join(', ') : '—'}
                      </td>
                    )}
                    <td style={cell}><input aria-label="Site" value={valueOf(v, 'site')} maxLength={MAX_SITE} placeholder="Uses the branch" disabled={readOnly} onChange={e => edit(v.id, 'site', e.target.value)} style={box(isChanged(v, 'site'))} /></td>
                    <td style={cell}><input aria-label="Make" value={valueOf(v, 'make')} disabled={readOnly} onChange={e => edit(v.id, 'make', e.target.value)} style={box(isChanged(v, 'make'))} /></td>
                    <td style={cell}><input aria-label="Model" value={valueOf(v, 'model')} disabled={readOnly} onChange={e => edit(v.id, 'model', e.target.value)} style={box(isChanged(v, 'model'))} /></td>
                    <td style={cell}>
                      <VehicleTypeSelect ariaLabel="Vehicle Type" value={valueOf(v, 'vehicleType')} options={typeOptions} disabled={readOnly} onChange={t => edit(v.id, 'vehicleType', t)} style={box(isChanged(v, 'vehicleType'))} />
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
                <tr><td colSpan={12 + (canShare ? 1 : 0) + (SHARING_AVAILABLE ? 1 : 0)} style={{ ...cell, textAlign: 'center', color: 'var(--c-text3)', padding: 24 }}>{vehicles.length ? 'No vehicle matches the search' : 'No vehicles yet'}</td></tr>
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
            {readOnly ? 'You can view these vehicles but not change them.' : 'A new Vehicle Number or Fleet No also renames the tracker in Flespi. The other columns, Site and Odometer never touch the tracker.'}
          </span>
        </div>
      </div>
      </>)}
    </SettingsLayout>
  )
}
