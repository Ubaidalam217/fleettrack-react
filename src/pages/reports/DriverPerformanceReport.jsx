import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, AlertTriangle, Save } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { useHiddenColumns, columnChoices } from '../../utils/reportColumns'
import { LABEL, FIELD, Chip, ToolbarButton } from '../../components/reports/controls'
import { getDriverPerformance, getFatigueRule, setFatigueRule, driverCode } from '../../data/settings'
import { useSession } from '../../data/session'
import { IS_REAL } from '../../data/mode'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { hms, km } from '../../utils/usageReports'

/**
 * Driver Performance & Risk (Driver Management phases 3-4, client 2026-11-06).
 *
 * The numbers are computed on the server (lib/driverPerformance.js) from the
 * trips of every vehicle in the user's scope, each trip credited to the
 * driver whose iButton was read, else to the driver assigned on that date.
 * Three sheets: performance, safety score and risk, and the driving nobody
 * was identified for. The fatigue rule sits above them; administrators can
 * change it.
 */

const DAY_MS = 86_400_000
const PRESETS = [
  { key: 'd7',        label: 'Last 7 days',  days: 7 },
  { key: 'd14',       label: 'Last 14 days', days: 14 },
  { key: 'd30',       label: 'Last 30 days', days: 30 },
  { key: 'thisMonth', label: 'This month' },
  { key: 'custom',    label: 'Custom' },
]
const pad = n => String(n).padStart(2, '0')
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const RISK_STYLE = {
  Low:    { color: '#15803d', fontWeight: 700 },
  Medium: { color: '#b45309', fontWeight: 700 },
  High:   { color: '#b91c1c', fontWeight: 700 },
}
const RATING_STYLE = {
  Green:  { background: '#bbf7d0', color: '#14532d', fontWeight: 700 },
  Yellow: { background: '#fef08a', color: '#713f12', fontWeight: 700 },
  Red:    { background: '#fecaca', color: '#7f1d1d', fontWeight: 700 },
}
const TREND_TEXT = { Improving: '▲ Improving', Deteriorating: '▼ Deteriorating', Stable: '● Stable', New: '— New', 'No driving': '—' }
const TREND_STYLE = { Improving: { color: '#15803d', fontWeight: 700 }, Deteriorating: { color: '#b91c1c', fontWeight: 700 } }

const hours = sec => (sec ? (sec / 3600).toFixed(1) : '0.0')

const PERF_COLUMNS = [
  { key: 'code',     label: 'Driver No.',     width: '7%',  pdf: 6 },
  { key: 'name',     label: 'Driver',         width: '13%', pdf: 11 },
  { key: 'trips',    label: 'Trips',          width: '4.5%', pdf: 4, align: 'right' },
  { key: 'distance', label: 'Distance (km)',  width: '7%',  pdf: 6, align: 'right' },
  { key: 'drive',    label: 'Driving (h)',    width: '6%',  pdf: 5, align: 'right' },
  { key: 'avg',      label: 'Avg km/h',       width: '5%',  pdf: 4, align: 'right' },
  { key: 'max',      label: 'Max km/h',       width: '5%',  pdf: 4, align: 'right' },
  { key: 'os',       label: 'Over Speed',     width: '5%',  pdf: 4, align: 'right' },
  { key: 'hb',       label: 'Harsh Brake',    width: '5%',  pdf: 4, align: 'right' },
  { key: 'ha',       label: 'Harsh Accel.',   width: '5%',  pdf: 4, align: 'right' },
  { key: 'hc',       label: 'Harsh Corner',   width: '5%',  pdf: 4, align: 'right' },
  { key: 'xi',       label: 'Excess Idle',    width: '5%',  pdf: 4, align: 'right' },
  { key: 'night',    label: 'Night (h)',      width: '5%',  pdf: 4, align: 'right' },
  { key: 'incidents', label: 'Incidents',     width: '5%',  pdf: 4, align: 'right' },
  { key: 'vehicles', label: 'Vehicles',       width: '13.5%', pdf: 12 },
]

const RISK_COLUMNS = [
  { key: 'code',     label: 'Driver No.',       width: '7%',  pdf: 6 },
  { key: 'name',     label: 'Driver',           width: '13%', pdf: 11 },
  { key: 'score',    label: 'Safety Score',     width: '7%',  pdf: 6, align: 'right' },
  { key: 'rating',   label: 'Rating',           width: '6%',  pdf: 5 },
  { key: 'trend',    label: 'Trend',            width: '9%',  pdf: 8 },
  { key: 'accident', label: 'Accident Risk',    width: '7%',  pdf: 6 },
  { key: 'fatigueRisk', label: 'Fatigue Risk',  width: '7%',  pdf: 6 },
  { key: 'fatigue',  label: 'Fatigue Breaches', width: '7%',  pdf: 6, align: 'right' },
  { key: 'fuel',     label: 'Fuel-Wasting',     width: '7%',  pdf: 6 },
  { key: 'maint',    label: 'Maintenance Risk', width: '7%',  pdf: 6 },
  { key: 'expiry',   label: 'Next Expiry',      width: '13%', pdf: 12 },
  { key: 'notes',    label: 'Notes',            width: '10%', pdf: 10 },
]

const NOID_COLUMNS = [
  { key: 'vehicle',  label: 'Vehicle',         width: '18%', pdf: 16 },
  { key: 'trips',    label: 'Trips',           width: '8%',  pdf: 7, align: 'right' },
  { key: 'distance', label: 'Distance (km)',   width: '12%', pdf: 10, align: 'right' },
  { key: 'drive',    label: 'Driving',         width: '12%', pdf: 10 },
  { key: 'tags',     label: 'Unregistered Driver IDs read', width: '50%', pdf: 40 },
]

function expiryText(e) {
  if (!e) return '—'
  return e.daysLeft < 0 ? `${e.label} expired ${-e.daysLeft}d ago` : `${e.label} in ${e.daysLeft}d (${e.date})`
}

const ALL_COLUMNS = columnChoices(PERF_COLUMNS, RISK_COLUMNS, NOID_COLUMNS)

export default function DriverPerformanceReport(props) {
  const title = useReportTitle('Driver Performance & Risk')
  // One column choice across the three tables; a table with none left is not shown.
  const [hiddenCols, setHiddenCols] = useHiddenColumns('driver-performance')
  const shown = cols => cols.filter(c => !hiddenCols.has(c.key))
  const { user } = useSession()
  const canEditRule = ['SUPER_ADMIN', 'GGB_ADMIN'].includes(user?.role)
  const now = useMemo(() => new Date(), [])
  const [preset, setPreset] = useState('d7')
  const [fromDate, setFromDate] = useState(() => dateStr(new Date(now.getTime() - 6 * DAY_MS)))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [data, setData] = useState(null)
  const [applied, setApplied] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [rule, setRule] = useState(null)
  const [ruleMsg, setRuleMsg] = useState(null)

  useEffect(() => { if (IS_REAL) getFatigueRule().then(setRule).catch(() => {}) }, [])

  const applyPreset = p => {
    setPreset(p.key)
    if (p.days) {
      setFromDate(dateStr(new Date(now.getTime() - (p.days - 1) * DAY_MS)))
      setToDate(dateStr(now))
    } else if (p.key === 'thisMonth') {
      setFromDate(dateStr(new Date(now.getFullYear(), now.getMonth(), 1)))
      setToDate(dateStr(now))
    }
  }

  const fromTs = new Date(`${fromDate}T00:00:00`).getTime()
  const toTs = new Date(`${toDate}T23:59:59`).getTime()
  const rangeOk = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs && toTs - fromTs <= 31 * DAY_MS

  const generate = useCallback(async () => {
    if (!rangeOk) return
    setBusy(true)
    setError(null)
    try {
      const res = await getDriverPerformance(new Date(fromTs).toISOString(), new Date(toTs).toISOString())
      setData(res)
      setApplied({ fromTs: Math.floor(fromTs / 1000), toTs: Math.floor(toTs / 1000), printDate: formatPrintDate() })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [rangeOk, fromTs, toTs])

  const saveRule = async () => {
    setRuleMsg(null)
    try {
      setRule(await setFatigueRule(rule))
      setRuleMsg('Saved — applies to the next report.')
    } catch (err) {
      setRuleMsg(err.message || 'Could not save')
    }
  }

  const drivers = useMemo(() => (data?.drivers ?? []).slice().sort((a, b) => (b.distanceKm - a.distanceKm) || a.name.localeCompare(b.name)), [data])

  const perfGroups = useMemo(() => [{
    key: 'perf', label: `Drivers (${drivers.length})`,
    total: `Total   ·   Trips ${drivers.reduce((n, d) => n + d.trips, 0)}   ·   ${km(drivers.reduce((n, d) => n + d.distanceKm, 0))} km   ·   Driving ${hms(drivers.reduce((n, d) => n + d.driveSec, 0))}`,
    rows: drivers.map(d => ({
      // A removed driver is listed for the trips it drove (client, 2026-11-13).
      key: d.driverId, code: driverCode(d), name: d.removed ? `${d.name} (Removed)` : d.status === 'Suspended' ? `${d.name} (Suspended)` : d.name,
      trips: d.trips, distance: km(d.distanceKm), drive: hours(d.driveSec), avg: Math.round(d.avgSpeed), max: Math.round(d.maxSpeed),
      os: d.overSpeedCount, hb: d.hbCount, ha: d.haCount, hc: d.hcCount, xi: d.xiCount, night: hours(d.nightSec), incidents: d.incidents,
      vehicles: d.vehicles.join(', ') || '—',
    })),
  }], [drivers])

  const riskGroups = useMemo(() => {
    const scored = drivers.filter(d => d.safetyScore !== null)
    const avg = scored.length ? Math.round(scored.reduce((n, d) => n + d.safetyScore, 0) / scored.length) : '—'
    return [{
      key: 'risk', label: `Drivers (${drivers.length})`,
      total: `Average safety score ${avg}   ·   High accident risk ${drivers.filter(d => d.accidentRisk === 'High').length}   ·   High fatigue risk ${drivers.filter(d => d.fatigueRisk === 'High').length}`,
      rows: drivers.map(d => {
        const notes = []
        if (d.suspendedDriving) notes.push(`Drove while suspended (${d.suspendedDriving})`)
        if (d.trips && !d.identifiedBy.tag) notes.push('No Driver ID card used')
        return {
          key: d.driverId, code: driverCode(d), name: d.name,
          score: d.safetyScore ?? '—', rating: d.rating, trend: TREND_TEXT[d.trend] ?? d.trend,
          accident: d.accidentRisk, fatigueRisk: d.fatigueRisk, fatigue: d.fatigue.violations,
          fuel: d.fuelWaste, maint: d.maintenanceRisk, expiry: expiryText(d.nextExpiry), notes: notes.join('; ') || '—',
          cellStyle: {
            score: RATING_STYLE[d.rating], rating: RATING_STYLE[d.rating], trend: TREND_STYLE[d.trend],
            accident: RISK_STYLE[d.accidentRisk], fatigueRisk: RISK_STYLE[d.fatigueRisk], fuel: RISK_STYLE[d.fuelWaste],
            maint: RISK_STYLE[d.maintenanceRisk], expiry: d.nextExpiry && d.nextExpiry.daysLeft <= 30 ? { color: '#b91c1c', fontWeight: 700 } : undefined,
            notes: d.suspendedDriving ? { color: '#b91c1c', fontWeight: 700 } : undefined,
          },
        }
      }),
    }]
  }, [drivers])

  const noIdGroups = useMemo(() => [{
    key: 'noid', label: 'Driving without identification',
    total: `Vehicles ${data?.unidentified?.length ?? 0}   ·   Trips ${(data?.unidentified ?? []).reduce((n, u) => n + u.trips, 0)}`,
    rows: (data?.unidentified ?? []).map(u => ({
      key: u.vehicleId, vehicle: u.vehicle, trips: u.trips, distance: km(u.distanceKm), drive: hms(u.driveSec),
      tags: u.unknownTags.length ? `${u.unknownTags.join(', ')} — register under Settings › Driver` : '—',
    })),
  }], [data])

  const filters = applied ? [
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ['Trend', 'against the same number of days before'],
    ...(data?.fatigueRule ? [['Fatigue rule', `first ${data.fatigueRule.firstDriveMin} min · break ${data.fatigueRule.breakMin} min · then ${data.fatigueRule.driveMin} min · ${data.fatigueRule.dailyMaxMin} min/day`]] : []),
  ] : []

  const exportOpts = () => ({
    title: title === 'Driver Performance & Risk' ? 'Driver Performance & Risk Report' : title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    tables: [
      { heading: `Performance — ${perfGroups[0].total}`, columns: shown(PERF_COLUMNS).map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: perfGroups[0].rows },
      { heading: `Safety score & risk — ${riskGroups[0].total}`, columns: shown(RISK_COLUMNS).map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: riskGroups[0].rows },
      { heading: `Driving without identification — ${noIdGroups[0].total}`, columns: shown(NOID_COLUMNS).map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: noIdGroups[0].rows },
    ],
  })

  const num = (k, label) => (
    <div>
      <label style={LABEL}>{label}</label>
      <input type="number" min="1" style={FIELD} value={rule?.[k] ?? ''} disabled={!canEditRule}
        onChange={e => setRule(r => ({ ...r, [k]: e.target.value }))} />
    </div>
  )

  return (
    <ReportFrame
      title={title}
      desc="Per driver: distance, hours, harsh driving, fatigue and incidents, with a safety score, its trend and rule-based risk levels."
      {...props}
    >
      {!IS_REAL ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-text3)' }}>Driver performance is computed by the server, so this report is empty in demo mode.</div>
      ) : (
        <>
          <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
              {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p)}>{p.label}</Chip>)}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><label style={LABEL}>FROM DATE</label><input type="date" style={FIELD} value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset('custom') }} /></div>
              <div><label style={LABEL}>TO DATE</label><input type="date" style={FIELD} value={toDate} onChange={e => { setToDate(e.target.value); setPreset('custom') }} /></div>
              <div style={{ flex: 1 }} />
              {!rangeOk && <span style={{ fontSize: 11.5, color: '#ef4444' }}>Choose a range of 31 days or fewer.</span>}
              <button type="button" onClick={generate} disabled={busy || !rangeOk}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--ft-accent)', color: '#fff', fontSize: 13, fontWeight: 700, opacity: busy || !rangeOk ? 0.55 : 1, cursor: busy || !rangeOk ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Calculating…' : 'Generate Report'}
              </button>
            </div>
          </div>

          {rule && (
            <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-text1)', marginBottom: 4 }}>Fatigue rule</div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text3)', marginBottom: 12 }}>
                The first stint of the day may run the first limit; a stop of at least the break ends a stint; later stints run the second limit; no more than the daily maximum.
                {!canEditRule && ' Only an administrator can change it.'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, alignItems: 'end' }}>
                {num('firstDriveMin', 'FIRST STINT MAX (MIN)')}
                {num('breakMin', 'BREAK AT LEAST (MIN)')}
                {num('driveMin', 'LATER STINTS MAX (MIN)')}
                {num('dailyMaxMin', 'DAILY DRIVING MAX (MIN)')}
                {canEditRule && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ToolbarButton onClick={saveRule} icon={Save}>Save rule</ToolbarButton>
                    {ruleMsg && <span style={{ fontSize: 11, color: 'var(--c-text3)' }}>{ruleMsg}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="report-screen-only" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span>
            </div>
          )}

          {data && (
            <>
              <div className="report-screen-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                  <strong style={{ color: 'var(--c-text1)' }}>{drivers.length}</strong> drivers · scores are rules on the period&apos;s numbers, not a trained model
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ColumnPicker columns={ALL_COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
                  <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), title === 'Driver Performance & Risk' ? 'Driver_Performance_Report' : fileNameOf(title))} icon={FileDown} primary>Download PDF</ToolbarButton>
                  <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), title === 'Driver Performance & Risk' ? 'Driver_Performance_Report' : fileNameOf(title))} icon={FileSpreadsheet}>Download Excel</ToolbarButton>
                  <ToolbarButton onClick={() => window.print()} icon={Printer}>Print</ToolbarButton>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {shown(PERF_COLUMNS).length > 0 && (
                  <PaperTable title="Driver Performance" company="FleetmaxX" filters={filters} columns={shown(PERF_COLUMNS)} groups={perfGroups}
                    printDate={applied.printDate} emptyText="No drivers in your fleet yet — add them under Settings › Driver." />
                )}
                {shown(RISK_COLUMNS).length > 0 && (
                  <PaperTable title="Driver Safety Score & Risk" company="FleetmaxX" filters={filters} columns={shown(RISK_COLUMNS)} groups={riskGroups}
                    printDate={applied.printDate} emptyText="No drivers in your fleet yet." />
                )}
                {shown(NOID_COLUMNS).length > 0 && (
                  <PaperTable title="Driving Without Identification" company="FleetmaxX" filters={filters} columns={shown(NOID_COLUMNS)} groups={noIdGroups}
                    printDate={applied.printDate} emptyText="Every trip in the period was credited to a driver." />
                )}
              </div>
            </>
          )}
        </>
      )}
    </ReportFrame>
  )
}
