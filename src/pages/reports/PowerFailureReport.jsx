import { useCallback, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import CtrackPaper from '../../components/reports/CtrackPaper'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, HelpTip } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { PRESETS, presetRange, dateStr, timeStr } from '../../utils/reportRange'
import { exportCtrackPdf, exportCtrackExcel, CTRACK_RED } from '../../utils/ctrackExport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { hms } from '../../utils/usageReports'
import { localDay } from '../../utils/violationOverview'
import { DEFAULT_POWER_OPTS, POWER_FIELDS, powerCutsByVehicle, cutsByDay } from '../../utils/powerFailure'

/**
 * Power Failure Report, in the layout of the client's Ctrack sample
 * (Power_Failure_Report, 2026-11-13): portrait, the From / To block, then
 * day by day each cut of a vehicle's external power — Asset, From, To (with
 * the date when the power came back on another day) and Duration — closed by
 * the day's "No. of Occurrences" and summed duration; the Report Summary
 * table (Asset, No. of Occurrences, Duration) on the last page. The cut rules
 * live in utils/powerFailure.js (voltage under the cut-below, or the
 * tracker's own power status — iTriangle and Teltonika alike).
 *
 * Cut below (V) and the short-cut filter recompute from the fetched messages —
 * changing them never fetches again. Trackers that send no external-power
 * reading are named above the sheet instead of passing as "no cuts".
 *
 * Scope: vehicles come from useFlespiData(), already narrowed to what the
 * signed-in user may see (see components/sidebar/reportsNav.js).
 */

const TITLE = 'Power Failure Report'
const FILE = 'Power_Failure_Report'
const DESC = 'Each time a tracker lost its external power: from when, until when and for how long.'
const MAX_RANGE_DAYS = 31
// The sample's page (7 x 11 in) and where its tables sit.
const PAGE = { w: 504, h: 792 }
const USABLE = PAGE.w - 28
const DAY_TABLE = { fit: 452 / USABLE, indent: 16 / USABLE }
const SUMMARY_TABLE = { fit: 344 / USABLE, indent: 32 / USABLE }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = n => String(n).padStart(2, '0')
/** '2026-11-07' → "07 Nov, 2026" */
const ctrackDay = iso => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${iso.slice(0, 4)}`
const clock = ts => {
  const d = new Date(ts * 1000)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/** "07 Nov, 2026 00:00:00" */
const ctrackDateTime = ts => `${ctrackDay(localDay(ts))} ${clock(ts)}`
/** The sample's To: the time, or "08/11/2026 07:09:55" when the power came back on another day. */
const toCell = (startTs, endTs) => {
  const day = localDay(endTs)
  return day === localDay(startTs) ? clock(endTs) : `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)} ${clock(endTs)}`
}

const DAY_COLS = [
  { key: 'asset',    label: 'Asset',    w: 172 },
  { key: 'from',     label: 'From',     w: 82, align: 'right' },
  { key: 'to',       label: 'To',       w: 140, align: 'right' },
  { key: 'duration', label: 'Duration', w: 58, align: 'right' },
]
const SUMMARY_COLS = [
  { key: 'asset',    label: 'Asset',              w: 180 },
  { key: 'count',    label: 'No. of Occurrences', w: 104, align: 'right' },
  { key: 'duration', label: 'Duration',           w: 60, align: 'right' },
]
const onScreen = cols => {
  const sum = cols.reduce((s, c) => s + c.w, 0)
  return cols.map(c => ({ ...c, width: `${((c.w / sum) * 100).toFixed(3)}%` }))
}
const forPdf = cols => cols.map(c => ({ ...c, width: c.w }))
const names = list => list.join(', ')

export default function PowerFailureReport(props) {
  const title = useReportTitle(TITLE) // Oil & Gas opens it as "Power Failure"
  const file = title === TITLE ? FILE : fileNameOf(title)
  const { data } = useFlespiData()
  // The live feed hands over a new vehicle array on every poll. The report only
  // cares which vehicles there are and what they are called, so it keys on that.
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(
    () => liveVehicles.slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehiclesKey]
  )

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
      setRaw({ byDevice, applied: { fromTs, toTs, endTs } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs])

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
    const { days, perVehicle, hidden } = cutsByDay(vehiclePower, { dayOf: localDay, minCutMin: minNum })
    const tables = days.map(d => ({
      key: d.day,
      heading: ctrackDay(d.day),
      headingColor: [0, 0, 0],
      headingSize: 9.8,
      ...DAY_TABLE,
      minWidth: 560,
      columns: DAY_COLS,
      rows: [
        ...d.cuts.map(c => ({
          key: `${c.deviceId}-${c.startTs}`,
          asset: c.vehicleId,
          from: c.beforePeriod ? `${clock(c.startTs)} (already off)` : clock(c.startTs),
          to: c.open ? '(still off)' : toCell(c.startTs, c.endTs),
          duration: hms(c.durationSec),
        })),
        { key: `${d.day}-total`, strong: true, asset: '', from: 'No. of Occurrences:', to: String(d.count), duration: hms(d.durationSec) },
      ],
    }))
    const summaryTable = {
      ...SUMMARY_TABLE,
      minWidth: 440,
      headColor: CTRACK_RED,
      zebraStart: false,
      columns: SUMMARY_COLS,
      rows: perVehicle.map(v => ({ key: v.deviceId, asset: v.vehicleId, count: String(v.count), duration: hms(v.durationSec) })),
    }
    return {
      tables,
      summaryTable,
      hidden,
      cuts: days.reduce((n, d) => n + d.count, 0),
      withCuts: perVehicle.length,
      open: days.reduce((n, d) => n + d.cuts.filter(c => c.open).length, 0),
      noReading: vehiclePower.filter(v => v.hasData && !v.reports).map(v => v.vehicleId),
      noData: vehiclePower.filter(v => !v.hasData).map(v => v.vehicleId),
    }
  }, [vehiclePower, minNum])

  const applied = raw?.applied
  const pairs = applied ? [['From', ctrackDateTime(applied.fromTs)], ['To', ctrackDateTime(applied.toTs)]] : []

  // The sample's footer has the page number only, no print date.
  const ctrackOpts = () => ({
    title,
    pageSize: PAGE,
    fontSize: 9.8,
    titleSize: 20,
    headerRuleY: 74,
    rowPad: 7,
    pairsPerLine: 1,
    pairCols: [{ x: 9, vx: 51 }],
    pairLineH: 20,
    pairTop: 15,
    printDate: '',
    pairs,
    tables: built.tables.map(t => ({ ...t, columns: forPdf(t.columns) })),
    summaryTitle: 'Report Summary:',
    summaryTable: built.cuts ? { ...built.summaryTable, columns: forPdf(built.summaryTable.columns) } : null,
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
                A power cut starts when the tracker reports its power lost (iTriangle and Teltonika send this as the
                external power status) or the vehicle supply falls below this voltage, and ends at the first reading
                with the power back. Vehicles run at 12 V or 24 V, so the default of 6 V only catches a real cut.
                &ldquo;Already off&rdquo; means the power was off at the first reading of the period, so the cut began
                earlier. &ldquo;Still off&rdquo; means the power had not come back by the end of the period; its time
                counts to then. Changing this does not fetch the data again.
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
              <strong style={{ color: 'var(--c-text1)' }}>{built.cuts.toLocaleString()}</strong> power cut{built.cuts === 1 ? '' : 's'}
              {' · '}{built.withCuts} vehicle{built.withCuts === 1 ? '' : 's'} with cuts
              {built.open > 0 && <span style={{ color: '#b91c1c' }}> · {built.open} still off at the end of the period</span>}
              {built.hidden > 0 && <span style={{ color: 'var(--c-text3)' }}> · {built.hidden} shorter cut{built.hidden === 1 ? '' : 's'} hidden</span>}
              {built.noReading.length > 0 && <span style={{ color: 'var(--c-text3)' }}> · No external power reading from: {names(built.noReading)}</span>}
              {built.noData.length > 0 && <span style={{ color: 'var(--c-text3)' }}> · No data in this period: {names(built.noData)}</span>}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — narrow the range for full detail</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportCtrackPdf(ctrackOpts(), file)} icon={FileDown} primary disabled={!built.cuts}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportCtrackExcel(ctrackOpts(), file)} icon={FileSpreadsheet} disabled={!built.cuts}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!built.cuts}>Print</ToolbarButton>
            </div>
          </div>

          <CtrackPaper
            title={title}
            pairs={pairs}
            pairsPerLine={1}
            tables={built.tables.map(t => ({ ...t, columns: onScreen(t.columns) }))}
            summaryTitle="Report Summary:"
            summaryTable={{ ...built.summaryTable, columns: onScreen(built.summaryTable.columns) }}
            printDate=""
            emptyText="No power cuts in this period for the selected vehicles."
          />
        </>
      )}
    </ReportFrame>
  )
}
