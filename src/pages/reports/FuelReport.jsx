import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, Play, Fuel, Info } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton } from '../../components/reports/controls'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { useHiddenColumns, visibleColumns, columnChoices } from '../../utils/reportColumns'
import FuelLineChart from '../../components/fuel/FuelLineChart'
import { CARD_SURFACE } from '../settings/formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { handleApiError } from '../settings/pageChrome'
import { useCompanies, useVehicles } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { fetchFuelReport } from '../../data/fuel'
import { vehicleLabel } from '../../utils/vehicleLabel'
import { formatPrintDate } from '../../utils/movementReport'
import { locationUrl } from '../../utils/mapLink'
import { reverseGeocodeMany, geocodeKey, shortenAddress } from '../../utils/geocode'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { renderFuelChartPng } from '../../utils/fuelChartImage'
import { fmtLitres, fmtRaw } from '../../utils/fuelFormat'
import { DEFAULT_THRESHOLD_L } from '../../utils/fuelEvents'
import { ReportSkeleton } from '../../components/Skeleton'

/**
 * Reports › Fuel › Fuel Report (client, 2026-11-24: "We need a fuel graph
 * report"). Per vehicle: the fuel level over the period as a graph, the
 * figures (start, end, lowest, highest, litres used, fills and drains) and
 * every fill and drain with its time, place and the level before and after.
 *
 * The server builds it (GET /api/fuel/report, server/src/lib/fuel.js) with
 * the shared rules of utils/fuelEvents.js: noise filtered with a median of 3,
 * readings outside the calibration left out, a fill = a rise of at least the
 * threshold, a drain = a fall of at least the threshold while the vehicle
 * stands (fuel used while driving is not a drain). A vehicle without a
 * calibration shows its raw sensor values and says so.
 *
 * Screen, PDF and Excel on the Movement paper; the graphs go into the PDF and
 * Excel as images.
 */

const UAE = 4 * 3600_000
const pad = n => String(n).padStart(2, '0')
/** UAE time "20-11-2026 14:05". */
function fmtTime(ms) {
  const d = new Date(ms + UAE)
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
const fmtDay = s => { const [y, m, d] = String(s).split('-'); return d ? `${d}-${m}-${y}` : s }
/** "YYYY-MM-DD" UAE day → the UTC instant it starts. */
const dayStartMs = s => Date.parse(`${s}T00:00:00Z`) - UAE

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'd7', label: 'Last 7 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]
/** The days are UAE days, whatever the browser's own time zone. */
const uaeDay = ms => new Date(ms + UAE).toISOString().slice(0, 10)
function presetDays(key, now = new Date()) {
  const t = now.getTime()
  const today = uaeDay(t)
  const back = n => uaeDay(t - n * 86400_000)
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: back(1), to: back(1) }
    case 'd7': return { from: back(6), to: today }
    case 'thisMonth': return { from: `${today.slice(0, 8)}01`, to: today }
    default: return null
  }
}

const SUMMARY_COLUMNS = [
  { key: 'vehicle', label: 'Vehicle',          width: '16%', pdf: 15 },
  { key: 'start',   label: 'Start',            width: '9%',  pdf: 9, align: 'right' },
  { key: 'end',     label: 'End',              width: '9%',  pdf: 9, align: 'right' },
  { key: 'min',     label: 'Lowest',           width: '9%',  pdf: 9, align: 'right' },
  { key: 'max',     label: 'Highest',          width: '9%',  pdf: 9, align: 'right' },
  { key: 'used',    label: 'Used (driving)',   width: '11%', pdf: 11, align: 'right' },
  { key: 'fills',   label: 'Fills',            width: '12%', pdf: 12, align: 'right' },
  { key: 'drains',  label: 'Drains',           width: '12%', pdf: 12, align: 'right' },
  { key: 'note',    label: 'Note',             width: '13%', pdf: 14 },
]
const EVENT_COLUMNS = [
  { key: 'time',     label: 'Time',          width: '15%', pdf: 14 },
  { key: 'vehicle',  label: 'Vehicle',       width: '13%', pdf: 12 },
  { key: 'kind',     label: 'Event',         width: '8%',  pdf: 7 },
  { key: 'litres',   label: 'Litres',        width: '9%',  pdf: 8, align: 'right' },
  { key: 'before',   label: 'Before',        width: '9%',  pdf: 8, align: 'right' },
  { key: 'after',    label: 'After',         width: '9%',  pdf: 8, align: 'right' },
  { key: 'duration', label: 'Duration',      width: '9%',  pdf: 8 },
  { key: 'location', label: 'Location',      width: '28%', pdf: 25, hrefKey: 'href' },
]

const dur = ms => {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const plain = v => (typeof v === 'string' ? v.replace(/\s*·\s*/g, ' - ').replace(/[–—]/g, '-') : v)
const plainRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]))

export default function FuelReport(props) {
  const title = useReportTitle('Fuel Report')
  const { toasts, push, dismiss } = useToasts()
  const companies = useCompanies()
  const settingsVehicles = useVehicles()
  const now = useMemo(() => new Date(), [])
  const [preset, setPreset] = useState('today')
  const [from, setFrom] = useState(() => presetDays('today', now).from)
  const [to, setTo] = useState(() => presetDays('today', now).to)
  const [threshold, setThreshold] = useState(String(DEFAULT_THRESHOLD_L))
  const [selectedIds, setSelectedIds] = useState(null) // null = every fuel vehicle
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hiddenCols, setHiddenCols] = useHiddenColumns('fuel')

  const vehicles = useMemo(() => (settingsVehicles ?? [])
    .map(v => ({ id: String(v.id), label: vehicleLabel(v) || String(v.id), company: companies.find(c => String(c.id) === String(v.companyId))?.name ?? '', fuel: v.dataSource === 'UFFIZIO' }))
    .sort((a, b) => (b.fuel - a.fuel) || a.label.localeCompare(b.label)), [settingsVehicles, companies])
  const allSelected = selectedIds === null
  const selectionLabel = allSelected ? 'All fuel vehicles' : selectedIds.length === 0 ? 'Select vehicles'
    : selectedIds.length === 1 ? (vehicles.find(v => v.id === selectedIds[0])?.label ?? '1 vehicle') : `${selectedIds.length} vehicles`
  const toggleVehicle = id => setSelectedIds(prev => {
    const base = prev ?? []
    return base.includes(id) ? base.filter(x => x !== id) : [...base, id]
  })

  const applyPreset = key => {
    setPreset(key)
    const r = presetDays(key)
    if (r) { setFrom(r.from); setTo(r.to) }
  }
  const thresholdNum = Number(threshold)
  const thresholdOk = Number.isFinite(thresholdNum) && thresholdNum >= 1 && thresholdNum <= 1000
  const spanDays = from && to ? (Date.parse(to) - Date.parse(from)) / 86400_000 + 1 : 0
  const rangeValid = !!from && !!to && from <= to && spanDays <= 31
  const canRun = IS_REAL && rangeValid && thresholdOk && (allSelected || selectedIds.length > 0) && !loading

  const run = async () => {
    setLoading(true)
    try {
      const d = await fetchFuelReport({
        from: new Date(dayStartMs(from)).toISOString(),
        to: new Date(dayStartMs(to) + 86400_000 - 1).toISOString(),
        vehicleIds: allSelected ? null : selectedIds,
        threshold: thresholdNum,
      })
      setReport({ ...d, fromMs: dayStartMs(from), toMs: Math.min(Date.now(), dayStartMs(to) + 86400_000 - 1), printDate: formatPrintDate(), range: { from, to }, thresholdL: thresholdNum })
    } catch (err) {
      handleApiError(err, { push })
    } finally {
      setLoading(false)
    }
  }

  const list = report?.vehicles ?? []

  // The events' places, as addresses when the geocoder knows them (coordinates until then).
  const [addresses, setAddresses] = useState(() => new Map())
  useEffect(() => {
    const coords = (report?.vehicles ?? []).flatMap(v => v.events).filter(e => e.lat != null && e.lng != null).map(e => ({ lat: e.lat, lng: e.lng }))
    if (!coords.length) return
    const ctrl = new AbortController()
    reverseGeocodeMany(coords, { limit: 60, signal: ctrl.signal })
      .then(r => setAddresses(r.addresses))
      .catch(() => {})
    return () => ctrl.abort()
  }, [report])
  const placeOf = e => (e.lat != null && e.lng != null ? shortenAddress(addresses.get(geocodeKey(e.lat, e.lng)), 4) || `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : '—')
  const val = (v, unit) => (v === null || v === undefined ? '—' : unit === 'L' ? fmtLitres(v) : fmtRaw(v))
  const summaryRows = list.map(v => ({
    key: v.vehicleId,
    vehicle: v.label,
    start: val(v.summary.start, v.unit), end: val(v.summary.end, v.unit), min: val(v.summary.min, v.unit), max: val(v.summary.max, v.unit),
    used: v.calibrated ? val(v.summary.used, 'L') : '—',
    fills: v.calibrated ? `${v.summary.fills}${v.summary.fills ? ` (${fmtLitres(v.summary.filled)})` : ''}` : '—',
    drains: v.calibrated ? `${v.summary.drains}${v.summary.drains ? ` (${fmtLitres(v.summary.drained)})` : ''}` : '—',
    note: !v.summary.readings ? 'No readings' : !v.calibrated ? 'Not calibrated: raw values' : v.outOfRange ? `${v.outOfRange} reading${v.outOfRange === 1 ? '' : 's'} outside the calibration left out` : '',
  }))
  const eventRows = list.flatMap(v => v.events.map((e, i) => ({
    key: `${v.vehicleId}-${i}`,
    time: fmtTime(e.startTs),
    vehicle: v.label,
    kind: e.kind === 'fill' ? 'Fill' : 'Drain',
    litres: `${e.kind === 'fill' ? '+' : '−'}${fmtLitres(e.litres)}`,
    before: fmtLitres(e.before), after: fmtLitres(e.after),
    duration: dur(e.endTs - e.startTs),
    location: placeOf(e),
    href: e.lat != null && e.lng != null ? locationUrl({ lat: e.lat, lng: e.lng, vehicle: v.label, time: Math.floor(e.startTs / 1000) }) : null,
    ts: e.startTs,
  }))).sort((a, b) => a.ts - b.ts)

  // On screen the place links to our map page, as in the PDF.
  const screenEventRows = eventRows.map(r => (r.href ? { ...r, location: <a href={r.href} target="_blank" rel="noreferrer" style={{ color: '#0a7e9c' }}>{r.location}</a> } : r))
  const sumCols = visibleColumns(SUMMARY_COLUMNS, hiddenCols)
  const evCols = visibleColumns(EVENT_COLUMNS, hiddenCols)
  const totals = list.reduce((s, v) => ({ fills: s.fills + (v.summary.fills ?? 0), drains: s.drains + (v.summary.drains ?? 0), filled: s.filled + (v.summary.filled ?? 0), drained: s.drained + (v.summary.drained ?? 0) }), { fills: 0, drains: 0, filled: 0, drained: 0 })
  const paperFilters = report ? [
    ['Vehicles', allSelected ? 'All fuel vehicles' : selectionLabel],
    ['From', fmtDay(report.range.from)],
    ['To', fmtDay(report.range.to)],
    ['Fill / drain threshold', `${report.thresholdL} L`],
  ] : []
  const summary = [
    { label: 'Vehicles', value: String(list.length) },
    { label: 'Fills', value: `${totals.fills} (${fmtLitres(totals.filled)})` },
    { label: 'Drains', value: `${totals.drains} (${fmtLitres(totals.drained)})` },
  ]

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filters: paperFilters,
    printDate: report.printDate,
    systemName: 'FleetmaxX',
    reportSummary: summary,
    hiddenColumns: hiddenCols,
    figures: list.map(v => ({
      heading: plain(`${v.label}${v.company ? ` - ${v.company}` : ''} - fuel level${v.calibrated ? ' (litres)' : ' (raw sensor value, not calibrated)'}`),
      image: renderFuelChartPng({ series: v.series, events: v.events, unit: v.unit }),
      format: 'jpeg',
      aspect: 420 / 1600,
    })).filter(f => f.image),
    tables: [
      { heading: 'Summary', columns: SUMMARY_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: summaryRows.map(plainRow) },
      ...(eventRows.length ? [{ heading: 'Fills and drains', columns: EVENT_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.hrefKey })), rows: eventRows.map(r => plainRow({ ...r, litres: r.litres.replace('−', '-') })) }] : []),
    ],
  })
  const fail = err => push(err.message || String(err), { tone: 'error' })
  const file = fileNameOf(title)

  return (
    <ReportFrame title={title} desc="The fuel level of each vehicle over a period, its fills and drains, and the litres used." {...props}>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Fuel readings are kept on the server, so this report needs the server and is not available in demo mode.</div>
      ) : (
        <>
          <div className="report-screen-only" style={{ ...CARD_SURFACE, padding: 16, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
              <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
                <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All fuel vehicles</strong></CheckRow>
                <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                {vehicles.map(v => (
                  <CheckRow key={v.id} checked={!allSelected && selectedIds.includes(v.id)} onChange={() => toggleVehicle(v.id)} note={v.fuel ? 'Uffizio' : v.company || null}>{v.label}</CheckRow>
                ))}
              </MultiSelect>
              <div>
                <label style={LABEL} htmlFor="fuel-from">FROM DATE</label>
                <input id="fuel-from" type="date" style={FIELD} value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPreset('custom') }} />
              </div>
              <div>
                <label style={LABEL} htmlFor="fuel-to">TO DATE</label>
                <input id="fuel-to" type="date" style={FIELD} value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPreset('custom') }} />
              </div>
              <div>
                <label style={LABEL} htmlFor="fuel-th">FILL / DRAIN AT (LITRES)</label>
                <input id="fuel-th" type="number" min="1" max="1000" step="1" style={FIELD} value={threshold} onChange={e => setThreshold(e.target.value)} />
              </div>
              <ToolbarButton onClick={run} icon={Play} primary disabled={!canRun}>{loading ? 'Generating report…' : 'Generate'}</ToolbarButton>
            </div>
            {!rangeValid && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#dc2626' }}>{from > to ? 'The From date must be on or before the To date.' : 'Choose up to 31 days.'}</p>}
            {!thresholdOk && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#dc2626' }}>The threshold is a number of litres from 1 to 1000.</p>}
          </div>

          {loading && !report && <ReportSkeleton label="Generating report…" />}
          {report && (
            <>
              <div className="report-screen-only" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                  {list.length} vehicle{list.length === 1 ? '' : 's'} · {totals.fills} fill{totals.fills === 1 ? '' : 's'} · {totals.drains} drain{totals.drains === 1 ? '' : 's'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ColumnPicker columns={columnChoices(SUMMARY_COLUMNS, EVENT_COLUMNS)} hidden={hiddenCols} onChange={setHiddenCols} />
                  <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), file).catch(fail)} icon={FileDown} primary disabled={!list.length}>Download PDF</ToolbarButton>
                  <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), file).catch(fail)} icon={FileSpreadsheet} disabled={!list.length}>Download Excel</ToolbarButton>
                  <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!list.length}>Print</ToolbarButton>
                </div>
              </div>

              {list.length === 0 ? (
                <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>
                  No fuel readings for these vehicles in this period. Fuel comes from the Uffizio feed (Settings › Master › Fuel).
                </div>
              ) : (
                <>
                  <div className="report-screen-only" style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
                    {list.map(v => (
                      <section key={v.vehicleId} style={{ ...CARD_SURFACE, padding: '14px 16px' }} aria-label={`Fuel level of ${v.label}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                          <Fuel size={15} aria-hidden="true" style={{ color: 'var(--ft-accent)' }} />
                          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--c-text1)' }}>{v.label}</span>
                          {v.company && <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>{v.company}</span>}
                          <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>· {v.calibrated ? 'litres' : 'raw sensor value'}{v.port ? ` · ${v.port}` : ''}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text2)', fontVariantNumeric: 'tabular-nums' }}>
                            {!v.summary.readings ? 'No fuel readings in this period' : v.calibrated ? `${fmtLitres(v.summary.start)} → ${fmtLitres(v.summary.end)} · used ${fmtLitres(v.summary.used)}` : `${fmtRaw(v.summary.start)} → ${fmtRaw(v.summary.end)}`}
                          </span>
                        </div>
                        {!v.calibrated && v.summary.readings > 0 && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--c-text2)', padding: '7px 10px', borderRadius: 9, background: 'color-mix(in srgb, #d97706 10%, transparent)', marginBottom: 8 }}>
                            <Info size={14} aria-hidden="true" style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                            Not calibrated: the graph shows the sensor’s raw value, and no fills or drains are worked out. Apply a calibration in Settings › Master › Fuel.
                          </div>
                        )}
                        <FuelLineChart
                          height={200}
                          ariaLabel={`Fuel level of ${v.label} over the period`}
                          points={v.series.map(p => ({ x: p.ts, y: p.v }))}
                          markers={v.events.map(e => ({ x: e.endTs, y: e.after, kind: e.kind, label: `${e.kind === 'fill' ? '+' : '−'}${Math.round(e.litres)} L` }))}
                          xTicks={timeTicks}
                          xFormat={x => axisTime(x, spanOf(v.series))}
                          yFormat={y => (v.unit === 'L' ? `${y} L` : fmtRaw(y))}
                          tipX={x => fmtTime(x)}
                          tipY={y => (v.unit === 'L' ? fmtLitres(y) : `raw ${fmtRaw(y)}`)}
                          yMin={v.unit === 'L' ? 0 : undefined}
                        />
                      </section>
                    ))}
                  </div>
                  <PaperTable
                    title={title}
                    company="FleetmaxX"
                    filters={paperFilters}
                    columns={sumCols}
                    groups={[{ key: 'summary', label: 'Summary', rows: summaryRows, total: false }]}
                    printDate={report.printDate}
                    summary={summary}
                  />
                  <div style={{ marginTop: 18 }}>
                    <PaperTable
                      title="Fills and drains"
                      company="FleetmaxX"
                      filters={paperFilters}
                      columns={evCols}
                      groups={eventRows.length ? [{ key: 'events', label: 'Fills and drains', rows: screenEventRows, total: false }] : []}
                      printDate={report.printDate}
                      emptyText={`No fill or drain of ${report.thresholdL} L or more in this period.`}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ReportFrame>
  )
}

const spanOf = series => (series.length ? series[series.length - 1].ts - series[0].ts : 0)

/** Ticks on round UAE hours or midnights, about one per 120 px. */
function timeTicks(from, to, width = 760) {
  const span = to - from
  const want = Math.max(2, Math.floor(width / 120))
  const steps = [3600_000, 2 * 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 86400_000, 2 * 86400_000, 5 * 86400_000, 7 * 86400_000]
  const step = steps.find(st => span / st <= want) ?? steps[steps.length - 1]
  const first = Math.ceil((from + UAE) / step) * step - UAE
  const out = []
  for (let t = first; t <= to; t += step) out.push(t)
  return out
}
function axisTime(ms, span) {
  const d = new Date(ms + UAE)
  return span > 36 * 3600_000 ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}${d.getUTCHours() ? ` ${pad(d.getUTCHours())}h` : ''}` : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
