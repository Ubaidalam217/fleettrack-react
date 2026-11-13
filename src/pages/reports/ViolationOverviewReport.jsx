import { useCallback, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import CtrackPaper from '../../components/reports/CtrackPaper'
import EventListModal from '../../components/reports/EventListModal'
import EventTrackModal from '../../components/reports/EventTrackModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, ReportByToggle, DriverMultiSelect } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import { alertTypeLabel, settingsProfileForImei, useVehicles, useCompanies, useAlerts } from '../../data/settings'
import { fetchAlertEventsInRange } from '../../data/alertEvents'
import { IS_REAL } from '../../data/mode'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { exportCtrackPdf, exportCtrackExcel, CTRACK_RED } from '../../utils/ctrackExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { driverIdentity, driverPasses, NO_DRIVER } from '../../utils/driverAtTime'
import { overviewByRule, periodDays, localDay } from '../../utils/violationOverview'
import { isOilGasViolation } from '../../utils/oilGasViolations'
import { hubForReport, OIL_GAS_HUB_PATH } from '../../components/sidebar/reportsNav'

/**
 * Violation Overview Report, in the layout of the client's Ctrack sample
 * (Violation_Overview_Report, 2026-11-13): every alert rule by name against
 * each day of the period with its Total Occurrences — the rules nobody broke
 * as zeros — then the "By Occurrence" chart, then per driver (or vehicle) a
 * count of each rule that occurred and the Sum of Violations.
 *
 * The counts are the alerts the server raised (GET /api/alert-events, already
 * narrowed to what the signed-in user may see); rule names come from the
 * rules in Settings, so a renamed rule reads with its new name. Maintenance
 * reminders are not rules and are left out.
 *
 * Client, 2026-11-10: every count opens its events, and each event opens on
 * the map from where the violation began to where it ended.
 */

const MAX_RANGE_DAYS = 31
const NOT_ASSIGNED = 'Not assigned'
// The sample's square page and type sizes (pt).
const PAGE = { w: 842, h: 842 }
const USABLE = PAGE.w - 28
const EVENT_W = 160, DAY_W = 61, ENTITY_W = 185, RULE_W = 90

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = n => String(n).padStart(2, '0')
/** '2026-11-07' → "07 Nov, 2026" */
const ctrackDay = iso => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${iso.slice(0, 4)}`
/** '2026-11-07' → "07, Nov 2026", as the sample's chart writes its dates */
const chartDay = iso => `${iso.slice(8, 10)}, ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
/** "07 Nov, 2026 00:00:00" */
const ctrackDateTime = ts => {
  const d = new Date(ts * 1000)
  return `${ctrackDay(localDay(ts))} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/** Column weights → the sheet's CSS widths. */
const onScreen = cols => {
  const sum = cols.reduce((s, c) => s + c.w, 0)
  return cols.map(c => ({ ...c, width: `${((c.w / sum) * 100).toFixed(3)}%` }))
}
const forPdf = cols => cols.map(c => ({ ...c, width: c.w }))

export default function ViolationOverviewReport(props) {
  const title = useReportTitle('Violation Overview Report') // Oil & Gas opens it as "Violation Overview"
  const file = fileNameOf(title)
  const { data } = useFlespiData()
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const allRules = useAlerts()
  // Opened from the Oil & Gas hub: its violations only — no temperature,
  // licence, ignition or geo zone enter / exit (utils/oilGasViolations.js).
  const { pathname, state: navState } = useLocation()
  const oilGas = hubForReport(pathname, navState) === OIL_GAS_HUB_PATH
  const alertRules = useMemo(() => (oilGas ? allRules.filter(r => isOilGasViolation(r.type)) : allRules), [allRules, oilGas])
  const dims = useDriverDimension()
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(() => liveVehicles.map(v => {
    const profile = settingsProfileForImei(v.ident)
    return {
      id: v.id,
      label: profile.plateNo || v.master?.plateNo || profile.fleetNo || v.name,
      company: profile.linked ? (profile.bgName || NOT_ASSIGNED) : NOT_ASSIGNED,
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
  const [ruleSel, setRuleSel] = useState(null)         // null = all (a Set of names otherwise)
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(presetRange('d7', now).from))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))

  const [raw, setRaw] = useState(null) // { events, truncated, applied }
  const [eventList, setEventList] = useState(null) // { title, events } of a clicked count
  const [track, setTrack] = useState(null)          // the event shown on the map
  const closeList = useCallback(() => setEventList(null), [])
  const closeTrack = useCallback(() => setTrack(null), [])
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
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
        : `${effectiveIds.length} vehicles`

  // The rules by name; one name for rules that share it.
  const ruleNames = useMemo(
    () => [...new Set(alertRules.map(r => (r.name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [alertRules],
  )
  const rulesLabel = !ruleSel ? 'All events' : ruleSel.size === 0 ? 'None' : ruleSel.size === 1 ? [...ruleSel][0] : `${ruleSel.size} events`

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
  const toggleRule = name => {
    const next = new Set(ruleSel ?? ruleNames)
    if (next.has(name)) next.delete(name); else next.add(name)
    setRuleSel(next.size === ruleNames.length && ruleNames.every(n => next.has(n)) ? null : next)
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
      setRaw({ events, truncated, applied: { fromTs, toTs, reportBy, printDate: ctrackDateTime(Math.floor(Date.now() / 1000)) } })
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, reportBy])

  const cancel = () => abortRef.current?.abort()

  const result = useMemo(() => {
    if (!raw) return null
    const { fromTs: from, toTs: to, reportBy: by } = raw.applied
    const info = new Map(vehicles.map(v => [v.id, v]))
    const nameById = new Map(alertRules.map(r => [r.id, (r.name || '').trim()]))
    // A deleted rule's events keep the name they were raised under.
    const nameOf = e => (e.type === 'reminder' || (oilGas && !isOilGasViolation(e.type)) ? null
      : nameById.get(e.alertId) || String(e.title ?? '').replace(/ · recorded$/, '').trim() || alertTypeLabel(e.type))
    const entityOf = e => {
      const v = info.get(Number(e.deviceId))
      if (by === 'vehicle') return { key: `v:${e.deviceId}`, label: v?.label ?? `Device ${e.deviceId}` }
      return driverIdentity(e.driver) ?? (v ? dims.assignedFor(v.live) : null) ?? NO_DRIVER
    }
    const days = periodDays(from, to)
    return {
      days,
      ...overviewByRule(raw.events, {
        ruleNames, nameOf, days, dayOf: localDay, entityOf,
        keepRule: ruleSel ? name => ruleSel.has(name) : null,
        keepEntity: by === 'driver' && driverSel ? who => driverPasses(who, driverSel) : null,
      }),
      vehicleLabel: id => info.get(Number(id))?.label ?? `Device ${id}`,
    }
  }, [raw, vehicles, alertRules, ruleNames, ruleSel, driverSel, dims, oilGas])

  const byDriver = raw?.applied.reportBy === 'driver'
  const sheet = useMemo(() => {
    if (!result) return null
    const { days, rules, entities } = result
    const dayCols = days.map(d => ({ key: `d_${d}`, label: ctrackDay(d), w: DAY_W, align: 'right', headColor: CTRACK_RED, clickable: true }))
    const ruleCols = [{ key: 'event', label: '', w: EVENT_W, bold: true }, ...dayCols, { key: 'total', label: 'Total Occurrences', w: DAY_W, align: 'right', clickable: true }]
    const ruleRows = rules.map(r => ({
      key: r.key, rule: r.key, event: r.label, total: r.total,
      ...Object.fromEntries(days.map(d => [`d_${d}`, r.byDay[d] ?? 0])),
    }))
    const used = rules.filter(r => r.total > 0)
    const entityCols = [
      { key: 'entity', label: byDriver ? 'Driver' : 'Asset', w: ENTITY_W, bold: true, color: CTRACK_RED },
      ...used.map((r, i) => ({ key: `r_${i}`, rule: r.key, label: r.label, w: RULE_W, align: 'right', clickable: true })),
      { key: 'sum', label: 'Sum of Violations', w: RULE_W, align: 'right', clickable: true },
    ]
    const entityRows = entities.map(en => ({
      key: en.key, entity: en.label, sum: en.total,
      ...Object.fromEntries(used.map((r, i) => [`r_${i}`, en.counts[r.key] ?? 0])),
    }))
    const fitOf = cols => Math.min(1, cols.reduce((s, c) => s + c.w, 0) / USABLE)
    return {
      rules: { key: 'rules', columns: ruleCols, rows: ruleRows, zebra: false, fit: fitOf(ruleCols), minWidth: 120 + 70 * (days.length + 1) },
      chart: {
        key: 'chart', kind: 'lineChart', title: 'By Occurrence', yLabel: 'No. of Occurrences', xLabel: 'Date',
        labels: days.map(chartDay),
        series: rules.map(r => ({ name: r.label, values: days.map(d => r.byDay[d] ?? 0) })),
      },
      entities: { key: 'entities', newPage: true, columns: entityCols, rows: entityRows, zebra: false, fit: fitOf(entityCols), minWidth: 160 + 90 * (used.length + 1) },
    }
  }, [result, byDriver])

  // A count opens the events behind it.
  const openCount = (row, col, table) => {
    if (!result) return
    let pick, what
    if (table.key === 'rules') {
      const day = col.key.startsWith('d_') ? col.key.slice(2) : null
      pick = it => it.rule === row.rule && (!day || it.day === day)
      what = `${row.event} · ${day ? ctrackDay(day) : 'all days'}`
    } else {
      const rule = col.rule ?? null
      pick = it => it.entity.key === row.key && (!rule || it.rule === rule)
      what = `${row.entity} · ${rule ?? 'all violations'}`
    }
    const events = result.items.filter(pick).sort((a, b) => b.ts - a.ts).map(it => ({
      ...it.event,
      name: it.rule,
      deviceId: Number(it.event.deviceId), vehicle: result.vehicleLabel(it.event.deviceId), ts: it.ts,
      driver: it.entity.key.startsWith('v:') ? (it.event.driver?.name ?? '') : it.entity.label,
    }))
    setEventList({ title: what, events })
  }

  const applied = raw?.applied
  const pairs = applied ? [
    ['From', ctrackDateTime(applied.fromTs)], ['Date Group', 'Day'],
    ['To', ctrackDateTime(applied.toTs)], ['Entity Group', byDriver ? 'Driver' : 'Asset'],
  ] : []
  const tables = sheet ? [sheet.rules, sheet.chart, ...(sheet.entities.rows.length ? [sheet.entities] : [])] : []
  const hasRows = !!sheet && sheet.rules.rows.length > 0

  const ctrackOpts = () => ({
    title,
    pageSize: PAGE,
    fontSize: 9,
    titleSize: 20,
    headerRuleY: 74,
    rowPad: 7,
    pairCols: [{ x: 5, vx: 41 }, { x: 167, vx: 251 }],
    pairLineH: 20,
    pairTop: 11,
    printDate: applied?.printDate,
    pairs,
    tables: tables.map(t => (t.columns ? { ...t, columns: forPdf(t.columns) } : t)),
  })

  return (
    <ReportFrame title={title} desc="How many times each alert rule was broken, day by day and per driver or vehicle." {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <ReportByToggle id="violation-overview-report-by" value={reportBy} onChange={v => { setReportBy(v); setRaw(null) }} />
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
          <MultiSelect label="EVENTS" summary={rulesLabel} disabled={ruleNames.length === 0}>
            <CheckRow checked={!ruleSel} onChange={() => setRuleSel(ruleSel ? null : new Set())}><strong>All events</strong></CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {ruleNames.map(n => (
              <CheckRow key={n} checked={!ruleSel || ruleSel.has(n)} onChange={() => toggleRule(n)}>{n}</CheckRow>
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
              <strong style={{ color: 'var(--c-text1)' }}>{result.total.toLocaleString()}</strong> occurrence{result.total === 1 ? '' : 's'}
              {' · '}{result.entities.length} {byDriver ? 'driver' : 'vehicle'}{result.entities.length === 1 ? '' : 's'}
              {' · '}{result.rules.length} event{result.rules.length === 1 ? '' : 's'} · a count opens its events
              {raw.truncated && <span style={{ color: '#f97316' }}> · the period has more alerts than one report reads — narrow the range for exact counts</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportCtrackPdf(ctrackOpts(), file)} icon={FileDown} primary disabled={!hasRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportCtrackExcel(ctrackOpts(), file)} icon={FileSpreadsheet} disabled={!hasRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!hasRows}>Print</ToolbarButton>
            </div>
          </div>

          <CtrackPaper
            title={title}
            pairs={pairs}
            tables={tables.map(t => (t.columns ? { ...t, columns: onScreen(t.columns) } : t))}
            printDate={applied.printDate}
            onCellClick={openCount}
            emptyText="No alert rules are set up, and no alerts were raised in this period."
          />
        </>
      )}

      <EventListModal list={eventList} onPick={setTrack} onClose={closeList} />
      <EventTrackModal event={track} onClose={closeTrack} />
    </ReportFrame>
  )
}
