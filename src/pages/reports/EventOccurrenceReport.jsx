import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import EventTrackModal from '../../components/reports/EventTrackModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, ReportByToggle, DriverMultiSelect } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { ALERT_TYPES, ALERT_SEVERITIES, alertTypeLabel, driverNameForDevice } from '../../data/settings'
import { fetchAlertEventsInRange } from '../../data/alertEvents'
import { IS_REAL } from '../../data/mode'
import {
  fetchMovementMessages, resolveReportLocations, rowLocation, formatDateTime, formatPrintDate, isAbortError,
} from '../../utils/movementReport'
import { buildEventReport } from '../../utils/eventOccurrence'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { ReportSkeleton } from '../../components/Skeleton'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import { driverFilterLabel } from '../../utils/driverAtTime'

/**
 * Event Occurrence Report — client, 2026-11-02: "the same as Movement report
 * but only show alerts and tracking with alerts attached". One row per alert
 * the server raised, in the Movement Report's layout (vehicle bars, date bands,
 * zebra rows), carrying the vehicle's status, speed, distance and location at
 * that moment. See utils/eventOccurrence.js for the join.
 *
 * Scope: alerts come from GET /api/alert-events and vehicles from
 * useFlespiData(), both already narrowed to what the signed-in user may see —
 * a sub-user gets their own vehicles' alerts only.
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

const SEVERITY_COLOR = { Low: '#64748b', Medium: '#d97706', High: '#ea580c', Critical: '#dc2626' }

const COLUMNS = [
  { key: 'time',     label: 'Time',                width: '7%',  pdf: 5 },
  { key: 'alert',    label: 'Alert',               width: '10%', pdf: 8 },
  { key: 'severity', label: 'Severity',            width: '6%',  pdf: 5 },
  { key: 'message',  label: 'Details',             width: '16%', pdf: 13 },
  { key: 'status',   label: 'Status',              width: '9%',  pdf: 8 },
  { key: 'speed',    label: 'Speed (km/h)',        width: '6%',  pdf: 5, align: 'right' },
  { key: 'odo',      label: 'Cumulative Odo (km)', width: '7%',  pdf: 6, align: 'right' },
  { key: 'driverId', label: 'Driver ID',           width: '9%',  pdf: 7 },
  { key: 'location', label: 'Location',            width: '30%', pdf: 22, locate: true },
]

export default function EventOccurrenceReport(props) {
  const title = useReportTitle('Event Occurrence Report')
  const [hiddenCols, setHiddenCols] = useHiddenColumns('event-occurrence')
  const shownCols = useVisibleColumns(COLUMNS, hiddenCols)
  const { data } = useFlespiData()
  const vehicles = useMemo(
    () => (data?.vehicles ?? []).slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    [data]
  )

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('today')
  const [fromDate, setFromDate] = useState(() => dateStr(startOfDay(now)))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [types, setTypes] = useState(null)          // null = all
  const [severities, setSeverities] = useState(null) // null = all
  // Driver dimension (client, 2026-11-12): filter and Vehicle / Driver grouping.
  const driverDim = useDriverDimension()
  // Report By: Vehicle or Driver. Driver covers every vehicle and groups by driver.
  const [reportBy, setReportBy] = useState('vehicle')
  const [driverPick, setDriverPick] = useState(null) // null = every driver
  const groupBy = reportBy
  const driverFilter = reportBy === 'driver' ? driverPick : null

  const [raw, setRaw] = useState(null)        // { events, byDevice, truncated, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const abortRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = reportBy === 'driver' ? vehicles.map(v => v.id) : (selectedIds ?? vehicles.map(v => v.id))
  const allSelected = reportBy === 'driver' || selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeDays = (toTs - fromTs) / 86400
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && rangeDays > MAX_RANGE_DAYS

  const vehicleName = v => v.master?.plateNo || v.name
  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicleName(vehicles.find(v => v.id === effectiveIds[0]) ?? {}) || '1 vehicle')
        : `${effectiveIds.length} vehicles`
  const typesLabel = !types ? 'All' : types.length === 0 ? 'None' : types.map(alertTypeLabel).join(', ')
  const sevLabel = !severities ? 'All' : severities.join(', ') || 'None'

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
  const toggleIn = (list, setList, all, key) => {
    const current = list ?? all
    const next = current.includes(key) ? current.filter(x => x !== key) : [...current, key]
    setList(next.length === all.length ? null : next)
  }

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: 'Loading alerts...' })
    const applied = { fromTs, toTs, selectionLabel, printDate: formatPrintDate() }
    try {
      const { events, truncated } = await fetchAlertEventsInRange({ fromTs, toTs, deviceIds: effectiveIds })
      if (controller.signal.aborted) return
      // Tracking is only fetched for vehicles that actually had an alert.
      const withAlerts = [...new Set(events.map(e => e.deviceId).filter(id => id != null))]
      let byDevice = null
      if (withAlerts.length) {
        setProgress({ text: 'Loading tracking for the alerts...' })
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
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel])

  const cancel = () => abortRef.current?.abort()

  // Type and severity are filters over what was fetched: no new request.
  const report = useMemo(() => raw && buildEventReport(raw.events, raw.byDevice, {
    vehicles, typeLabel: alertTypeLabel, driverNameFor: driverNameForDevice, types, severities,
    driverAt: driverDim.timelineFor, driverFilter, groupBy,
  }), [raw, vehicles, types, severities, driverDim, driverFilter, groupBy])

  // Addresses fill in behind the table; the report is usable before they land.
  useEffect(() => {
    if (!report?.totalRows) return
    let live = true
    resolveReportLocations(report, { limit: IS_REAL ? 2000 : 200 })
      .then(() => { if (live) setGeoTick(t => t + 1) })
      .catch(() => {})
    return () => { live = false }
  }, [report])

  const groups = useMemo(() => {
    if (!report) return []
    return report.vehicles.map(v => ({
      key: v.sortKey ? `${v.deviceId}-${v.sortKey}` : v.deviceId,
      label: v.vehicleId,
      total: `Total Alerts : ${v.rowCount}`,
      rows: v.dates.flatMap(d => [
        { kind: 'band', key: d.dateKey, label: d.label },
        ...d.rows.map(r => {
          const location = rowLocation(r) || '—'
          return {
            ...r,
            vehicle: v.vehicleId,
            deviceId: v.deviceId,
            location,
            odo: r.odoKm != null ? r.odoKm.toFixed(3) : '—',
            dateTime: formatDateTime(r.ts),
            mapUrl: locationUrl({ lat: r.lat, lng: r.lng, vehicle: v.vehicleId, time: formatDateTime(r.ts), address: location }),
            cellStyle: { severity: { color: SEVERITY_COLOR[r.severity], fontWeight: 700 }, alert: { fontWeight: 700 } },
          }
        }),
      ]),
    }))
  // geoTick: resolveReportLocations fills `location` in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, geoTick])

  const applied = raw?.applied
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Alerts', typesLabel],
    ['Severity', sevLabel],
    ['Report By', groupBy === 'driver' ? 'Driver' : 'Vehicle'],
    ...(groupBy === 'driver' ? [['Drivers', driverFilterLabel(driverFilter, driverDim.options)]] : []),
  ] : []

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: [
        // The PDF and Excel carry the date with the time, one column.
        ...(shownCols.some(c => c.key === 'time') ? [{ key: 'dateTime', label: 'Date / Time', width: 8 }] : []),
        ...shownCols.filter(c => c.key !== 'time').map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.locate ? 'mapUrl' : undefined })),
      ],
      rows: g.rows.filter(r => r.kind !== 'band'),
    })),
  })

  const total = report?.totalRows ?? 0

  return (
    <ReportFrame
      title={title}
      desc="Every alert raised in the period, laid out like the Movement Report, with the vehicle's status, speed and location at that moment."
      {...props}
    >
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <ReportByToggle id="event-report-by" value={reportBy} onChange={v => { setReportBy(v); setRaw(null) }} />
          {reportBy === 'driver' ? (
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


          <MultiSelect label="ALERTS" summary={typesLabel}>
            <CheckRow checked={!types} onChange={() => setTypes(types ? null : [])}><strong>All alerts</strong></CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {ALERT_TYPES.map(t => (
              <CheckRow key={t.value} checked={!types || types.includes(t.value)}
                onChange={() => toggleIn(types, setTypes, ALERT_TYPES.map(x => x.value), t.value)}>
                {t.label}
              </CheckRow>
            ))}
          </MultiSelect>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>SEVERITY</span>
            {ALERT_SEVERITIES.map(s => (
              <Chip key={s} active={!severities || severities.includes(s)} onClick={() => toggleIn(severities, setSeverities, ALERT_SEVERITIES, s)}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLOR[s], marginRight: 6 }} />
                {s}
              </Chip>
            ))}
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

      {!IS_REAL && (
        <div className="report-screen-only" style={{ fontSize: 12.5, color: 'var(--c-text3)', marginBottom: 14 }}>
          Alert history is kept by the server, so this report is empty in demo mode.
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

      {busy && !report && <ReportSkeleton />}

      {report && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{total.toLocaleString()}</strong> alert{total === 1 ? '' : 's'}
              {' · '}{report.vehicles.length} vehicle{report.vehicles.length === 1 ? '' : 's'}
              {raw.truncated && <span style={{ color: '#f97316' }}> · only the first 2,000 alerts — narrow the range for the rest</span>}
              {report.untracked > 0 && (
                <span style={{ color: 'var(--c-text3)' }}> · {report.untracked} without tracking near that time</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), fileNameOf(title))} icon={FileDown} primary disabled={!total}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), fileNameOf(title))} icon={FileSpreadsheet} disabled={!total}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!total}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title={title}
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            // Client, 2026-11-10: the violation on the map from where it began to where it ended.
            onLocate={r => setLocated({
              deviceId: r.deviceId, vehicle: r.vehicle, type: r.alertType, ts: r.ts, message: r.message, severity: r.severity, lat: r.lat, lng: r.lng,
              endedAt: r.endedAt, durationSec: r.durationSec, peakValue: r.peakValue, value: r.value,
            })}
            emptyText="No alerts were raised for this selection."
          />
        </>
      )}

      <EventTrackModal event={located} onClose={closeLocated} />
    </ReportFrame>
  )
}
