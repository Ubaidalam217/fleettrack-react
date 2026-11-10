import { useCallback, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import EventListModal from '../../components/reports/EventListModal'
import EventTrackModal from '../../components/reports/EventTrackModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton } from '../../components/reports/controls'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { useFlespiData } from '../../hooks/useFlespiData'
import {
  ALERT_TYPES, ALERT_SEVERITIES, alertTypeLabel, driverNameForDevice, settingsProfileForImei, useVehicles, useCompanies,
} from '../../data/settings'
import { fetchAlertEventsInRange } from '../../data/alertEvents'
import { IS_REAL } from '../../data/mode'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { overview, VIOLATION_TYPES } from '../../utils/violationOverview'

/**
 * Violation Overview Report (client report list, 2026-11-10): one line per
 * vehicle — or per driver — with how many alerts of each kind it had in the
 * period, after AI Revofleet's Object Alert summary. The counts come from the
 * alerts the server raised (GET /api/alert-events, already narrowed to what
 * the signed-in user may see); an alert rule has to exist for a kind to count.
 *
 * Kind, severity and the grouping are filters over what was fetched.
 *
 * Client, 2026-11-10: every count opens its events, and each event opens on
 * the map from where the violation began to where it ended.
 */

const MAX_RANGE_DAYS = 31
const NOT_ASSIGNED = 'Not assigned'
const ALL_TYPES = [...ALERT_TYPES.map(t => t.value), 'reminder']
const HIGH_STYLE = { color: '#b91c1c', fontWeight: 700 }

export default function ViolationOverviewReport(props) {
  const { data } = useFlespiData()
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
      branch: profile.linked ? (profile.branchName || '—') : '—',
      // The driver assigned in Settings; a tag read during the alert wins over it.
      driver: driverNameForDevice({ ...v, ibutton: null }) || '',
    }
  }).sort((a, b) => a.label.localeCompare(b.label)),
  // settingsProfileForImei / driverNameForDevice read these stores.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [vehiclesKey, settingsVehicles, companies])

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))
  const [types, setTypes] = useState(VIOLATION_TYPES)
  const [severities, setSeverities] = useState(null) // null = all
  const [by, setBy] = useState('vehicle')
  const [hiddenCols, setHiddenCols] = useHiddenColumns('violation-overview')

  const [raw, setRaw] = useState(null) // { events, truncated, applied }
  const [eventList, setEventList] = useState(null) // { title, events } of a clicked count
  const [track, setTrack] = useState(null)          // the event shown on the map
  const closeList = useCallback(() => setEventList(null), [])
  const closeTrack = useCallback(() => setTrack(null), [])
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
        : `${effectiveIds.length} vehicles`
  const allTypes = types.length === ALL_TYPES.length
  const typesLabel = allTypes ? 'All alerts'
    : types.length === 0 ? 'None'
      : types.length === VIOLATION_TYPES.length && VIOLATION_TYPES.every(t => types.includes(t)) ? 'Violations'
        : types.length <= 2 ? types.map(alertTypeLabel).join(', ') : `${types.length} kinds`
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
  const toggleType = t => setTypes(list => (list.includes(t) ? list.filter(x => x !== t) : [...list, t]))
  const toggleSeverity = s => {
    const current = severities ?? ALERT_SEVERITIES
    const next = current.includes(s) ? current.filter(x => x !== s) : [...current, s]
    setSeverities(next.length === ALERT_SEVERITIES.length ? null : next)
  }

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: 'Loading alerts...' })
    try {
      const { events, truncated } = await fetchAlertEventsInRange({ fromTs, toTs, deviceIds: effectiveIds })
      if (controller.signal.aborted) return
      setRaw({ events, truncated, applied: { fromTs, toTs, selectionLabel, printDate: formatPrintDate() } })
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel])

  const cancel = () => abortRef.current?.abort()

  const result = useMemo(() => {
    if (!raw) return null
    const info = new Map(vehicles.map(v => [v.id, v]))
    return overview(raw.events, {
      by, types, severities,
      vehicleLabel: id => info.get(Number(id))?.label,
      assignedDriver: id => info.get(Number(id))?.driver,
    })
  }, [raw, vehicles, by, types, severities])

  // A column per kind picked that happened in the period, in the order the
  // alert rules list them — a row of zeros for every rule nobody broke is noise.
  const columns = useMemo(() => {
    const kinds = ALL_TYPES.filter(t => types.includes(t) && (!result || result.totals[t]))
    const kindWidth = Math.max(4, Math.min(8, 52 / Math.max(1, kinds.length)))
    return [
      { key: 'label',  label: by === 'driver' ? 'Driver' : 'Vehicle', width: '11%', pdf: 10 },
      { key: 'other',  label: by === 'driver' ? 'Vehicles' : 'Driver', width: '12%', pdf: 11 },
      ...(by === 'vehicle' ? [{ key: 'branch', label: 'Branch', width: '10%', pdf: 9 }] : []),
      ...kinds.map(t => ({ key: `t_${t}`, label: alertTypeLabel(t), width: `${kindWidth}%`, pdf: 6, align: 'right', clickable: true })),
      { key: 'total',  label: 'Total',            width: '5%',  pdf: 5, align: 'right', clickable: true },
      { key: 'high',   label: 'High / Critical',  width: '6%',  pdf: 6, align: 'right' },
      { key: 'first',  label: 'First',            width: '10%', pdf: 10 },
      { key: 'last',   label: 'Last',             width: '10%', pdf: 10 },
    ]
  }, [types, by, result])
  const shownCols = useVisibleColumns(columns, hiddenCols)

  const groups = useMemo(() => {
    if (!result) return []
    const info = new Map(vehicles.map(v => [v.label, v]))
    const rows = result.rows.map(r => {
      const cells = Object.fromEntries(ALL_TYPES.map(t => [`t_${t}`, r.counts[t] ?? 0]))
      const one = info.get([...r.vehicles][0])
      return {
        key: r.key, label: r.label,
        other: by === 'driver' ? [...r.vehicles].join(', ') : ([...r.drivers].join(', ') || '—'),
        branch: one ? (one.branch !== one.company && one.branch !== '—' ? `${one.company} / ${one.branch}` : one.company) : '—',
        ...cells, total: r.total, high: r.high,
        first: formatDateTime(r.first), last: formatDateTime(r.last),
        cellStyle: { total: { fontWeight: 700 }, ...(r.high ? { high: HIGH_STYLE } : {}) },
      }
    })
    const perKind = [...result.seenTypes]
      .sort((a, b) => result.totals[b] - result.totals[a])
      .map(t => `${alertTypeLabel(t)} ${result.totals[t]}`).join('   ·   ')
    return [{
      key: 'all',
      label: by === 'driver' ? `All drivers (${rows.length})` : `All vehicles with alerts (${rows.length})`,
      rows,
      total: `Total ${result.total}   ·   High / Critical ${result.high}${perKind ? `   ·   ${perKind}` : ''}`,
    }]
  }, [result, vehicles, by])

  // A count opens the events behind it: one kind, or all of the row's.
  const openCount = (row, col) => {
    const r = result?.rows.find(x => x.key === row.key)
    if (!r) return
    const type = col.key.startsWith('t_') ? col.key.slice(2) : null
    const events = r.events.filter(e => !type || e.type === type).sort((a, b) => b.ts - a.ts)
    setEventList({ title: `${r.label} · ${type ? alertTypeLabel(type) : 'All violations'}`, events })
  }

  const applied = raw?.applied
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Alerts', typesLabel],
    ['Severity', sevLabel],
    ['Per', by === 'driver' ? 'Driver' : 'Vehicle'],
  ] : []
  const dataRows = groups.reduce((n, g) => n + g.rows.length, 0)

  const exportOpts = () => ({
    title: 'Violation Overview Report',
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: g.rows,
    })),
  })

  return (
    <ReportFrame title="Violation Overview Report" desc="How many violations of each kind every vehicle and driver had in the period." {...props}>
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
          <MultiSelect label="ALERTS" summary={typesLabel}>
            <CheckRow checked={types.length === VIOLATION_TYPES.length && VIOLATION_TYPES.every(t => types.includes(t))} onChange={() => setTypes(VIOLATION_TYPES)}>
              <strong>Violations only</strong>
            </CheckRow>
            <CheckRow checked={allTypes} onChange={() => setTypes(allTypes ? [] : ALL_TYPES)}><strong>All alerts</strong></CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {ALL_TYPES.map(t => (
              <CheckRow key={t} checked={types.includes(t)} onChange={() => toggleType(t)}>{alertTypeLabel(t)}</CheckRow>
            ))}
          </MultiSelect>
          <MultiSelect label="SEVERITY" summary={sevLabel}>
            {ALERT_SEVERITIES.map(s => (
              <CheckRow key={s} checked={(severities ?? ALERT_SEVERITIES).includes(s)} onChange={() => toggleSeverity(s)}>{s}</CheckRow>
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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>ONE LINE PER</span>
            <Chip active={by === 'vehicle'} onClick={() => setBy('vehicle')}>Vehicle</Chip>
            <Chip active={by === 'driver'} onClick={() => setBy('driver')}>Driver</Chip>
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
        <div className="report-screen-only" style={{ fontSize: 12.5, color: 'var(--c-text3)', marginBottom: 12 }}>
          Alerts are raised by the server, so this report has data only when signed in to it.
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

      {result && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{result.total.toLocaleString()}</strong> alert{result.total === 1 ? '' : 's'}
              {' · '}{dataRows} {by === 'driver' ? 'driver' : 'vehicle'}{dataRows === 1 ? '' : 's'}
              {raw.truncated && <span style={{ color: '#f97316' }}> · the period has more alerts than one report reads — narrow the range for exact counts</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={columns} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'Violation_Overview_Report')} icon={FileDown} primary disabled={!dataRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'Violation_Overview_Report')} icon={FileSpreadsheet} disabled={!dataRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!dataRows}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title="Violation Overview Report"
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            onCellClick={openCount}
            emptyText="No alerts of these kinds in this period for the selected vehicles."
          />
        </>
      )}

      <EventListModal list={eventList} onPick={setTrack} onClose={closeList} />
      <EventTrackModal event={track} onClose={closeTrack} />
    </ReportFrame>
  )
}
