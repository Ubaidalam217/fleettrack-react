import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import CtrackPaper from '../../components/reports/CtrackPaper'
import EventTrackModal from '../../components/reports/EventTrackModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, ReportByToggle, DriverMultiSelect } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import {
  useAlerts, useDrivers, useGeofences, useVehicles as useRegisteredVehicles, alertTypeLabel, branchNameFor, imeiKey,
} from '../../data/settings'
import { fetchAlertEventsInRange, REPORT_EVENT_LIMIT } from '../../data/alertEvents'
import { IS_REAL } from '../../data/mode'
import { fetchMovementMessages, isAbortError } from '../../utils/movementReport'
import { resolveRowLocations } from '../../utils/reportLocations'
import { locationUrl } from '../../utils/mapLink'
import { pointInGeofence } from '../../utils/geoZoneEngine'
import { exportCtrackPdf, exportCtrackExcel } from '../../utils/ctrackExport'
import { driverFilterLabel } from '../../utils/driverAtTime'
import {
  buildViolations, violationNames, detailDays, summaryDays, statisticsDays, violationTotals,
  ctrackTime, ctrackDateTime, hhmmss,
} from '../../utils/violationReports'
import { ReportSkeleton } from '../../components/Skeleton'

/**
 * Violation Details, Violation Locations, Violations Summary and Violation
 * Statistics — the client's Ctrack samples (2026-11-13: "exactly like these"),
 * one page with a variant each, on the Ctrack paper of Trip Details
 * (components/reports/CtrackPaper.jsx, utils/ctrackExport.js).
 *
 * The violations are the alert engine's events (GET /api/alert-events) with
 * their From / To / Duration / Speed from utils/violationEpisodes.js; the
 * vehicles' messages are read once for the range (one fleet read per day) for
 * the spans of older events, the speed at an instant event and the driver at
 * that moment. Changing the Violations filter never fetches again.
 *
 * Scope: alerts come from the API and vehicles from useFlespiData(), both
 * already narrowed to what the signed-in user may see.
 */

const MAX_RANGE_DAYS = 31
const DAY_MS = 86_400_000

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'lastWeek',  label: 'Last Week' },
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'd30',       label: 'Last 30 days' },
  { key: 'custom',    label: 'Custom' },
]

const pad = n => String(n).padStart(2, '0')
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
function startOfWeek(d) {
  const s = startOfDay(d)
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}
function presetRange(key, now = new Date()) {
  const today = startOfDay(now)
  switch (key) {
    case 'today':     return { from: today, to: now, toEndOfDay: false }
    case 'yesterday': { const y = new Date(today.getTime() - DAY_MS); return { from: y, to: y, toEndOfDay: true } }
    case 'thisWeek':  return { from: startOfWeek(now), to: now, toEndOfDay: false }
    case 'lastWeek':  {
      const thisMon = startOfWeek(now)
      return { from: new Date(thisMon.getTime() - 7 * DAY_MS), to: new Date(thisMon.getTime() - DAY_MS), toEndOfDay: true }
    }
    case 'd7':  return { from: new Date(today.getTime() - 6 * DAY_MS), to: now, toEndOfDay: false }
    case 'd30': return { from: new Date(today.getTime() - 29 * DAY_MS), to: now, toEndOfDay: false }
    default:    return null
  }
}

// Column weights measured off the samples; the screen gets the same shares.
const MAP = { key: 'map', label: '', pdf: 4, icon: 'map', locate: true }
const COLS = {
  driver:   { key: 'driver',   label: 'Driver',             pdf: 17 },
  site:     { key: 'site',     label: 'Site',               pdf: 11 },
  event:    { key: 'event',    label: 'Event',              pdf: 16 },
  from:     { key: 'from',     label: 'From',               pdf: 7 },
  to:       { key: 'to',       label: 'To',                 pdf: 7 },
  location: { key: 'location', label: 'Location',           pdf: 17 },
  duration: { key: 'duration', label: 'Duration',           pdf: 7, align: 'right' },
  speed:    { key: 'speed',    label: 'Speed (Kph)',        pdf: 7, align: 'right' },
  asset:    { key: 'asset',    label: 'Asset',              pdf: 17 },
  eventDuration: { key: 'eventDuration', label: 'Event Duration', pdf: 8, align: 'right' },
  count:    { key: 'count',    label: 'No. of Occurrences', pdf: 8, align: 'right' },
  maxSpeed: { key: 'maxSpeed', label: 'Max Speed (Kph)',    pdf: 7, align: 'right' },
  category: { key: 'category', label: 'Category',           pdf: 52 },
  violations: { key: 'violations', label: 'Violations',     pdf: 20, align: 'right' },
  violationDuration: { key: 'violationDuration', label: 'Violation Duration', pdf: 26, align: 'right' },
}

const VARIANTS = {
  details: {
    title: 'Violation Details',
    desc: 'Every violation of each day: driver, site, event, from, to, duration, speed and asset.',
    orientation: 'landscape',
    columns: by => (by === 'driver'
      ? ['driver', 'site', 'event', 'from', 'to', 'duration', 'speed', 'asset']
      : ['asset', 'site', 'event', 'from', 'to', 'duration', 'speed', 'driver']),
    map: true,
  },
  locations: {
    title: 'Violation Locations',
    desc: 'Every violation of each day with where it happened, and the day’s total.',
    orientation: 'landscape',
    columns: by => (by === 'driver'
      ? ['driver', 'site', 'event', 'from', 'to', 'location', 'duration', 'speed', 'asset']
      : ['asset', 'site', 'event', 'from', 'to', 'location', 'duration', 'speed', 'driver']),
    map: true,
    locations: true,
  },
  summary: {
    title: 'Violations Summary',
    desc: 'Each day, one line per driver, asset and event: how long, how many and the top speed.',
    orientation: 'portrait',
    columns: by => (by === 'driver'
      ? ['driver', 'site', 'asset', 'event', 'eventDuration', 'count', 'maxSpeed']
      : ['asset', 'site', 'driver', 'event', 'eventDuration', 'count', 'maxSpeed']),
  },
  statistics: {
    title: 'Violation Statistics',
    desc: 'Each day, how many violations and how long per driver category (department) or per site.',
    orientation: 'portrait',
    columns: () => ['category', 'violations', 'violationDuration'],
  },
}

function columnsFor(V, by) {
  const cols = [...V.columns(by).map(k => COLS[k]), ...(V.map ? [MAP] : [])]
  const total = cols.reduce((s, c) => s + c.pdf, 0)
  return cols.map(c => ({ ...c, width: `${((c.pdf / total) * 100).toFixed(2)}%` }))
}

const speedText = v => (v == null ? '' : String(Math.round(v)))
const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '')

/** One violation as a Details / Locations row. */
function detailRow(v) {
  const location = v.locationText ? v.locationText.replace(/;\s*$/, '') : coords(v.lat, v.lng) || 'N/A'
  return {
    key: v.key,
    driver: v.driver, site: v.site, event: v.event, asset: v.asset,
    from: ctrackTime(v.fromTs), to: ctrackTime(v.toTs), duration: hhmmss(v.durationSec), speed: speedText(v.speed),
    location,
    lat: v.lat, lng: v.lng,
    mapUrl: locationUrl({ lat: v.lat, lng: v.lng, vehicle: v.asset, time: ctrackDateTime(v.fromTs), address: location }),
    // For the map dialog (EventTrackModal).
    deviceId: v.deviceId, type: v.type, ts: v.fromTs, toTs: v.toTs, value: v.value, message: v.message, severity: v.severity,
  }
}

/** The tables, summary and row count a variant shows. */
function buildTables(variantKey, built, by) {
  const firstCol = by === 'driver' ? 'driver' : 'asset'
  if (variantKey === 'details' || variantKey === 'locations') {
    const tables = built.days.map(d => ({
      key: d.dayKey,
      heading: d.label,
      headingItalic: true,
      rows: [
        ...d.rows.map(detailRow),
        // Violation Locations closes each day with a Total line; Details has its summary page.
        ...(variantKey === 'locations' ? [{
          key: `total-${d.dayKey}`, strong: true, event: 'Total:', from: String(d.totals.count),
          duration: hhmmss(d.totals.durationSec), speed: speedText(d.totals.maxSpeed), cellAlign: { from: 'center' },
        }] : []),
      ],
    }))
    const t = built.totals
    const summary = variantKey === 'details' ? [
      { label: 'Total Events Count', value: String(t.count) },
      { label: 'Total Events Duration', value: hhmmss(t.durationSec) },
      { label: 'Max Speed (Kph)', value: speedText(t.maxSpeed) || '0' },
    ] : []
    return { tables, summary, rows: t.count }
  }

  if (variantKey === 'summary') {
    const tables = built.days.map(d => ({
      key: d.dayKey,
      heading: `Day : ${d.label}`,
      rows: [
        ...d.lines.map(l => ({
          key: l.key, driver: l.driver, site: l.site, asset: l.asset, event: l.event,
          eventDuration: hhmmss(l.durationSec), count: String(l.count), maxSpeed: speedText(l.maxSpeed) || '0',
        })),
        {
          key: `total-${d.dayKey}`, strong: true, event: String(d.totals.lines),
          eventDuration: hhmmss(d.totals.durationSec), count: String(d.totals.count), cellAlign: { event: 'center' },
        },
      ],
    }))
    const t = built.totals
    if (tables.length) {
      tables[tables.length - 1].rows.push({
        key: 'report-summary', strong: true, [firstCol]: 'Report Summary:', event: String(t.events),
        eventDuration: hhmmss(t.durationSec), count: String(t.count), cellAlign: { event: 'center' },
      })
    }
    return { tables, summary: [], rows: t.count }
  }

  const tables = built.days.map(d => ({
    key: d.dayKey,
    heading: `Day : ${d.label}`,
    rows: d.categories.map(c => ({
      key: c.key, category: c.category, violations: String(c.count), violationDuration: hhmmss(c.durationSec),
    })),
  }))
  return { tables, summary: [], rows: built.totals.count }
}

export default function ViolationReportPage({ variant = 'details', ...props }) {
  const V = VARIANTS[variant] ?? VARIANTS.details
  const title = useReportTitle(V.title)
  const { data } = useFlespiData()
  const vehicles = useMemo(
    () => (data?.vehicles ?? []).slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    [data]
  )
  const rules = useAlerts()
  const drivers = useDrivers()
  const geofences = useGeofences()
  const registered = useRegisteredVehicles()
  const driverDim = useDriverDimension()

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('today')
  const [fromDate, setFromDate] = useState(() => dateStr(startOfDay(now)))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  // Report By: Vehicle or Driver — Ctrack's "Group By Entity". Driver covers every vehicle.
  const [reportBy, setReportBy] = useState('driver')
  const [driverPick, setDriverPick] = useState(null) // null = every driver
  const [names, setNames] = useState(null)           // null = every violation (not ignition / geo zone enter-exit)

  const [raw, setRaw] = useState(null)               // { events, byDevice, truncated, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const [geoProgress, setGeoProgress] = useState(null)
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const abortRef = useRef(null)
  const busy = progress !== null
  const driverMode = reportBy === 'driver'
  const driverFilter = driverMode ? driverPick : null

  const effectiveIds = driverMode ? vehicles.map(v => v.id) : (selectedIds ?? vehicles.map(v => v.id))
  const allSelected = driverMode || selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const vehicleName = v => v.master?.plateNo || v.name
  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicleName(vehicles.find(v => v.id === effectiveIds[0]) ?? {}) || '1 vehicle')
        : `${effectiveIds.length} vehicles`

  // The Violations filter: the account's rules and whatever names the events carry.
  const nameOptions = useMemo(() => violationNames(raw?.events ?? [], rules, alertTypeLabel), [raw, rules])
  const defaultNames = useMemo(() => new Set(nameOptions.filter(n => n.byDefault).map(n => n.name)), [nameOptions])
  const picked = names ?? defaultNames
  const namesLabel = !names ? 'All violations' : names.size === 0 ? 'None' : names.size === 1 ? [...names][0] : `${names.size} selected`
  const toggleName = name => {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name); else next.add(name)
    const same = next.size === defaultNames.size && [...next].every(n => defaultNames.has(n))
    setNames(same ? null : next)
  }

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

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: 'Loading violations...' })
    const applied = { fromTs, toTs, selectionLabel, reportBy, printDate: ctrackDateTime(Math.floor(Date.now() / 1000)) }
    try {
      const { events, truncated } = await fetchAlertEventsInRange({ fromTs, toTs, deviceIds: effectiveIds })
      if (controller.signal.aborted) return
      // Tracking only for the vehicles that had an alert: one fleet read per day.
      const withAlerts = [...new Set(events.map(e => e.deviceId).filter(id => id != null))]
      let byDevice = null
      if (withAlerts.length) {
        setProgress({ text: 'Loading tracking for the violations...' })
        byDevice = await fetchMovementMessages(withAlerts, fromTs, toTs, { signal: controller.signal })
      }
      if (controller.signal.aborted) return
      setRaw({ events, byDevice, truncated, applied })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel, reportBy])

  const cancel = () => abortRef.current?.abort()

  const violations = useMemo(() => {
    if (!raw) return null
    const regByImei = new Map((registered ?? []).map(r => [imeiKey(r.imei), r]))
    const siteOf = meta => {
      const reg = regByImei.get(imeiKey(meta?.ident))
      return reg?.branchId ? branchNameFor(reg.branchId) : ''
    }
    const deptById = new Map((drivers ?? []).map(d => [`d:${d.id}`, d.department || '']))
    // Zone speed: its zone is the geofence its message names ("… in Yard 1: …").
    const fences = [...(geofences ?? [])].filter(g => g.name).sort((a, b) => b.name.length - a.name.length)
    const zoneFor = e => {
      const g = fences.find(f => String(e.message ?? '').includes(`in ${f.name}`))
      if (!g) return null
      return m => {
        const lat = m['position.latitude'], lng = m['position.longitude']
        return typeof lat !== 'number' || typeof lng !== 'number' || pointInGeofence(lat, lng, g)
      }
    }
    return buildViolations(raw.events, raw.byDevice, {
      vehicles, rules, typeLabel: alertTypeLabel, names,
      driverAt: driverDim.timelineFor, assignedFor: driverDim.assignedFor, driverFilter,
      siteOf, departmentOf: who => deptById.get(who.key) ?? '', zoneFor,
    })
  }, [raw, vehicles, rules, names, driverDim, driverFilter, registered, drivers, geofences])

  const built = useMemo(() => {
    if (!violations) return null
    const by = raw.applied.reportBy
    const totals = violationTotals(violations)
    if (variant === 'summary') return { days: summaryDays(violations), totals }
    if (variant === 'statistics') return { days: statisticsDays(violations, { by }), totals }
    return { days: detailDays(violations, { by }), totals }
  }, [violations, variant, raw])

  // Violation Locations: the addresses fill in behind the table.
  useEffect(() => {
    if (!built || !V.locations) return
    const controller = new AbortController()
    resolveRowLocations(built.days, {
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
  }, [built, V.locations])

  const applied = raw?.applied
  const by = applied?.reportBy ?? reportBy
  const columns = useMemo(() => columnsFor(V, by), [V, by])
  const paper = useMemo(
    () => (built ? buildTables(variant, built, by) : { tables: [], summary: [], rows: 0 }),
    // geoTick: resolveRowLocations fills the addresses in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [built, variant, by, geoTick]
  )
  const tables = paper.tables.map(t => ({ ...t, columns }))

  const pairs = useMemo(() => {
    if (!applied) return []
    const entity = variant === 'statistics'
      ? (by === 'driver' ? 'Driver Category' : 'Site')
      : (by === 'driver' ? 'Driver' : 'Asset')
    const extra = []
    if (by === 'driver' && driverPick) extra.push(['Drivers', driverFilterLabel(driverPick, driverDim.options)])
    if (by !== 'driver' && !/^All\b/.test(applied.selectionLabel ?? '')) extra.push(['Assets', applied.selectionLabel])
    if (names) {
      // Said against the default ("every violation"), so a one-tick change stays one line.
      const added = [...names].filter(n => !defaultNames.has(n))
      const left = [...defaultNames].filter(n => !names.has(n))
      const text = names.size === 0 ? 'None'
        : names.size <= 3 ? [...names].join(', ')
          : `All${left.length ? ` except ${left.join(', ')}` : ''}${added.length ? ` + ${added.join(', ')}` : ''}`
      extra.push(['Violations', text])
    }
    const from = ['From', ctrackDateTime(applied.fromTs)]
    const to = ['To', ctrackDateTime(applied.toTs)]
    // Details / Locations: "From | Group By Entity", "To | Group By Date". Summary /
    // Statistics: From and To on lines of their own, then the two Grouped By.
    const head = variant === 'details' || variant === 'locations'
      ? [from, ['Group By Entity', entity], to, ['Group By Date', 'Day']]
      : [from, null, to, null, ['Grouped By Entity', entity], ['Grouped By', 'Day']]
    return [...head, ...extra]
  }, [applied, variant, by, driverPick, driverDim.options, names, defaultNames])

  const exportOpts = () => ({
    title,
    orientation: V.orientation,
    printDate: applied?.printDate,
    pairs,
    tables: tables.map(t => ({
      ...t,
      columns: t.columns.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, icon: c.icon, hrefKey: c.locate ? 'mapUrl' : undefined })),
    })),
    summaryTitle: 'Report Summary:',
    summary: paper.summary,
    zebraStart: false,
    zebraContinue: true,
  })
  const file = fileNameOf(title)
  const total = paper.rows
  const truncated = raw?.byDevice && [...raw.byDevice.values()].some(e => e?.truncated)

  return (
    <ReportFrame title={title} desc={V.desc} {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <ReportByToggle id={`violation-${variant}-report-by`} value={reportBy} onChange={v => { setReportBy(v); setRaw(null) }} />
          {driverMode ? (
            <DriverMultiSelect options={driverDim.options} value={driverPick} onChange={setDriverPick} />
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
          <MultiSelect label="VIOLATIONS" summary={namesLabel}>
            <CheckRow checked={!names} onChange={() => setNames(null)}
              title="Every alert rule except ignition on / off and geo zone enter / exit">
              <strong>All violations</strong>
            </CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {nameOptions.length === 0 && (
              <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--c-text3)' }}>No alert rules yet.</div>
            )}
            {nameOptions.map(n => (
              <CheckRow key={n.name} checked={picked.has(n.name)} onChange={() => toggleName(n.name)} note={alertTypeLabel(n.type)}>
                {n.name}
              </CheckRow>
            ))}
          </MultiSelect>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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

      {!IS_REAL && (
        <div className="report-screen-only" style={{ fontSize: 12.5, color: 'var(--c-text3)', marginBottom: 14 }}>
          Violations are the server’s alert history, so this report is empty in demo mode.
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

      {busy && !built && <ReportSkeleton />}

      {built && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{total.toLocaleString()}</strong> violation{total === 1 ? '' : 's'}
              {' · '}{built.days.length} day{built.days.length === 1 ? '' : 's'}
              {raw.truncated && <span style={{ color: '#f97316' }}> · only the first {REPORT_EVENT_LIMIT.toLocaleString()} alerts — narrow the range for the rest</span>}
              {geoProgress && <span style={{ color: 'var(--ft-accent)' }}> · Resolving addresses {geoProgress.done}/{geoProgress.total}…</span>}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — spans there may be cut short</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportCtrackPdf(exportOpts(), file)} icon={FileDown} primary disabled={!total}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportCtrackExcel(exportOpts(), file)} icon={FileSpreadsheet} disabled={!total}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!total}>Print</ToolbarButton>
            </div>
          </div>

          <CtrackPaper
            title={title}
            pairs={pairs}
            tables={tables}
            summaryTitle="Report Summary:"
            summary={paper.summary}
            zebraStart={false}
            zebraContinue
            printDate={applied.printDate}
            onLocate={V.map ? r => setLocated({
              deviceId: r.deviceId, vehicle: r.asset, type: r.type, ts: r.ts, value: r.value, message: r.message, severity: r.severity, lat: r.lat, lng: r.lng,
              // The span this report shows, for a dialog that reads it.
              span: { startTs: r.ts, endTs: r.toTs },
            }) : undefined}
            emptyText="No violations in this period for this selection."
          />
        </>
      )}

      <EventTrackModal event={located} onClose={closeLocated} />
    </ReportFrame>
  )
}
