import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import TachoGraph from '../../components/reports/TachoGraph'
import LocationMapModal from '../../components/reports/LocationMapModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton } from '../../components/reports/controls'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { useFlespiData } from '../../hooks/useFlespiData'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { formatDateTime, formatDateLabel, formatTime, formatPrintDate } from '../../utils/movementReport'
import { resolveRowLocations } from '../../utils/reportLocations'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { IS_REAL } from '../../data/mode'
import { PRESETS, presetRange, dateStr, timeStr, startOfDay } from '../../utils/reportRange'
import { TACHO_FIELDS, MAX_TACHO_DAYS, buildTacho, summarize, thinReadings, byLocalDay, eventFlags } from '../../utils/tacho'
import { hms, km } from '../../utils/usageReports'

/**
 * Tacho Graph and Tacho Data (client list 2026-11-10, after Ctrack MaXx's
 * Tacho Analysis — Ctrack-Reports-Catalog.md §3.10). One page, two variants:
 *
 *   graph — one vehicle, up to 7 days: Speed, RPM, Distance and Trips lanes on
 *           one time axis (components/reports/TachoGraph.jsx).
 *   data  — one or more vehicles: the same readings listed message by message,
 *           optionally one per N minutes.
 *
 * Both read the per-message series of utils/tacho.js. None of the trackers on
 * this account sends engine RPM (probed 2026-11-10), so the RPM lane carries a
 * note and the RPM column a dash — nothing is made up to fill them.
 *
 * Addresses (data): a week of readings is thousands of rows, too many to look
 * up. By default only the rows that are events get an address — the first and
 * last reading of each day and every ignition switch, i.e. where each trip
 * started and ended. The rest show coordinates, and every row opens on the
 * map. "Every row" looks up the lot, up to the same budget as the Usage reports.
 *
 * Scope: vehicles come from useFlespiData(), already narrowed to what the
 * signed-in user may see.
 */

const VARIANTS = {
  graph: {
    title: 'Tacho Graph Report',
    file: 'Tacho_Graph',
    desc: 'Speed, engine RPM, distance and trips of one vehicle against time. Point at the graph to read any moment; drag to zoom.',
  },
  data: {
    title: 'Tacho Data Report',
    file: 'Tacho_Data_Report',
    desc: 'The tracker readings message by message: speed, RPM, odometer, ignition, satellites and place.',
  },
}

// Every preset of the other reports that fits in seven days.
const TACHO_PRESETS = PRESETS.filter(p => p.key !== 'd30')

const INTERVALS = [
  { sec: 0,    label: 'Every message' },
  { sec: 60,   label: 'One per minute' },
  { sec: 300,  label: 'One per 5 minutes' },
  { sec: 900,  label: 'One per 15 minutes' },
  { sec: 1800, label: 'One per 30 minutes' },
  { sec: 3600, label: 'One per hour' },
]

const ADDRESS_MODES = [
  { key: 'events', label: 'Ignition on/off rows' },
  { key: 'all',    label: 'Every row (slower)' },
]

// columns: [{ key, label, width, pdf, align?, locate? }]
const DATA_COLUMNS = [
  { key: 'time',     label: 'Time',          width: '9%',  pdf: 8 },
  { key: 'speed',    label: 'Speed (km/h)',  width: '7%',  pdf: 6, align: 'right' },
  { key: 'rpm',      label: 'RPM',           width: '6%',  pdf: 5, align: 'right' },
  { key: 'odo',      label: 'Odometer (km)', width: '9%',  pdf: 8, align: 'right' },
  { key: 'ignition', label: 'Ignition',      width: '6%',  pdf: 5 },
  { key: 'sats',     label: 'Satellites',    width: '6%',  pdf: 5, align: 'right' },
  { key: 'location', label: 'Location',      width: '57%', pdf: 52, locate: true },
]

// The graph's Excel: every reading in the window, at full resolution.
const GRAPH_EXPORT_COLUMNS = [
  { key: 'time',     label: 'Time',              width: 11 },
  { key: 'speed',    label: 'Speed (km/h)',      width: 6 },
  { key: 'rpm',      label: 'RPM',               width: 5 },
  { key: 'distance', label: 'Distance (km)',     width: 7 },
  { key: 'odo',      label: 'Odometer (km)',     width: 7 },
  { key: 'ignition', label: 'Ignition',          width: 5 },
  { key: 'sats',     label: 'Satellites',        width: 5 },
  { key: 'lat',      label: 'Latitude',          width: 7 },
  { key: 'lng',      label: 'Longitude',         width: 7 },
]

// A list longer than this stops there: the browser cannot lay out a table of
// a week of ten vehicles' every message, and nobody reads one. The note says
// how to see the rest (thin it, or fewer vehicles or days).
const MAX_ROWS = 10_000

const round = v => (Number.isFinite(v) ? Math.round(v) : '—')
const ignText = v => (v === true ? 'On' : v === false ? 'Off' : '—')
const band = (key, label) => ({ kind: 'band', key, label })
const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—')
const tsOf = (date, time, sec) => Math.floor(new Date(`${date}T${time}:${sec}`).getTime() / 1000)
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

export default function TachoReport({ variant, ...props }) {
  // Both routes render this page; the key starts each report afresh rather
  // than carrying one's vehicles and result into the other.
  const v = variant === 'data' ? 'data' : 'graph'
  return <TachoPage key={v} variant={v} {...props} />
}

function TachoPage({ variant, ...props }) {
  const base = VARIANTS[variant]
  // Oil & Gas opens the graph as "Tacho Graph"; the title and file name follow.
  const title = useReportTitle(base.title)
  const V = useMemo(() => (title === base.title ? base : { ...base, title, file: fileNameOf(title) }), [base, title])
  const isGraph = variant === 'graph'
  const { data } = useFlespiData()
  // Keyed on what the report uses (ids and names), not on each live poll's new array.
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(
    () => liveVehicles.slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehiclesKey]
  )
  const vehicleName = v => v?.master?.plateNo || v?.name || ''

  const now = useRef(new Date()).current
  const [graphId, setGraphId] = useState(null)       // graph: the one vehicle (first by default)
  const [selectedIds, setSelectedIds] = useState(null) // data: null = all
  const [preset, setPreset] = useState('today')
  const [fromDate, setFromDate] = useState(() => dateStr(startOfDay(now)))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [intervalSec, setIntervalSec] = useState(0)
  const [addressMode, setAddressMode] = useState('events')

  const [raw, setRaw] = useState(null)        // { byDevice, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const busy = progress !== null

  const graphVehicleId = vehicles.some(v => v.id === graphId) ? graphId : vehicles[0]?.id ?? null
  const allIds = vehicles.map(v => v.id)
  const effectiveIds = isGraph ? (graphVehicleId === null ? [] : [graphVehicleId]) : (selectedIds ?? allIds)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => tsOf(fromDate, fromTime, '00'), [fromDate, fromTime])
  const toTs = useMemo(() => tsOf(toDate, toTime, '59'), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_TACHO_DAYS

  const selectionLabel = isGraph
    ? vehicleName(vehicles.find(v => v.id === graphVehicleId)) || '—'
    : allSelected ? `All (${vehicles.length})`
      : effectiveIds.length === 0 ? 'Select vehicles'
        : effectiveIds.length === 1 ? (vehicleName(vehicles.find(v => v.id === effectiveIds[0])) || '1 vehicle')
          : `${effectiveIds.length} vehicles`

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
    const current = selectedIds ?? allIds
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedIds(next.length === vehicles.length ? null : next)
  }

  const run = useCallback(async (ids, from, to, label) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: 'Generating report...' })
    try {
      const byDevice = await fetchFleetMessages(ids, from, to, {
        fields: TACHO_FIELDS,
        signal: controller.signal,
        onStatus: text => setProgress({ text }),
      })
      if (controller.signal.aborted) return
      setRaw({ byDevice, applied: { ids, fromTs: from, toTs: to, selectionLabel: label, printDate: formatPrintDate() } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setProgress(null)
      }
    }
  }, [])

  const canGenerate = !busy && rangeValid && !rangeTooLong && effectiveIds.length > 0
  const generate = () => { if (canGenerate) run(effectiveIds, fromTs, toTs, selectionLabel) }
  const cancel = () => abortRef.current?.abort()

  const applied = raw?.applied

  // ‹ Day / Day ›: the whole day before the period or after it (up to now),
  // for the vehicle on screen.
  const today = startOfDay(new Date())
  const canNextDay = !!applied && startOfDay(new Date(applied.toTs * 1000)) < today
  const stepDay = dir => {
    if (!applied) return
    const day = startOfDay(new Date((dir < 0 ? applied.fromTs : applied.toTs) * 1000))
    day.setDate(day.getDate() + dir)
    if (day > today) return
    const isToday = day.getTime() === today.getTime()
    const d = dateStr(day)
    const end = isToday ? timeStr(new Date()) : '23:59'
    setFromDate(d)
    setToDate(d)
    setFromTime('00:00')
    setToTime(end)
    setPreset(isToday ? 'today' : 'custom')
    setGraphId(applied.ids[0])
    run(applied.ids, tsOf(d, '00:00', '00'), tsOf(d, end, '59'), applied.selectionLabel)
  }

  const graphTacho = useMemo(
    () => (isGraph && raw ? buildTacho(raw.byDevice.get(raw.applied.ids[0])?.messages ?? []) : null),
    [isGraph, raw]
  )

  const exportGraph = view => {
    const name = applied.selectionLabel
    const t = graphTacho
    const s = summarize(t, view[0], view[1])
    const rows = t.points.filter(p => p.ts >= view[0] && p.ts <= view[1]).map(p => ({
      time: formatDateTime(p.ts), speed: round(p.speed), rpm: t.hasRpm && p.rpm !== null ? round(p.rpm) : '—',
      distance: km(p.km), odo: p.odo !== null ? km(p.odo) : '—', ignition: ignText(p.ign), sats: p.sats ?? '—',
      lat: p.lat !== null ? p.lat.toFixed(6) : '—', lng: p.lng !== null ? p.lng.toFixed(6) : '—',
    }))
    exportGeoZoneExcel({
      title: V.title,
      subtitle: 'FleetmaxX',
      filtersText: `Vehicle: ${name}     From Date: ${formatDateTime(view[0])}     To Date: ${formatDateTime(view[1])}`,
      printDate: formatPrintDate(),
      systemName: 'FleetmaxX',
      summaryCards: [
        { label: 'Distance (km)', value: km(s.distanceKm) },
        { label: 'Drive time', value: hms(s.driveSec) },
        { label: 'Max speed (km/h)', value: round(s.maxSpeed) },
        { label: 'Trips', value: s.trips },
        { label: 'Max RPM', value: t.hasRpm ? round(s.maxRpm) : 'Not sent' },
      ],
      tables: [{ heading: name, columns: GRAPH_EXPORT_COLUMNS, rows }],
    }, V.file)
  }

  const truncated = raw && [...raw.byDevice.values()].some(e => e?.truncated)

  return (
    <ReportFrame title={V.title} desc={V.desc} {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {TACHO_PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          {isGraph ? (
            <div>
              <label style={LABEL} htmlFor="tacho-vehicle">VEHICLE</label>
              <select id="tacho-vehicle" style={FIELD} value={graphVehicleId ?? ''} disabled={vehicles.length === 0}
                onChange={e => setGraphId(Number(e.target.value))}>
                {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleName(v)}</option>)}
              </select>
            </div>
          ) : (
            <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
              <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All vehicles</strong></CheckRow>
              <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
              {vehicles.map(v => (
                <CheckRow key={v.id} checked={effectiveIds.includes(v.id)} onChange={() => toggleVehicle(v.id)}
                  note={v.master?.plateNo && v.master.plateNo !== v.name ? v.name : null}>
                  {vehicleName(v)}
                </CheckRow>
              ))}
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
          {!isGraph && (
            <>
              <div>
                <label style={LABEL} htmlFor="tacho-interval">READINGS</label>
                <select id="tacho-interval" style={FIELD} value={intervalSec} onChange={e => setIntervalSec(Number(e.target.value))}>
                  {INTERVALS.map(o => <option key={o.sec} value={o.sec}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={LABEL} htmlFor="tacho-addresses">ADDRESSES FOR</label>
                <select id="tacho-addresses" style={FIELD} value={addressMode} onChange={e => setAddressMode(e.target.value)}>
                  {ADDRESS_MODES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {rangeTooLong && <span style={{ fontSize: 11.5, color: '#ef4444' }}>Choose {MAX_TACHO_DAYS} days or fewer.</span>}
          {busy && <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>}
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            style={{
              padding: '9px 20px', borderRadius: 8, border: 'none',
              background: canGenerate || busy ? 'var(--ft-accent)' : 'color-mix(in srgb, var(--ft-accent) 45%, #fff)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: canGenerate ? 'pointer' : 'not-allowed', opacity: busy ? 0.85 : 1,
            }}
          >
            {busy ? progress.text : 'Generate Report'}
          </button>
        </div>
      </div>

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {raw && truncated && (
        <div className="report-screen-only" style={{ fontSize: 12, color: '#f97316', marginBottom: 10 }}>
          Some days hit the message limit — choose fewer days for full detail.
        </div>
      )}

      {raw && isGraph && graphTacho && (
        <TachoGraph
          key={`${applied.ids[0]}-${applied.fromTs}-${applied.toTs}`}
          tacho={graphTacho}
          fromTs={applied.fromTs}
          toTs={applied.toTs}
          vehicleName={applied.selectionLabel}
          printDate={applied.printDate}
          onDay={stepDay}
          canNextDay={canNextDay}
          busy={busy}
          onExport={exportGraph}
        />
      )}

      {raw && !isGraph && (
        <TachoData raw={raw} vehicles={vehicles} intervalSec={intervalSec} addressMode={addressMode} V={V} />
      )}
    </ReportFrame>
  )
}

/** The Tacho Data paper: vehicles → a band per day → one row per reading. */
function TachoData({ raw, vehicles, intervalSec, addressMode, V }) {
  const [hiddenCols, setHiddenCols] = useHiddenColumns('tacho-data')
  const shownCols = useVisibleColumns(DATA_COLUMNS, hiddenCols)
  const [geoTick, setGeoTick] = useState(0)
  const [geoProgress, setGeoProgress] = useState(null) // { done, total } while addresses load
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const { applied } = raw

  // Building the series is the heavy part; the reading interval only thins it.
  const series = useMemo(() => applied.ids.map(id => {
    const vehicle = vehicles.find(v => v.id === id)
    return { deviceId: id, name: vehicle?.master?.plateNo || vehicle?.name || String(id), tacho: buildTacho(raw.byDevice.get(id)?.messages ?? []) }
  }).sort((a, b) => a.name.localeCompare(b.name)), [raw, applied, vehicles])

  const built = useMemo(() => {
    let shown = 0
    let total = 0
    const groups = series.map(({ deviceId, name, tacho }) => {
      const kept = thinReadings(tacho.points, intervalSec)
      total += kept.length
      const rows = []
      let ign = null
      for (const d of byLocalDay(kept)) {
        if (shown >= MAX_ROWS) break
        const dayFrom = Math.floor(startOfDay(d.date).getTime() / 1000)
        const s = summarize(tacho, dayFrom, dayFrom + 86399)
        rows.push(band(`d-${d.key}`, `${formatDateLabel(d.date)}   ·   ${plural(d.points.length, 'reading')}   ·   ${km(s.distanceKm)} km   ·   Max ${round(s.maxSpeed)} km/h`))
        const events = eventFlags(d.points)
        d.points.forEach((p, i) => {
          if (shown >= MAX_ROWS) return
          shown += 1
          const switched = p.ign !== null && ign !== null && p.ign !== ign
          if (p.ign !== null) ign = p.ign
          rows.push({
            key: p.ts, ts: p.ts, lat: p.lat, lng: p.lng, vehicle: name, event: events[i],
            time: formatTime(p.ts),
            speed: round(p.speed),
            rpm: tacho.hasRpm && p.rpm !== null ? round(p.rpm) : '—',
            // The tracker's own odometer where it sends one; otherwise the
            // distance since the start of the period (said in the group bar).
            odo: tacho.hasOdometer ? (p.odo !== null ? km(p.odo) : '—') : km(p.km),
            ignition: ignText(p.ign),
            sats: p.sats ?? '—',
            cellStyle: switched ? { ignition: { fontWeight: 700 } } : undefined,
          })
        })
      }
      const s = summarize(tacho)
      const parts = [
        intervalSec ? `${plural(kept.length, 'reading')} of ${plural(tacho.points.length, 'message')}` : plural(kept.length, 'reading'),
        `${km(s.distanceKm)} km`, `Drive ${hms(s.driveSec)}`, `Trips ${s.trips}`, `Max ${round(s.maxSpeed)} km/h`,
      ]
      if (tacho.hasRpm) parts.push(`Max RPM ${round(s.maxRpm)}`)
      return {
        key: deviceId,
        label: tacho.hasOdometer || !tacho.points.length ? name : `${name}   ·   this tracker sends no odometer: Odometer is km since the start of the period`,
        rows,
        total: `Vehicle Total   ·   ${parts.join('   ·   ')}`,
      }
    })
    return { groups, shown, total, anyRpm: series.some(v => v.tacho.hasRpm) }
  }, [series, intervalSec])

  useEffect(() => {
    const controller = new AbortController()
    const rows = built.groups.flatMap(g => g.rows).filter(r => r.kind !== 'band' && (addressMode === 'all' || r.event))
    resolveRowLocations([{ rows }], {
      limit: IS_REAL ? 2000 : 200,
      signal: controller.signal,
      onChunk: (done, total) => {
        if (controller.signal.aborted) return
        setGeoTick(t => t + 1)
        setGeoProgress(done < total ? { done, total } : null)
      },
    })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setGeoProgress(null) })
    return () => controller.abort()
  }, [built, addressMode])

  const groups = useMemo(() => built.groups.map(g => ({
    ...g,
    rows: g.rows.map(r => {
      if (r.kind === 'band') return r
      const location = r.locationText || coords(r.lat, r.lng)
      return { ...r, location, mapUrl: r.lat != null ? locationUrl({ lat: r.lat, lng: r.lng, vehicle: r.vehicle, address: location }) : undefined }
    }),
  // geoTick: resolveRowLocations fills the address text in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [built, geoTick])

  const filters = [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Readings', INTERVALS.find(o => o.sec === intervalSec)?.label ?? 'Every message'],
    ['Addresses for', ADDRESS_MODES.find(o => o.key === addressMode)?.label],
  ]

  const exportOpts = () => ({
    title: V.title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied.printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.locate ? 'mapUrl' : undefined })),
      // Day bands become a row whose first cell carries the text.
      rows: g.rows, // date/total bands print as the Movement PDF's yellow bands
    })),
  })

  const { shown, total } = built
  return (
    <>
      <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--c-text2)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--c-text1)' }}>{shown.toLocaleString()}</strong> row{shown === 1 ? '' : 's'}
          {' · '}{plural(series.length, 'vehicle')}
          {shown < total && <span style={{ color: '#f97316' }}> · showing the first {MAX_ROWS.toLocaleString()} of {total.toLocaleString()} readings — choose fewer readings per hour, fewer vehicles or fewer days to see the rest</span>}
          {!built.anyRpm && <span style={{ color: 'var(--c-text3)' }}> · these trackers do not send engine RPM</span>}
          {geoProgress && <span style={{ color: 'var(--ft-accent)' }}> · Resolving addresses {geoProgress.done}/{geoProgress.total}…</span>}
          {addressMode === 'events' && <div style={{ color: 'var(--c-text3)', fontSize: 11.5 }}>Addresses are looked up where the ignition switched and for each day's first and last reading; other rows show coordinates. Click any location to see it on the map.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ColumnPicker columns={DATA_COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
          <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), V.file)} icon={FileDown} primary disabled={!shown}>Download PDF</ToolbarButton>
          <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), V.file)} icon={FileSpreadsheet} disabled={!shown}>Download Excel</ToolbarButton>
          <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!shown}>Print</ToolbarButton>
        </div>
      </div>

      <PaperTable
        title={V.title}
        company="FleetmaxX"
        filters={filters}
        columns={shownCols}
        groups={groups}
        printDate={applied.printDate}
        onLocate={r => setLocated({ lat: r.lat, lng: r.lng, ts: r.ts, vehicleId: r.vehicle, status: V.title, location: r.location })}
        emptyText="No messages in this period for the selected vehicles."
      />

      <LocationMapModal point={located} onClose={closeLocated} />
    </>
  )
}
