import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import LocationMapModal from '../../components/reports/LocationMapModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, HelpTip } from '../../components/reports/controls'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { useFlespiData } from '../../hooks/useFlespiData'
import { settingsProfileForImei, useVehicles, useCompanies, useBranches } from '../../data/settings'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { resolveRowLocations } from '../../utils/reportLocations'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { IS_REAL } from '../../data/mode'
import { hms } from '../../utils/usageReports'
import {
  DEFAULT_POWER_OPTS, POWER_FIELDS, powerCutsByVehicle, visibleCuts, sumCuts, volts, batteryVolts,
} from '../../utils/powerFailure'

/**
 * Power Failure Report (client report list, 2026-11-10, after Ctrack MaXx):
 * each time a tracker lost its external (vehicle) power — when, until when,
 * how low the supply fell, the backup battery and ignition at the cut, and
 * where. Grouped by vehicle with its totals; the fleet total sits in the
 * filter band. The cut rules live in utils/powerFailure.js.
 *
 * Cut below (V) and the short-cut filter recompute from the fetched messages —
 * changing them never fetches again.
 *
 * Trackers that send no external-power reading are listed by name instead of
 * showing as "no cuts": they could not have reported one.
 *
 * Scope: vehicles come from useFlespiData(), already narrowed to what the
 * signed-in user may see (see components/sidebar/reportsNav.js).
 */

const TITLE = 'Power Failure Report'
const FILE = 'Power_Failure_Report'
const DESC = 'Each time a tracker lost its external power: when, for how long and where.'
const MAX_RANGE_DAYS = 31
const NOT_ASSIGNED = 'Not assigned'

// columns: [{ key, label, width, pdf, align?, locate? }]
const COLUMNS = [
  { key: 'start',    label: 'Power Cut',      width: '14%', pdf: 13 },
  { key: 'end',      label: 'Power Restored', width: '14%', pdf: 13 },
  { key: 'duration', label: 'Duration',       width: '8%',  pdf: 7 },
  { key: 'minV',     label: 'Lowest Volts',   width: '7%',  pdf: 6, align: 'right' },
  { key: 'batV',     label: 'Battery V',      width: '7%',  pdf: 6, align: 'right' },
  { key: 'ignition', label: 'Ignition',       width: '6%',  pdf: 5 },
  { key: 'location', label: 'Location',       width: '44%', pdf: 42, locate: true },
]

const STILL_OFF_STYLE = { color: '#b91c1c', fontWeight: 700 }

const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—')
const lowest = v => (v === null ? '—' : `${volts(v)} V`)
const names = list => list.join(', ')

function vehicleTotal(s) {
  const parts = [`Cuts ${s.cuts}`, `Without power ${hms(s.offSec)}`, `Lowest ${lowest(s.lowestV)}`]
  if (s.open) parts.push('Still off at the end of the period')
  return `Vehicle Total   ·   ${parts.join('   ·   ')}`
}

export default function PowerFailureReport(props) {
  const title = useReportTitle(TITLE) // Oil & Gas opens it as "Power Failure"
  const file = title === TITLE ? FILE : fileNameOf(title)
  const [hiddenCols, setHiddenCols] = useHiddenColumns('power-failure')
  const shownCols = useVisibleColumns(COLUMNS, hiddenCols)
  const { data } = useFlespiData()
  // Subscribed so a BG or branch changed in Settings re-labels the groups;
  // settingsProfileForImei reads these stores.
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const branches = useBranches()
  // The live feed hands over a new vehicle array on every poll. The report only
  // cares which vehicles there are and what they are called, so it keys on that:
  // otherwise each poll rebuilt the report and restarted the address lookup.
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(
    () => liveVehicles.slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehiclesKey]
  )
  // "Company / Branch" for each device's group heading; a device with no
  // Settings registration reads "Not assigned".
  const placeOf = useMemo(() => new Map(vehicles.map(v => {
    const p = settingsProfileForImei(v.ident)
    if (!p.linked) return [v.id, NOT_ASSIGNED]
    const company = p.bgName || NOT_ASSIGNED
    return [v.id, p.branchName && p.branchName !== '—' && p.branchName !== company ? `${company} / ${p.branchName}` : company]
  })),
  // settingsVehicles, companies and branches are the stores settingsProfileForImei reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vehicles, settingsVehicles, companies, branches])

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))

  const [cutBelow, setCutBelow] = useState(String(DEFAULT_POWER_OPTS.cutBelowV))
  const [minCut, setMinCut] = useState(String(DEFAULT_POWER_OPTS.minCutMin))

  const [raw, setRaw] = useState(null)        // { byDevice, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const [geoProgress, setGeoProgress] = useState(null) // { done, total } while addresses load
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const abortRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
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
      const byDevice = await fetchFleetMessages(effectiveIds, fromTs, toTs, {
        fields: POWER_FIELDS,
        signal: controller.signal,
        onStatus: text => setProgress({ text: /busy/i.test(text) ? text : 'Generating report...' }),
      })
      if (controller.signal.aborted) return
      // A cut still open runs to the end of the period, or to now when the
      // period reaches into the future (Today's "to" can be 23:59).
      const endTs = Math.min(toTs, Math.floor(Date.now() / 1000))
      setRaw({ byDevice, applied: { fromTs, toTs, endTs, selectionLabel, printDate: formatPrintDate() } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel])

  const cancel = () => abortRef.current?.abort()

  const cutNum = Math.min(40, Math.max(0.1, Number(cutBelow) || DEFAULT_POWER_OPTS.cutBelowV))
  const minNum = Math.min(1440, Math.max(0, Number(minCut) || 0))

  // The cuts depend on the threshold; which ones show on the short-cut filter.
  const vehiclePower = useMemo(() => {
    if (!raw) return null
    return powerCutsByVehicle(raw.byDevice, vehicles, { cutBelowV: cutNum, periodEndTs: raw.applied.endTs })
  }, [raw, vehicles, cutNum])

  const built = useMemo(() => {
    if (!vehiclePower) return null
    let hidden = 0
    const shown = []
    const groups = vehiclePower.map(v => {
      const vis = visibleCuts(v.cuts, minNum)
      hidden += vis.hidden
      shown.push(...vis.cuts)
      const rows = vis.cuts.map(c => ({
        key: c.startTs, lat: c.lat, lng: c.lng, vehicle: v.vehicleId,
        start: c.beforePeriod ? `${formatDateTime(c.startTs)} (already off)` : formatDateTime(c.startTs),
        end: c.open ? '(still off)' : formatDateTime(c.endTs),
        duration: hms(c.durationSec),
        minV: volts(c.minVoltage),
        batV: batteryVolts(c.batteryV),
        ignition: c.ignition === null ? '—' : c.ignition ? 'On' : 'Off',
        cellStyle: c.open ? { end: STILL_OFF_STYLE } : undefined,
      }))
      return { key: v.deviceId, label: `${v.vehicleId}   ·   ${placeOf.get(v.deviceId) ?? NOT_ASSIGNED}`, rows, total: vehicleTotal(sumCuts(vis.cuts)) }
    })
    const reporting = vehiclePower.filter(v => v.reports)
    return {
      groups,
      hidden,
      fleet: sumCuts(shown),
      withCuts: groups.filter(g => g.rows.length).length,
      reporting: reporting.length,
      noReading: vehiclePower.filter(v => v.hasData && !v.reports).map(v => v.vehicleId),
      noData: vehiclePower.filter(v => !v.hasData).map(v => v.vehicleId),
    }
  }, [vehiclePower, minNum, placeOf])

  useEffect(() => {
    if (!built) return
    const controller = new AbortController()
    resolveRowLocations(built.groups, {
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
  }, [built])

  const groups = useMemo(() => {
    if (!built) return []
    return built.groups.map(g => ({
      ...g,
      rows: g.rows.map(r => {
        const location = r.locationText || coords(r.lat, r.lng)
        return {
          ...r,
          location,
          mapUrl: r.lat != null ? locationUrl({ lat: r.lat, lng: r.lng, vehicle: r.vehicle, time: formatDateTime(r.key), address: location }) : undefined,
        }
      }),
    }))
  // geoTick: resolveRowLocations fills the address text in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, geoTick])

  const applied = raw?.applied
  const fleetText = built ? [
    `Cuts ${built.fleet.cuts}`,
    `Without power ${hms(built.fleet.offSec)}`,
    `Vehicles with cuts ${built.withCuts} of ${built.reporting}`,
    ...(built.fleet.open ? [`${built.fleet.open} still off at the end of the period`] : []),
  ].join('   ·   ') : ''
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Cut Below', `${cutNum} V`],
    ['Shorter Cuts', minNum > 0 ? `Under ${minNum} min hidden` : 'Shown'],
    ['Fleet Total', fleetText],
    ...(built.noReading.length ? [['No External Power Reading', names(built.noReading)]] : []),
    ...(built.noData.length ? [['No Data In Period', names(built.noData)]] : []),
  ] : []

  const dataRows = groups.reduce((n, g) => n + g.rows.length, 0)

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: groups.filter(g => g.rows.length).map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.locate ? 'mapUrl' : undefined })),
      rows: g.rows,
    })),
  })

  const truncated = raw && [...raw.byDevice.values()].some(e => e?.truncated)

  return (
    <ReportFrame title={title} desc={DESC} {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
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
              CUT BELOW (V)
              <HelpTip title="When power counts as cut">
                A power cut starts when the vehicle supply reading falls below this voltage (or the tracker reports
                its power lost) and ends at the first reading back at or above it. Vehicles run at 12 V or 24 V, so
                the default of 6 V only catches a real cut. &ldquo;Already off&rdquo; means the power was off at the
                first reading of the period, so the cut began earlier. &ldquo;Still off&rdquo; means the power had not
                come back by the end of the period; its time counts to then. Changing this does not fetch the data again.
              </HelpTip>
            </label>
            <input type="number" min="0.5" max="40" step="0.5" style={FIELD} value={cutBelow} onChange={e => setCutBelow(e.target.value)} />
          </div>
          <div>
            <label style={LABEL}>IGNORE CUTS SHORTER THAN (MIN)</label>
            <input type="number" min="0" max="1440" step="1" style={FIELD} value={minCut} onChange={e => setMinCut(e.target.value)} />
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
              <strong style={{ color: 'var(--c-text1)' }}>{dataRows.toLocaleString()}</strong> power cut{dataRows === 1 ? '' : 's'}
              {' · '}{built.withCuts} vehicle{built.withCuts === 1 ? '' : 's'} with cuts
              {built.hidden > 0 && <span style={{ color: 'var(--c-text3)' }}> · {built.hidden} shorter cut{built.hidden === 1 ? '' : 's'} hidden</span>}
              {built.noReading.length > 0 && <span style={{ color: 'var(--c-text3)' }}> · No external power reading from: {names(built.noReading)}</span>}
              {built.noData.length > 0 && <span style={{ color: 'var(--c-text3)' }}> · No data in this period: {names(built.noData)}</span>}
              {geoProgress && <span style={{ color: 'var(--ft-accent)' }}> · Resolving addresses {geoProgress.done}/{geoProgress.total}…</span>}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — narrow the range for full detail</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
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
            onLocate={r => setLocated({ lat: r.lat, lng: r.lng, ts: r.key, vehicleId: r.vehicle, status: 'Power cut', location: r.location })}
            emptyText="No power cuts in this period for the selected vehicles."
          />
        </>
      )}

      <LocationMapModal point={located} onClose={closeLocated} />
    </ReportFrame>
  )
}
