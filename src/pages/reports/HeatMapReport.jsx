import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle, Flame } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import HeatLayer from '../../components/reports/HeatLayer'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, HelpTip, ReportByToggle, DriverMultiSelect } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { ALERT_TYPES, alertTypeLabel, settingsProfileForImei, useVehicles, useCompanies } from '../../data/settings'
import { fetchAlertEventsInRange } from '../../data/alertEvents'
import { IS_REAL } from '../../data/mode'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { resolveRowLocations } from '../../utils/reportLocations'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { presenceCells, eventCells, hotspots, HEAT_STOPS } from '../../utils/heatmap'
import { VIOLATION_TYPES } from '../../utils/violationOverview'
import { hhmm } from '../../utils/utilization'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import { driverFilterLabel, driverIdentity, driverPasses, runsForDrivers, NO_DRIVER } from '../../utils/driverAtTime'

/**
 * Heat Map (client, 2026-11-10: "can we show the heatmap of vehicles presence
 * or any event where occurred"). Two views on our own map:
 *
 *   Vehicle presence  where the fleet spent its time (utils/heatmap.js) —
 *                     moving, with the engine on, or including parked time
 *   Events            where the alerts the server raised happened, by kind
 *
 * plus the ten hottest places, named, with the time or events and vehicles
 * there. The presence mode and the event kinds re-colour what was fetched; the
 * vehicles, the dates and the view need Generate.
 */

const MAX_RANGE_DAYS = 31
const NOT_ASSIGNED = 'Not assigned'
// ibutton.code: the driver at each moment, for the Driver filter (utils/driverAtTime.js).
const FIELDS = 'timestamp,position.latitude,position.longitude,position.speed,engine.ignition.status,ibutton.code'
const UAE_CENTER = [24.45, 54.38]
const MODES = [
  { key: 'moving', label: 'Moving' },
  { key: 'engine', label: 'Engine on' },
  { key: 'all',    label: 'All, with parked time' },
]
// Events with a place: not the paperwork ones.
const PLACED_TYPES = ALERT_TYPES.map(t => t.value).filter(t => t !== 'license_expiry')

const spotIcon = rank => L.divIcon({
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: `<div style="width:26px;height:26px;border-radius:50%;background:#111827;color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font:800 12px Inter,Arial,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.4)">${rank}</div>`,
})

const COLUMNS = [
  { key: 'rank',     label: '#',               width: '4%',  pdf: 4, align: 'right' },
  { key: 'location', label: 'Place',           width: '44%', pdf: 44, locate: true },
  { key: 'amount',   label: 'Time',            width: '10%', pdf: 10, align: 'right' },
  { key: 'share',    label: 'Share',           width: '8%',  pdf: 8, align: 'right' },
  { key: 'vehicles', label: 'Vehicles',        width: '34%', pdf: 34 },
]

/** Fit the map to the heat once per new set of data. */
function FitTo({ points, mapRef }) {
  const map = useMap()
  useEffect(() => { mapRef.current = map }, [map, mapRef])
  useEffect(() => {
    if (!points.length) return
    const id = setTimeout(() => {
      map.invalidateSize()
      map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 15, animate: false })
    }, 60)
    return () => clearTimeout(id)
  }, [map, points])
  return null
}

export default function HeatMapReport(props) {
  const title = useReportTitle('Heat Map')
  const { data } = useFlespiData()
  // Driver filter (client, 2026-11-12): only the time / events of the chosen drivers.
  const driverDim = useDriverDimension()
  // Report By: Vehicle or Driver. Driver covers every vehicle and keeps only the
  // chosen drivers' time / events (one map, so no regrouping).
  const [reportBy, setReportBy] = useState('vehicle')
  const [driverPick, setDriverPick] = useState(null) // null = every driver
  const driverFilter = reportBy === 'driver' ? driverPick : null
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(() => liveVehicles.map(v => {
    const profile = settingsProfileForImei(v.ident)
    return {
      id: v.id,
      label: profile.plateNo || v.master?.plateNo || profile.fleetNo || v.name,
      company: profile.linked ? (profile.bgName || NOT_ASSIGNED) : NOT_ASSIGNED,
    }
  }).sort((a, b) => a.label.localeCompare(b.label)),
  // settingsProfileForImei reads these stores.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vehiclesKey, settingsVehicles, companies])

  const now = useRef(new Date()).current
  const [view, setView] = useState('presence') // 'presence' | 'events'
  const [mode, setMode] = useState('engine')
  const [types, setTypes] = useState(VIOLATION_TYPES)
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))

  const [raw, setRaw] = useState(null) // { view, byVehicle | events, truncated, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const abortRef = useRef(null)
  const mapRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = reportBy === 'driver' ? vehicles.map(v => v.id) : (selectedIds ?? vehicles.map(v => v.id))
  const allSelected = reportBy === 'driver' || selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
        : `${effectiveIds.length} vehicles`
  const allTypes = types.length === PLACED_TYPES.length
  const typesLabel = allTypes ? 'All alerts'
    : types.length === 0 ? 'None'
      : types.length === VIOLATION_TYPES.length && VIOLATION_TYPES.every(t => types.includes(t)) ? 'Violations'
        : types.length <= 2 ? types.map(alertTypeLabel).join(', ') : `${types.length} kinds`

  const applyPreset = key => {
    setPreset(key)
    const range = presetRange(key)
    if (!range) return
    setFromDate(dateStr(range.from))
    setToDate(dateStr(range.to))
    setFromTime('00:00')
    setToTime(range.toEndOfDay ? '23:59' : timeStr(range.to))
  }
  const toggleVehicle = id => {
    const current = selectedIds ?? vehicles.map(v => v.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedIds(next.length === vehicles.length ? null : next)
  }
  const toggleType = t => setTypes(list => (list.includes(t) ? list.filter(x => x !== t) : [...list, t]))

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: view === 'events' ? 'Loading events...' : 'Loading the fleet’s positions...' })
    const applied = { fromTs, toTs, selectionLabel, printDate: formatPrintDate() }
    try {
      if (view === 'events') {
        const { events, truncated } = await fetchAlertEventsInRange({ fromTs, toTs, deviceIds: effectiveIds })
        if (controller.signal.aborted) return
        setRaw({ view, events, truncated, applied })
      } else {
        const byDevice = await fetchFleetMessages(effectiveIds, fromTs, toTs, {
          fields: FIELDS, signal: controller.signal,
          onStatus: text => setProgress({ text: /busy/i.test(text) ? text : `Loading the fleet’s positions · ${text.replace(/^Loading\s*/, '')}` }),
        })
        if (controller.signal.aborted) return
        const byVehicle = new Map([...byDevice].map(([id, e]) => [id, e.messages]))
        setRaw({ view, byVehicle, truncated: [...byDevice.values()].some(e => e.truncated), applied })
      }
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel, view])

  const cancel = () => abortRef.current?.abort()

  // The mode and the kinds re-colour what was fetched.
  const heat = useMemo(() => {
    if (!raw) return null
    const label = new Map(vehicles.map(v => [v.id, v.label]))
    const liveById = new Map((data?.vehicles ?? []).map(v => [v.id, v]))
    if (raw.view === 'events') {
      // An event's driver: the one the alert engine recorded, else the vehicle's.
      const whoOf = e => driverIdentity(e.driver) ?? driverDim.assignedFor(liveById.get(Number(e.deviceId))) ?? NO_DRIVER
      const kept = raw.events.filter(e => types.includes(e.type) && driverPasses(whoOf(e), driverFilter))
      const r = eventCells(kept, { labelOf: e => label.get(Number(e.deviceId)) ?? `Device ${e.deviceId}` })
      return { ...r, amountOf: w => `${w}`, totalText: `${r.total} event${r.total === 1 ? '' : 's'}`, totalWeight: r.total }
    }
    // With a driver filter each vehicle's track is cut into that driver's runs.
    const byRun = new Map()
    for (const [id, messages] of raw.byVehicle) {
      const at = driverDim.timelineFor(liveById.get(id), messages)
      runsForDrivers(messages, at, driverFilter).forEach((run, i) => byRun.set(`${id}#${i}`, run))
    }
    const r = presenceCells(byRun, { mode, labelOf: key => { const id = Number(String(key).split('#')[0]); return label.get(id) ?? `Device ${id}` } })
    return { ...r, amountOf: w => hhmm(w), totalText: `${hhmm(r.totalSec)} h`, totalWeight: r.totalSec }
  }, [raw, vehicles, mode, types, driverFilter, driverDim, data])

  const spots = useMemo(() => (heat ? hotspots(heat.cells, { limit: 10 }) : []), [heat])

  // Place names for the ten spots, filled in as they arrive.
  const groups = useMemo(() => {
    if (!heat) return []
    return [{
      key: 'spots',
      label: raw.view === 'events' ? 'Where the events happened most' : 'Where the vehicles spent the most time',
      rows: spots.map(s => ({
        key: s.rank, rank: s.rank, lat: s.lat, lng: s.lng,
        amount: heat.amountOf(s.weight),
        share: heat.totalWeight ? `${((s.weight / heat.totalWeight) * 100).toFixed(1)}%` : '—',
        vehicles: s.vehicles.join(', ') + (raw.view === 'events' && Object.keys(s.types).length
          ? ` — ${Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${alertTypeLabel(t)} ${n}`).join(', ')}` : ''),
      })),
      total: `Total ${heat.totalText} in ${heat.cells.length} place${heat.cells.length === 1 ? '' : 's'}`,
    }]
  }, [heat, spots, raw])

  useEffect(() => {
    if (!groups.length || !groups[0].rows.length) return
    const controller = new AbortController()
    resolveRowLocations(groups, {
      limit: 20, signal: controller.signal,
      onChunk: () => { if (!controller.signal.aborted) setGeoTick(t => t + 1) },
    }).catch(() => {})
    return () => controller.abort()
  }, [groups])

  const shownGroups = useMemo(() => groups.map(g => ({
    ...g,
    rows: g.rows.map(r => ({ ...r, location: r.locationText || `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` })),
  // geoTick: resolveRowLocations fills the address text in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [groups, geoTick])

  const columns = useMemo(() => COLUMNS.map(c => (c.key === 'amount' ? { ...c, label: raw?.view === 'events' ? 'Events' : 'Time (h)' } : c)), [raw])
  const applied = raw?.applied
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Showing', raw.view === 'events' ? `Events: ${typesLabel}` : `Presence: ${MODES.find(m => m.key === mode)?.label}`],
    ['Report By', reportBy === 'driver' ? 'Driver' : 'Vehicle'],
    ...(reportBy === 'driver' ? [['Drivers', driverFilterLabel(driverFilter, driverDim.options)]] : []),
  ] : []
  const stale = raw && raw.view !== view

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: shownGroups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: columns.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: g.rows,
    })),
  })

  return (
    <ReportFrame title={title} desc="Where the vehicles spend their time, or where events keep happening, coloured on the map." {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <ReportByToggle id="heatmap-report-by" value={reportBy} onChange={v => { setReportBy(v); setRaw(null) }} />
          {reportBy === 'driver' ? (
            <DriverMultiSelect options={driverDim.options} value={driverPick} onChange={setDriverPick} />
          ) : (
            <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
              <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All vehicles</strong></CheckRow>
              <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
              {vehicles.map(v => (
                <CheckRow key={v.id} checked={effectiveIds.includes(v.id)} onChange={() => toggleVehicle(v.id)} note={v.company !== NOT_ASSIGNED ? v.company : null}>
                  {v.label}
                </CheckRow>
              ))}
            </MultiSelect>
          )}
          {view === 'events' && (
            <MultiSelect label="EVENTS" summary={typesLabel}>
              <CheckRow checked={types.length === VIOLATION_TYPES.length && VIOLATION_TYPES.every(t => types.includes(t))} onChange={() => setTypes(VIOLATION_TYPES)}>
                <strong>Violations only</strong>
              </CheckRow>
              <CheckRow checked={allTypes} onChange={() => setTypes(allTypes ? [] : PLACED_TYPES)}><strong>All alerts</strong></CheckRow>
              <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
              {PLACED_TYPES.map(t => <CheckRow key={t} checked={types.includes(t)} onChange={() => toggleType(t)}>{alertTypeLabel(t)}</CheckRow>)}
            </MultiSelect>
          )}
          <div>
            <label style={LABEL}>FROM DATE</label>
            <input type="date" style={FIELD} value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>FROM TIME</label>
            <input type="time" style={FIELD} value={fromTime} onChange={e => { setFromTime(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO DATE</label>
            <input type="date" style={FIELD} value={toDate} onChange={e => { setToDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO TIME</label>
            <input type="time" style={FIELD} value={toTime} onChange={e => { setToTime(e.target.value); setPreset('custom') }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>SHOW</span>
              <Chip active={view === 'presence'} onClick={() => setView('presence')}>Vehicle presence</Chip>
              <Chip active={view === 'events'} onClick={() => setView('events')}>Events</Chip>
            </div>
            {view === 'presence' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...LABEL, marginBottom: 0, marginRight: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  COUNT TIME
                  <HelpTip title="Which time counts">
                    Moving: only while driving. Engine on: driving and idling. All: parked time too — overnight at the
                    depot will then outweigh everything else. Changing it does not fetch the data again.
                  </HelpTip>
                </span>
                {MODES.map(m => <Chip key={m.key} active={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</Chip>)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {rangeTooLong && <span style={{ fontSize: 11.5, color: '#ef4444' }}>Choose {MAX_RANGE_DAYS} days or fewer.</span>}
            {busy && <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>}
            <button
              type="button"
              onClick={generate}
              disabled={busy || !rangeValid || rangeTooLong || effectiveIds.length === 0}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: busy || !rangeValid || rangeTooLong ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || !rangeValid || rangeTooLong ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? progress.text : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      {view === 'events' && !IS_REAL && (
        <div className="report-screen-only" style={{ fontSize: 12.5, color: 'var(--c-text3)', marginBottom: 12 }}>
          Events are raised by the server, so this view has data only when signed in to it.
        </div>
      )}

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {heat && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{heat.totalText}</strong> in {heat.cells.length.toLocaleString()} place{heat.cells.length === 1 ? '' : 's'}
              {stale && <span style={{ color: '#f97316' }}> · showing {raw.view === 'events' ? 'events' : 'presence'} — Generate to switch</span>}
              {raw.view === 'events' && heat.unplaced > 0 && <span style={{ color: 'var(--c-text3)' }}> · {heat.unplaced} without a position left out</span>}
              {raw.truncated && <span style={{ color: '#f97316' }}> · {raw.view === 'events' ? 'more events than one report reads' : 'some days hit the message limit'} — narrow the range</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), fileNameOf(title))} icon={FileDown} primary disabled={!spots.length}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), fileNameOf(title))} icon={FileSpreadsheet} disabled={!spots.length}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!spots.length}>Print</ToolbarButton>
            </div>
          </div>

          {/* The map and the table print together, one under the other. */}
          <style>{`
            @media print {
              #heat-print, #heat-print * { visibility: visible !important; }
              #heat-print { position: absolute !important; left: 0; top: 0; width: 100%; }
              #heat-print #report-paper { position: static !important; }
            }
          `}</style>
          <div id="heat-print">
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--c-border)', overflow: 'hidden', marginBottom: 16, breakInside: 'avoid' }}>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #e5e7eb' }}>
                <Flame size={18} color="#dc2626" />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: '#4b5563', marginLeft: 'auto' }}>{filters.map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</div>
              </div>
              <div style={{ position: 'relative', height: 'min(560px, 62vh)' }}>
                <MapContainer center={UAE_CENTER} zoom={8} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <HeatLayer points={heat.cells} />
                  {spots.map(s => (
                    <Marker key={s.rank} position={[s.lat, s.lng]} icon={spotIcon(s.rank)}>
                      <Tooltip direction="top" offset={[0, -12]}>
                        #{s.rank} · {heat.amountOf(s.weight)}{raw.view === 'events' ? ' events' : ' h'} · {s.vehicles.length} vehicle{s.vehicles.length === 1 ? '' : 's'}
                      </Tooltip>
                    </Marker>
                  ))}
                  <FitTo points={heat.cells} mapRef={mapRef} />
                </MapContainer>
                {!heat.cells.length && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', border: '1px solid #e5e7eb', fontSize: 13, color: '#374151' }}>
                      {raw.view === 'events' ? 'No events of these kinds with a position in this period.' : 'No positions to show for this period and mode.'}
                    </div>
                  </div>
                )}
                <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 500, padding: '8px 10px', borderRadius: 9, background: 'rgba(255,255,255,0.94)', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                    {raw.view === 'events' ? 'Events' : 'Time spent'}
                  </div>
                  <div style={{ width: 150, height: 9, borderRadius: 5, background: `linear-gradient(to right, ${HEAT_STOPS.map(([at, c]) => `${c} ${at * 100}%`).join(', ')})` }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280', marginTop: 2 }}><span>Less</span><span>Most</span></div>
                </div>
              </div>
            </div>

            <PaperTable
              title={`${title} — Top places`}
              company="FleetmaxX"
              filters={filters}
              columns={columns}
              groups={shownGroups}
              printDate={applied.printDate}
              onLocate={r => mapRef.current?.flyTo([r.lat, r.lng], 16)}
              emptyText="Nothing to rank for this period."
            />
          </div>
        </>
      )}
    </ReportFrame>
  )
}
