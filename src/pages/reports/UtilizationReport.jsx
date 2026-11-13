import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import CtrackPaper from '../../components/reports/CtrackPaper'
import ColumnPicker from '../../components/reports/ColumnPicker'
import LocationMapModal from '../../components/reports/LocationMapModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, HelpTip, ReportByToggle, DriverMultiSelect } from '../../components/reports/controls'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import { settingsProfileForImei, useVehicles, useCompanies } from '../../data/settings'
import { siteOf } from '../../utils/vehicleSite'
import { fetchMovementMessages, formatDateTime, formatDateLabel, formatTime, formatPrintDate, isAbortError } from '../../utils/movementReport'
import { resolveRowLocations } from '../../utils/reportLocations'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { exportCtrackPdf, exportCtrackExcel } from '../../utils/ctrackExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { IS_REAL } from '../../data/mode'
import { usageByDay, usageDetailsByDay, summarize, pickRows, hhmm, DAY_SEC } from '../../utils/utilization'
import { hms } from '../../utils/usageReports'
import { driverPasses, NO_DRIVER } from '../../utils/driverAtTime'
import { localDay } from '../../utils/violationOverview'

/**
 * Asset Utilization (Utilization Details), Over and Under Utilization and Not
 * Used Assets (client report list, 2026-11-10, after Ctrack MaXx's
 * utilisation reports), one route each, all on the Movement Report's
 * messages and the sums in utils/utilization.js.
 *
 * Asset Utilization is the client's Ctrack sample "Utilization Details"
 * (2026-11-13): UtilizationDetails below. Over, Under and Not Used keep the
 * summary sheet: each vehicle is expected to work a number of hours a day —
 * 24 unless the client sets a shift (client, 2026-11-10). Changing it, or the
 * Under %, recomputes from the fetched messages without fetching again.
 */

const MAX_RANGE_DAYS = 31
const NOT_ASSIGNED = 'Not assigned'

const pct = v => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`)
const km = v => (Number.isFinite(v) ? v.toFixed(1) : '—')
const band = (key, label) => ({ kind: 'band', key, label })
const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—')

/** "3 d 4 h" / "5 h 20 m" for how long a vehicle has stood. */
function since(sec) {
  if (sec == null || sec < 0) return '—'
  const d = Math.floor(sec / DAY_SEC)
  const h = Math.floor((sec % DAY_SEC) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d} d ${h} h` : `${h} h ${m} m`
}

/** Totals over several vehicles' summaries. */
function sumAll(list) {
  const t = { expectedSec: 0, utilisedSec: 0, driveSec: 0, idleSec: 0, km: 0, periodSec: 0 }
  for (const s of list) for (const k of Object.keys(t)) t[k] += s[k]
  const of = v => (t.periodSec ? (v / t.periodSec) * 100 : null)
  return {
    ...t,
    expectedPct: of(t.expectedSec), utilisedPct: of(t.utilisedSec), drivingPct: of(t.driveSec), idlingPct: of(t.idleSec),
    vsExpectedPct: t.expectedSec ? (t.utilisedSec / t.expectedSec) * 100 : null,
  }
}

const totalsText = (t, n) =>
  `${n} vehicle${n === 1 ? '' : 's'}   ·   Expected ${hhmm(t.expectedSec)}   ·   Utilised ${hhmm(t.utilisedSec)} (${pct(t.vsExpectedPct)} of expected)   ·   Driving ${hhmm(t.driveSec)}   ·   Idling ${hhmm(t.idleSec)}   ·   ${km(t.km)} km`

/** Vehicles grouped by Business Group, as Ctrack groups by cost centre. */
function byCompany(rows) {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.company)) map.set(r.company, [])
    map.get(r.company).push(r)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const summaryCells = s => ({
  expected: hhmm(s.expectedSec), expectedPct: pct(s.expectedPct),
  utilised: hhmm(s.utilisedSec), utilisedPct: pct(s.utilisedPct),
  driving: hhmm(s.driveSec), drivingPct: pct(s.drivingPct),
  idling: hhmm(s.idleSec), idlingPct: pct(s.idlingPct),
  distance: km(s.km), vsExpected: pct(s.vsExpectedPct),
})

// columns: [{ key, label, width, pdf, align?, locate? }]
const VARIANTS = {
  over: {
    title: 'Over Utilization Report',
    file: 'Over_Utilization_Report',
    desc: 'Vehicles used longer than the hours expected of them in a day, with each day that went over.',
    columns: [
      { key: 'date',     label: 'Date',             width: '13%', pdf: 12 },
      { key: 'first',    label: 'First Engine On',  width: '10%', pdf: 10 },
      { key: 'last',     label: 'Last Engine Off',  width: '10%', pdf: 10 },
      { key: 'expected', label: 'Expected Time',    width: '10%', pdf: 10 },
      { key: 'utilised', label: 'Utilised Time',    width: '10%', pdf: 10 },
      { key: 'over',     label: 'Over By',          width: '10%', pdf: 10 },
      { key: 'driving',  label: 'Driving Time',     width: '10%', pdf: 10 },
      { key: 'idling',   label: 'Idling Time',      width: '10%', pdf: 10 },
      { key: 'distance', label: 'Distance (km)',    width: '9%',  pdf: 9, align: 'right' },
    ],
    build(rows, ctx) {
      const groups = rows.map(r => ({
        key: r.id,
        label: `${r.label}   ·   ${r.company}${r.branch && r.branch !== '—' && r.branch !== r.company ? ` / ${r.branch}` : ''}`,
        rows: r.s.overDays.map(d => {
          const midnight = new Date(`${d.date}T00:00:00`).getTime() / 1000
          return {
            key: d.date,
            date: formatDateLabel(new Date(midnight * 1000)),
            // An engine running over midnight neither started nor stopped then.
            first: d.firstOn == null ? '—' : d.firstOn <= midnight ? 'On from midnight' : formatTime(d.firstOn),
            last: d.lastOff == null ? '—' : d.lastOff >= midnight + DAY_SEC ? 'On past midnight' : formatTime(d.lastOff),
            expected: hhmm(ctx.expectedHours * 3600), utilised: hhmm(d.utilisedSec), over: hhmm(d.overSec),
            driving: hhmm(d.driveSec), idling: hhmm(d.idleSec), distance: km(d.km),
            cellStyle: { over: { color: '#b91c1c', fontWeight: 700 } },
          }
        }),
        total: `Vehicle Total   ·   Days over ${r.s.overDays.length}   ·   Over by ${hhmm(r.s.overSec)}   ·   Utilised ${hhmm(r.s.utilisedSec)} of ${hhmm(r.s.expectedSec)} expected (${pct(r.s.vsExpectedPct)})`,
      }))
      const overSec = rows.reduce((n, r) => n + r.s.overSec, 0)
      const days = rows.reduce((n, r) => n + r.s.overDays.length, 0)
      return { groups, grand: rows.length ? `Grand Total   ·   ${rows.length} vehicle${rows.length === 1 ? '' : 's'}   ·   Days over ${days}   ·   Over by ${hhmm(overSec)}` : null }
    },
  },

  under: {
    title: 'Under Utilization Report',
    file: 'Under_Utilization_Report',
    desc: 'Vehicles used less than they are expected to be.',
    columns: [
      { key: 'vehicle',    label: 'Vehicle',         width: '11%', pdf: 10 },
      { key: 'branch',     label: 'Branch',          width: '11%', pdf: 10 },
      { key: 'expected',   label: 'Expected Time',   width: '8%',  pdf: 8 },
      { key: 'utilised',   label: 'Utilised Time',   width: '8%',  pdf: 8 },
      { key: 'vsExpected', label: 'Of Expected',     width: '7%',  pdf: 7, align: 'right' },
      { key: 'short',      label: 'Short By',        width: '8%',  pdf: 8 },
      { key: 'driving',    label: 'Driving Time',    width: '8%',  pdf: 8 },
      { key: 'idling',     label: 'Idling Time',     width: '8%',  pdf: 8 },
      { key: 'distance',   label: 'Distance (km)',   width: '7%',  pdf: 7, align: 'right' },
      { key: 'daysUsed',   label: 'Days Used',       width: '6%',  pdf: 6, align: 'right' },
      { key: 'lastMove',   label: 'Last Moved',      width: '12%', pdf: 12 },
    ],
    build(rows, ctx) {
      const groups = byCompany(rows).map(([company, list]) => ({
        key: company,
        label: company,
        rows: list.map(r => ({
          key: r.id, vehicle: r.label, branch: r.branch, ...summaryCells(r.s),
          short: hhmm(Math.max(0, r.s.expectedSec - r.s.utilisedSec)),
          daysUsed: `${r.s.daysUsed} / ${r.s.periodDays}`,
          lastMove: r.s.lastMove != null ? formatDateTime(r.s.lastMove) : `Not since ${ctx.fromLabel}`,
          cellStyle: { vsExpected: { color: '#b45309', fontWeight: 700 } },
        })),
        total: `Business Group Total   ·   ${totalsText(sumAll(list.map(r => r.s)), list.length)}`,
      }))
      return { groups, grand: rows.length ? `Grand Total   ·   ${totalsText(sumAll(rows.map(r => r.s)), rows.length)}` : null }
    },
  },

  notUsed: {
    title: 'Not Used Assets Report',
    file: 'Not_Used_Assets_Report',
    desc: 'Vehicles that did not move in the period: since when, and where they stand.',
    columns: [
      { key: 'vehicle',    label: 'Vehicle',          width: '11%', pdf: 10 },
      { key: 'branch',     label: 'Branch',           width: '11%', pdf: 10 },
      { key: 'lastMove',   label: 'Last Moved',       width: '12%', pdf: 12 },
      { key: 'standing',   label: 'Standing For',     width: '8%',  pdf: 8 },
      { key: 'engine',     label: 'Engine On',        width: '7%',  pdf: 7 },
      { key: 'lastReport', label: 'Last Report',      width: '12%', pdf: 12 },
      { key: 'tracker',    label: 'Tracker',          width: '8%',  pdf: 8 },
      { key: 'location',   label: 'Last Position',    width: '31%', pdf: 33, locate: true },
    ],
    build(rows, ctx) {
      const groups = byCompany(rows).map(([company, list]) => ({
        key: company,
        label: company,
        rows: list.map(r => {
          const reporting = r.lastTs != null && ctx.nowTs - r.lastTs <= DAY_SEC
          const pos = r.s.lastPos ?? (r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null)
          return {
            key: r.id, vehicle: r.label, branch: r.branch, lat: pos?.lat ?? null, lng: pos?.lng ?? null,
            lastMove: r.s.lastMove != null ? formatDateTime(r.s.lastMove) : `Not since ${ctx.fromLabel}`,
            standing: r.s.lastMove != null ? since(ctx.toTs - r.s.lastMove) : `${r.s.periodDays}+ days`,
            // Engine running while standing still is idling, which Not Used still counts.
            engine: hhmm(r.s.utilisedSec),
            lastReport: r.lastTs != null ? formatDateTime(r.lastTs) : 'Never',
            tracker: reporting ? 'Reporting' : 'Not reporting',
            cellStyle: { tracker: { color: reporting ? '#15803d' : '#b91c1c', fontWeight: 700 } },
          }
        }),
        total: `Business Group Total   ·   ${list.length} vehicle${list.length === 1 ? '' : 's'} not used`,
      }))
      return { groups, grand: rows.length ? `Grand Total   ·   ${rows.length} of ${ctx.vehicleCount} vehicle${ctx.vehicleCount === 1 ? '' : 's'} not used` : null }
    },
  },
}

export default function UtilizationReport({ variant = 'asset', ...props }) {
  return VARIANTS[variant] ? <UtilizationSummary variant={variant} {...props} /> : <UtilizationDetails {...props} />
}

// ── Utilization Details (Asset Utilization) ─────────────────────────────────
// The client's Ctrack sample (Vehicle_Utilization_Report, 2026-11-13): its own
// page (698 x 648 pt), From / Start / Grouped By and To / End / Entity Group
// three to a line, each day on its own page under a dark-red date, one line
// per driver (or vehicle), and the Report Summary on the last page.
//
//   Driving   engine on and moving         Standing  engine on, not moving
//   Duration  Driving + Standing           Idling    standstills of 5 min or more (part of Standing)
//   Resting   the rest of the 24 h day     Avg. Speed  distance over driving time
//
// Start / End are the working hours the sample prints. As in the sample, the
// figures still cover the whole day (client, 2026-11-10: a day runs from
// 00:00:01 to 23:59:59), so they only label the report.
const DETAILS_PAGE = { w: 698, h: 648 }
const DETAILS_COLS = [
  { key: 'name',     label: 'Name',                w: 118 },
  { key: 'site',     label: 'Site',                w: 60 },
  { key: 'bar',      label: 'Driving vs Standing', w: 58, type: 'bar' },
  { key: 'driving',  label: 'Driving',             w: 46, align: 'center' },
  { key: 'standing', label: 'Standing',            w: 48, align: 'center' },
  { key: 'duration', label: 'Duration',            w: 50, align: 'center' },
  { key: 'idling',   label: 'Idling',              w: 46, align: 'center' },
  { key: 'resting',  label: 'Resting',             w: 50, align: 'center' },
  { key: 'distance', label: 'Distance (km)',       w: 46, align: 'right' },
  { key: 'avg',      label: 'Avg. Speed (km/h)',   w: 46, align: 'right' },
  { key: 'max',      label: 'Max Speed (km/h)',    w: 42, align: 'right' },
  { key: 'days',     label: 'Days With Trips',     w: 50, align: 'right' },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = n => String(n).padStart(2, '0')
/** '2026-11-07' → "07 Nov, 2026" */
const ctrackDay = iso => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${iso.slice(0, 4)}`
/** "07 Nov, 2026 00:00:00" */
const ctrackDateTime = ts => {
  const d = new Date(ts * 1000)
  return `${ctrackDay(localDay(ts))} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const onScreen = cols => {
  const sum = cols.reduce((s, c) => s + c.w, 0)
  return cols.map(c => ({ ...c, width: `${((c.w / sum) * 100).toFixed(3)}%` }))
}
const forPdf = cols => cols.map(c => ({ ...c, width: c.w }))

/**
 * Day → entity lines from each vehicle's usageDetailsByDay, merged: a driver
 * who drove two vehicles in a day is one line, with both vehicles' sites.
 */
function detailsSheet(perVehicle) {
  const days = new Map()
  for (const { site, byDay } of perVehicle) {
    for (const [day, byWho] of byDay) {
      let rows = days.get(day)
      if (!rows) days.set(day, (rows = new Map()))
      for (const c of byWho.values()) {
        let r = rows.get(c.key)
        if (!r) rows.set(c.key, (r = { key: c.key, label: c.label, sites: new Set(), driveSec: 0, standSec: 0, idleSec: 0, km: 0, maxKmh: 0 }))
        if (site) r.sites.add(site)
        r.driveSec += c.driveSec
        r.standSec += c.standSec
        r.idleSec += c.idleSec
        r.km += c.km
        r.maxKmh = Math.max(r.maxKmh, c.maxKmh)
      }
    }
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => ({
    day,
    rows: [...rows.values()]
      .filter(r => r.driveSec + r.standSec > 0 || r.km >= 0.5)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter(d => d.rows.length)
}

function UtilizationDetails(props) {
  const title = useReportTitle('Asset Utilization Report') // Oil & Gas opens it as "Utilization Details"
  const file = title === 'Asset Utilization Report' ? 'Asset_Utilization_Report' : fileNameOf(title)
  const { data } = useFlespiData()
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const dims = useDriverDimension()
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(() => liveVehicles.map(v => {
    const profile = settingsProfileForImei(v.ident)
    return {
      id: v.id,
      label: profile.plateNo || v.master?.plateNo || profile.fleetNo || v.name,
      company: profile.linked ? (profile.bgName || NOT_ASSIGNED) : NOT_ASSIGNED,
      // Site = the vehicle's own Site, else its branch (utils/vehicleSite).
      site: siteOf(profile.linked ? profile.vehicle : null),
      live: { id: v.id, ident: v.ident, master: v.master },
    }
  }).sort((a, b) => a.label.localeCompare(b.label)),
  // settingsProfileForImei reads these stores.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vehiclesKey, settingsVehicles, companies])

  const now = useRef(new Date()).current
  // The sample's entity is the driver.
  const [reportBy, setReportBy] = useState('driver')
  const driverMode = reportBy === 'driver'
  const [driverSel, setDriverSel] = useState(null) // null = all (a Set of keys otherwise)
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [workStart, setWorkStart] = useState('08:00')
  const [workEnd, setWorkEnd] = useState('17:00')

  const [raw, setRaw] = useState(null) // { byDevice, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const busy = progress !== null

  // Driver wise covers every vehicle; the drivers chosen narrow it after the fetch.
  const effectiveIds = driverMode ? vehicles.map(v => v.id) : (selectedIds ?? vehicles.map(v => v.id))
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / DAY_SEC > MAX_RANGE_DAYS

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
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
    setProgress({ text: 'Generating report...' })
    try {
      const byDevice = await fetchMovementMessages(effectiveIds, fromTs, toTs, {
        signal: controller.signal,
        onProgress: p => setProgress({ text: p.text }),
      })
      if (controller.signal.aborted) return
      // The period runs to the end of its last minute.
      setRaw({ byDevice, applied: { fromTs, toTs: toTs + 1, ids: effectiveIds, reportBy, workStart, workEnd, printDate: ctrackDateTime(Math.floor(Date.now() / 1000)) } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, reportBy, workStart, workEnd])

  const cancel = () => abortRef.current?.abort()

  // Per vehicle, per day, per entity: depends on the messages and who drove.
  const perVehicle = useMemo(() => {
    if (!raw) return null
    const { fromTs: from, toTs: to, ids, reportBy: by } = raw.applied
    // Days in the browser's time, as the dates were picked.
    const tzOffsetSec = -new Date(from * 1000).getTimezoneOffset() * 60
    const info = new Map(vehicles.map(v => [v.id, v]))
    return ids.map(id => {
      const v = info.get(id) ?? { label: String(id), site: '', live: { id } }
      const messages = raw.byDevice.get(id)?.messages ?? []
      const self = { key: `v:${id}`, label: v.label }
      // Time with no driver stays per vehicle: summed over the fleet it would
      // run past 24 h a day and leave no Resting.
      const unnamed = { key: `${NO_DRIVER.key}:${id}`, label: `${NO_DRIVER.label} (${v.label})` }
      const at = by === 'driver' ? dims.timelineFor(v.live, messages) : null
      const who = at ? ts => { const w = at(ts); return w.key === NO_DRIVER.key ? unnamed : w } : () => self
      return { site: v.site, byDay: usageDetailsByDay(messages, from, to, { tzOffsetSec, who }) }
    })
  }, [raw, vehicles, dims])

  const built = useMemo(() => {
    if (!perVehicle) return null
    const keep = raw.applied.reportBy === 'driver' && driverSel
      ? r => driverPasses(r.key.startsWith(`${NO_DRIVER.key}:`) ? NO_DRIVER : r, driverSel)
      : () => true
    const days = detailsSheet(perVehicle).map(d => ({ ...d, rows: d.rows.filter(keep) })).filter(d => d.rows.length)
    const t = { entities: new Set(), dur: 0, drive: 0, stand: 0, km: 0 }
    const tables = days.map((d, i) => ({
      key: d.day,
      heading: ctrackDay(d.day),
      headingSize: 11.2,
      ruleAbove: true,
      valign: 'top',
      newPage: i > 0,
      minWidth: 980,
      columns: DETAILS_COLS,
      rows: d.rows.map(r => {
        const dur = r.driveSec + r.standSec
        t.entities.add(r.key); t.dur += dur; t.drive += r.driveSec; t.stand += r.standSec; t.km += r.km
        return {
          key: r.key,
          name: r.label,
          site: [...r.sites].join(', '),
          bar: dur > 0 ? r.driveSec / dur : 0,
          driving: hms(r.driveSec),
          standing: hms(r.standSec),
          duration: hms(dur),
          idling: hms(r.idleSec),
          resting: hms(Math.max(0, DAY_SEC - dur)),
          distance: String(Math.round(r.km)),
          avg: String(r.driveSec > 0 ? Math.round(r.km / (r.driveSec / 3600)) : 0),
          max: String(Math.round(r.maxKmh)),
          days: r.driveSec > 0 ? '1' : '0',
        }
      }),
    }))
    const byDriver = raw.applied.reportBy === 'driver'
    const summary = [
      { label: byDriver ? 'Total Drivers:' : 'Total Assets:', value: String(t.entities.size) },
      { label: 'Total Duration:', value: hms(t.dur) },
      { label: 'Total Driving Time:', value: hms(t.drive) },
      { label: 'Total Standing Time:', value: hms(t.stand) },
      { label: 'Total Distance (km):', value: String(Math.round(t.km)) },
    ]
    return { tables, summary, lines: tables.reduce((n, x) => n + x.rows.length, 0), entities: t.entities.size }
  }, [perVehicle, raw, driverSel])

  const applied = raw?.applied
  const byDriver = applied?.reportBy === 'driver'
  const pairs = applied ? [
    ['From', ctrackDateTime(applied.fromTs)], ['Start', `${applied.workStart}:00`], ['Grouped By', 'Day'],
    ['To', ctrackDateTime(applied.toTs - 1)], ['End', `${applied.workEnd}:00`], ['Entity Group', byDriver ? 'Driver' : 'Asset'],
  ] : []

  const ctrackOpts = () => ({
    title,
    pageSize: DETAILS_PAGE,
    fontSize: 9.8,
    titleSize: 20,
    headerRuleY: 74,
    rowPad: 6,
    pairsPerLine: 3,
    pairCols: [{ x: 6, vx: 42 }, { x: 150, vx: 186 }, { x: 295, vx: 365 }],
    pairLineH: 20,
    pairTop: 11,
    printDate: applied?.printDate,
    pairs,
    tables: built.tables.map(x => ({ ...x, columns: forPdf(x.columns) })),
    summaryTitle: 'Report Summary',
    summary: built.summary,
  })

  const truncated = raw && [...raw.byDevice.values()].some(e => e?.truncated)

  return (
    <ReportFrame title={title} desc="Per day and driver (or vehicle): driving, standing, idling and resting time, distance and speeds." {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <ReportByToggle id="utilization-details-report-by" value={reportBy} onChange={v => { setReportBy(v); setRaw(null) }} />
          {driverMode ? (
            <DriverMultiSelect options={dims.options} value={driverSel} onChange={setDriverSel} />
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
          <div>
            <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 6 }}>
              WORK START
              <HelpTip title="Start and End">
                The working hours printed on the report as Start and End, as in the client&rsquo;s Ctrack sample. The
                figures cover the whole day either way (00:00 to 23:59): Resting is what is left of the 24 hours.
              </HelpTip>
            </label>
            <input type="time" style={FIELD} value={workStart} onChange={e => setWorkStart(e.target.value)} />
          </div>
          <div>
            <label style={LABEL}>WORK END</label>
            <input type="time" style={FIELD} value={workEnd} onChange={e => setWorkEnd(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
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

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {built && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{built.tables.length}</strong> day{built.tables.length === 1 ? '' : 's'}
              {' · '}{built.entities} {byDriver ? 'driver' : 'vehicle'}{built.entities === 1 ? '' : 's'}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — narrow the range for full detail</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportCtrackPdf(ctrackOpts(), file)} icon={FileDown} primary disabled={!built.lines}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportCtrackExcel(ctrackOpts(), file)} icon={FileSpreadsheet} disabled={!built.lines}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!built.lines}>Print</ToolbarButton>
            </div>
          </div>

          <CtrackPaper
            title={title}
            pairs={pairs}
            pairsPerLine={3}
            tables={built.tables.map(x => ({ ...x, columns: onScreen(x.columns) }))}
            summaryTitle="Report Summary"
            summary={built.summary}
            printDate={applied.printDate}
            emptyText={byDriver ? 'No driving in this period for the selected drivers.' : 'No driving in this period for the selected vehicles.'}
          />
        </>
      )}
    </ReportFrame>
  )
}

// ── Over / Under Utilization and Not Used Assets ────────────────────────────
function UtilizationSummary({ variant, ...props }) {
  const V = VARIANTS[variant]
  const title = useReportTitle(V.title) // Oil & Gas opens Asset Utilization as "Utilization Details"
  const file = title === V.title ? V.file : fileNameOf(title)
  const [hiddenCols, setHiddenCols] = useHiddenColumns(`utilization-${variant}`)
  const shownCols = useVisibleColumns(V.columns, hiddenCols)

  const { data } = useFlespiData()
  // Subscribed so a BG or branch changed in Settings re-labels the rows;
  // settingsProfileForImei reads these stores.
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  // The live feed hands over a new vehicle array on every poll; the report
  // keys on which vehicles there are, not on their live position.
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(() => liveVehicles.map(v => {
    const profile = settingsProfileForImei(v.ident)
    return {
      id: v.id,
      label: profile.plateNo || v.master?.plateNo || profile.fleetNo || v.name,
      company: profile.linked ? (profile.bgName || NOT_ASSIGNED) : NOT_ASSIGNED,
      branch: profile.linked ? (profile.branchName || '—') : '—',
    }
  }).sort((a, b) => a.label.localeCompare(b.label)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vehiclesKey, settingsVehicles, companies])
  // Last report and position move with every poll; read them at build time.
  const liveRef = useRef(new Map())
  liveRef.current = new Map(liveVehicles.map(v => [v.id, v]))

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [expectedHours, setExpectedHours] = useState('24')
  const [underPct, setUnderPct] = useState('25')

  const [raw, setRaw] = useState(null) // { byDevice, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const [geoProgress, setGeoProgress] = useState(null)
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const abortRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / DAY_SEC > MAX_RANGE_DAYS

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
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
    setProgress({ text: 'Generating report...' })
    try {
      const byDevice = await fetchMovementMessages(effectiveIds, fromTs, toTs, {
        signal: controller.signal,
        onProgress: p => setProgress({ text: p.text }),
      })
      if (controller.signal.aborted) return
      // The period runs to the end of its last minute.
      setRaw({ byDevice, applied: { fromTs, toTs: toTs + 1, selectionLabel, ids: effectiveIds, printDate: formatPrintDate() } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel])

  const cancel = () => abortRef.current?.abort()

  const hoursNum = Math.min(24, Math.max(0.5, Number(expectedHours) || 24))
  const underNum = Math.min(100, Math.max(1, Number(underPct) || 25))

  // Usage per vehicle depends only on the messages; the summaries on the hours.
  const usage = useMemo(() => {
    if (!raw) return null
    const { fromTs: from, toTs: to, ids } = raw.applied
    // Days in the browser's time, as the dates were picked.
    const tzOffsetSec = -new Date(from * 1000).getTimezoneOffset() * 60
    return ids.map(id => ({ id, u: usageByDay(raw.byDevice.get(id)?.messages ?? [], from, to, { tzOffsetSec }) }))
  }, [raw])

  const built = useMemo(() => {
    if (!usage) return null
    const { fromTs: from, toTs: to } = raw.applied
    const info = new Map(vehicles.map(v => [v.id, v]))
    const rows = usage.map(({ id, u }) => {
      const v = info.get(id) ?? { label: String(id), company: NOT_ASSIGNED, branch: '—' }
      const live = liveRef.current.get(id)
      return { ...v, id, lastTs: live?.lastTs ?? null, lat: live?.lat ?? null, lng: live?.lng ?? null, s: summarize(u, { from, to, expectedHours: hoursNum }) }
    })
    const picked = pickRows(rows, variant, { underPct: underNum })
    const out = V.build(picked, {
      expectedHours: hoursNum, fromLabel: formatDateTime(from), toTs: to,
      nowTs: Math.floor(Date.now() / 1000), vehicleCount: rows.length,
    })
    // The grand total closes the last group, as Ctrack ends on one.
    const groups = out.groups.filter(g => g.rows.length)
    if (out.grand && groups.length) {
      const last = groups[groups.length - 1]
      groups[groups.length - 1] = { ...last, rows: [...last.rows, ...(last.total ? [band('group-total', last.total)] : [])], total: out.grand }
    }
    return { groups, picked: picked.length, of: rows.length }
  }, [usage, raw, vehicles, variant, V, hoursNum, underNum])

  // Addresses only where the report shows a position.
  useEffect(() => {
    if (!built || !V.columns.some(c => c.locate)) return
    const controller = new AbortController()
    resolveRowLocations(built.groups, {
      limit: IS_REAL ? 500 : 100,
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
  }, [built, V])

  const groups = useMemo(() => {
    if (!built) return []
    return built.groups.map(g => ({
      ...g,
      rows: g.rows.map(r => {
        if (r.kind === 'band' || r.lat == null) return r
        const location = r.locationText || coords(r.lat, r.lng)
        return { ...r, location, mapUrl: locationUrl({ lat: r.lat, lng: r.lng, vehicle: r.vehicle, address: location }) }
      }),
    }))
  // geoTick: resolveRowLocations fills the address text in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, geoTick])

  const applied = raw?.applied
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs - 1)],
    ...(variant !== 'notUsed' ? [['Expected Hours', `${hoursNum} h a day`]] : []),
    ...(variant === 'under' ? [['Under', `below ${underNum}% of expected`]] : []),
  ] : []

  const dataRows = groups.reduce((n, g) => n + g.rows.filter(r => r.kind !== 'band').length, 0)

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.locate ? 'mapUrl' : undefined })),
      rows: g.rows, // date/total bands print as the Movement PDF's yellow bands
    })),
  })

  const truncated = raw && [...raw.byDevice.values()].some(e => e?.truncated)
  const emptyText = {
    over: hoursNum >= 24
      ? 'A day has 24 hours, so no vehicle can go over 24 expected hours. Set the hours a vehicle is expected to work a day (8, say) to see the days it went over.'
      : `No vehicle was used longer than ${hoursNum} h on any day of this period.`,
    under: `Every selected vehicle was used at least ${underNum}% of its expected time.`,
    notUsed: 'Every selected vehicle moved in this period.',
  }[variant]

  return (
    <ReportFrame title={title} desc={V.desc} {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
            <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All vehicles</strong></CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {vehicles.map(v => (
              <CheckRow key={v.id} checked={effectiveIds.includes(v.id)} onChange={() => toggleVehicle(v.id)} note={v.company !== NOT_ASSIGNED ? v.company : null}>
                {v.label}
              </CheckRow>
            ))}
          </MultiSelect>
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
          {variant !== 'notUsed' && (
            <div>
              <label style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 6 }}>
                EXPECTED HOURS A DAY
                <HelpTip title="Expected hours">
                  How long each vehicle is expected to work a day. 24 measures against the whole day; set a shift
                  (8, say) to compare with working hours. Changing it does not fetch the data again.
                </HelpTip>
              </label>
              <input type="number" min="0.5" max="24" step="0.5" style={FIELD} value={expectedHours} onChange={e => setExpectedHours(e.target.value)} />
            </div>
          )}
          {variant === 'under' && (
            <div>
              <label style={LABEL}>UNDER WHEN BELOW (% OF EXPECTED)</label>
              <input type="number" min="1" max="100" style={FIELD} value={underPct} onChange={e => setUnderPct(e.target.value)} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
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

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {built && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{built.picked}</strong> of {built.of} vehicle{built.of === 1 ? '' : 's'}
              {variant === 'over' && <span> · {dataRows} day{dataRows === 1 ? '' : 's'} over</span>}
              {geoProgress && <span style={{ color: 'var(--ft-accent)' }}> · Resolving addresses {geoProgress.done}/{geoProgress.total}…</span>}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — narrow the range for full detail</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={V.columns} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), file)} icon={FileDown} primary disabled={!dataRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), file)} icon={FileSpreadsheet} disabled={!dataRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!dataRows}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title={title}
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            onLocate={r => setLocated({ lat: r.lat, lng: r.lng, ts: r.key, vehicleId: r.vehicle, status: title, location: r.location })}
            emptyText={emptyText}
          />
        </>
      )}

      <LocationMapModal point={located} onClose={closeLocated} />
    </ReportFrame>
  )
}
