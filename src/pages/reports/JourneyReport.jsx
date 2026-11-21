import { useEffect, useMemo, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import CtrackPaper from '../../components/reports/CtrackPaper'
import { ToolbarButton, ReportByToggle, LABEL, FIELD } from '../../components/reports/controls'
import { ReportSkeleton } from '../../components/Skeleton'
import { CARD_SURFACE } from '../settings/formStyles'
import { IS_REAL } from '../../data/mode'
import { journeyReport } from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { exportCtrackPdf, exportCtrackExcel } from '../../utils/ctrackExport'
import { formatPrintDate } from '../../utils/movementReport'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import {
  STATUS_COLUMNS, statusRows, statusSummary, SUMMARY_COLUMNS, summaryRows, summaryTotals, DETAIL_COLUMNS, detailTables,
  GROUP_COLUMNS, groupRows, analytics, ANALYTICS_COLUMNS, dt,
} from '../../utils/journeyReports'

/**
 * Reports › Journey (client 2026-11-21, after Uffizio's five Job reports and
 * the client's own analytics list), on the Ctrack paper with the account's
 * logo, screen + PDF + Excel:
 *
 *   today-status   Today's Journey Status
 *   summary        Journey Summary: planned vs actual start / end, distance, delay, alerts, cost
 *   detail         Journey Detail Summary: per stop planned vs actual, early / on time / late, leg km, driver, events, signature, form
 *   vehicle        Vehicle Journey Summary
 *   driver         Driver Journey Summary (the driver of that time)
 *   customer       Customer Journey Summary
 *   analytics      Journey Analytics: on-time %, delay by route, route deviation frequency, planned vs actual distance
 *
 * Report By (vehicle / driver) groups the per-journey reports.
 */

const JOURNEY_REPORTS = Object.freeze({
  'today-status': { title: "Today's Journey Status", desc: 'Every journey of the day: where it is, the stops reached, the ETA and its state.' },
  summary: { title: 'Journey Summary', desc: 'Per journey: planned against actual start and end, distance, delay, alerts and cost.' },
  detail: { title: 'Journey Detail Summary', desc: 'Per stop: planned against actual arrival and departure, early / on time / late, leg distance, events, signature and form.' },
  vehicle: { title: 'Vehicle Journey Summary', desc: 'Per vehicle: journeys, on time, delay, distance, route deviations, alerts and cost.' },
  driver: { title: 'Driver Journey Summary', desc: 'Per driver (the driver of that journey): journeys, on time, delay, distance, deviations, alerts and cost.' },
  customer: { title: 'Customer Journey Summary', desc: 'Per customer: journeys, on time, delay, distance and cost.' },
  analytics: { title: 'Journey Analytics', desc: 'On-time %, delay by route, route deviation frequency, planned against driven distance.' },
})

const UAE_MS = 4 * 3600 * 1000
const dayKey = (off = 0) => new Date(Date.now() + UAE_MS + off * 86_400_000).toISOString().slice(0, 10)
const startOf = key => new Date(Date.parse(`${key}T00:00:00Z`) - UAE_MS).toISOString()
const pdfCols = cols => cols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align }))

export default function JourneyReport(props) {
  const { slug } = useParams()
  const meta = JOURNEY_REPORTS[slug]
  const today = slug === 'today-status'
  const [from, setFrom] = useState(() => dayKey(today ? 0 : -6))
  const [to, setTo] = useState(() => dayKey(0))
  const [by, setBy] = useState('vehicle')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const dim = useDriverDimension()

  useEffect(() => {
    if (!IS_REAL || !meta) return
    let live = true
    setRows(null)
    journeyReport({ from: startOf(today ? dayKey(0) : from), to: startOf(nextDay(today ? dayKey(0) : to)) })
      .then(r => { if (live) { setRows(r.data); setError(null) } })
      .catch(e => { if (live) { setRows([]); setError(errorMessage(e, 'Could not load the journeys')) } })
    return () => { live = false }
  }, [from, to, today, meta])

  /** The driver of that journey: its own, else whoever drove the vehicle then (driver history). */
  const driverOf = useMemo(() => j => {
    if (j.driverName) return j.driverName
    if (!j.vehicleImei) return '—'
    const ts = Math.floor(Date.parse(j.actualStart ?? j.plannedStart) / 1000)
    return dim.assignedFor({ ident: j.vehicleImei }, ts)?.label ?? '—'
  }, [dim])

  const printDate = useMemo(() => formatPrintDate(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => (rows && meta ? build(slug, rows, { by, driverOf }) : null), [slug, rows, by, driverOf, meta])
  if (!meta) return <Navigate to="/reports" replace />

  const pairs = [
    ['From', today ? dt(startOf(dayKey(0))) : dt(startOf(from))],
    ['To', today ? 'Now' : dt(new Date(Date.parse(startOf(nextDay(to))) - 60_000).toISOString())],
    ...(built?.grouped ? [['Grouped By', by === 'driver' ? 'Driver' : 'Vehicle']] : []),
    ['Journeys', String(rows?.length ?? 0)],
  ]
  const exportOpts = () => ({ title: meta.title, pairs, tables: built.tables.map(t => ({ ...t, columns: pdfCols(t.columns) })), summary: built.summary, printDate })
  const fileName = meta.title.replace(/[^\w]+/g, '_')
  const fail = e => setError(e.message || String(e))

  return (
    <ReportFrame title={meta.title} desc={meta.desc} {...props}>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Journeys are kept on the server, so they are not available in demo mode.</div>
      ) : (
        <>
          <div className="report-screen-only" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
            {!today && (
              <>
                <div><label style={LABEL}>FROM</label><input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} style={{ ...FIELD, height: 34 }} aria-label="From" /></div>
                <div><label style={LABEL}>TO</label><input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} style={{ ...FIELD, height: 34 }} aria-label="To" /></div>
              </>
            )}
            {['today-status', 'summary', 'detail'].includes(slug) && <div style={{ minWidth: 180 }}><ReportByToggle value={by} onChange={setBy} /></div>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportCtrackPdf(exportOpts(), fileName).catch(fail)} icon={FileDown} primary disabled={!rows?.length}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportCtrackExcel(exportOpts(), fileName).catch(fail)} icon={FileSpreadsheet} disabled={!rows?.length}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!rows?.length}>Print</ToolbarButton>
            </div>
          </div>
          {error && <div style={{ ...CARD_SURFACE, padding: 12, marginBottom: 12, color: '#dc2626', fontSize: 13 }}>{error}</div>}
          {slug === 'analytics' && built?.kpis && <Kpis k={built.kpis} />}
          {rows === null ? <ReportSkeleton label="Loading the journeys…" /> : (
            <CtrackPaper title={meta.title} pairs={pairs} tables={built.tables} summary={built.summary} printDate={printDate} emptyText="No journeys planned in this period." />
          )}
        </>
      )}
    </ReportFrame>
  )
}

const nextDay = key => new Date(Date.parse(`${key}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** The tables, summary and KPIs of one report. */
function build(slug, rows, { by = 'vehicle', driverOf = j => j.driverName || '—' } = {}) {
  const groupKey = j => (by === 'driver' ? driverOf(j) : j.vehicleLabel)
  const grouped = list => {
    const m = new Map()
    for (const j of list) { const k = groupKey(j) || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(j) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }
  switch (slug) {
    case 'today-status':
      return {
        grouped: true,
        tables: grouped(rows).map(([k, list]) => ({ key: k, heading: k, columns: STATUS_COLUMNS, rows: statusRows(list) })),
        summary: statusSummary(rows),
      }
    case 'summary':
      return {
        grouped: true,
        tables: grouped(rows).map(([k, list]) => ({ key: k, heading: k, columns: SUMMARY_COLUMNS, rows: summaryRows(list.map(j => ({ ...j, driverName: driverOf(j) }))) })),
        summary: summaryTotals(rows),
      }
    case 'detail':
      return {
        grouped: true,
        tables: grouped(rows).flatMap(([, list]) => detailTables(list, { driverOf }).map(t => ({ ...t, columns: DETAIL_COLUMNS }))),
        summary: summaryTotals(rows),
      }
    case 'vehicle':
      return { tables: [{ key: 'v', columns: GROUP_COLUMNS('Vehicle'), rows: groupRows(rows, j => j.vehicleLabel) }], summary: summaryTotals(rows) }
    case 'driver':
      return { tables: [{ key: 'd', columns: GROUP_COLUMNS('Driver'), rows: groupRows(rows, driverOf) }], summary: summaryTotals(rows) }
    case 'customer':
      return { tables: [{ key: 'c', columns: GROUP_COLUMNS('Customer'), rows: groupRows(rows, j => j.customer || 'No customer') }], summary: summaryTotals(rows) }
    case 'analytics': {
      const a = analytics(rows)
      return {
        kpis: a.kpis,
        tables: [{ key: 'routes', heading: 'By route (latest delay first)', columns: ANALYTICS_COLUMNS, rows: a.routes }],
        summary: [
          { label: 'Arrived on time', value: a.kpis.onTimePct == null ? '—' : `${a.kpis.onTimePct}%` },
          { label: 'Average delay', value: a.kpis.avgDelayMin == null ? '—' : `${a.kpis.avgDelayMin} min` },
          { label: 'Route deviations', value: a.kpis.offRoute },
          { label: 'Planned / driven km', value: `${a.kpis.plannedKm} / ${a.kpis.drivenKm}` },
        ],
      }
    }
    default:
      return { tables: [], summary: [] }
  }
}

function Kpis({ k }) {
  const cards = [
    ['Journeys', k.journeys, `${k.completed} completed`],
    ['On time', k.onTimePct == null ? '—' : `${k.onTimePct}%`, 'of completed journeys'],
    ['Average delay', k.avgDelayMin == null ? '—' : `${k.avgDelayMin > 0 ? '+' : ''}${k.avgDelayMin} min`, 'at the destination'],
    ['Route deviations', k.offRoute, 'off-route episodes'],
    ['Distance', `${k.drivenKm} km`, `driven, of ${k.plannedKm} km planned (completed journeys)`],
  ]
  return (
    <div className="report-screen-only" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
      {cards.map(([l, v, sub]) => (
        <div key={l} style={{ ...CARD_SURFACE, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
          <div style={{ fontSize: 26, fontWeight: 300, color: 'var(--c-text1)', marginTop: 4 }}>{v}</div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text3)' }}>{sub}</div>
        </div>
      ))}
    </div>
  )
}
