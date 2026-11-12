import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton } from '../../components/reports/controls'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import { CARD_SURFACE } from '../settings/formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { handleApiError } from '../settings/pageChrome'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useCompanies, useVehicles } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { EXPENSE_TYPES, listExpenses } from '../../data/expenses'
import { dateStr } from '../../utils/reportRange'
import { formatExpiryDate } from '../../utils/licenceExpiry'
import { formatPrintDate } from '../../utils/movementReport'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import {
  aed, byCategory, daysBetween, expenseRows, groupByVehicle, monthsBetween, num, usageInRange, vehicleCost,
} from '../../utils/expenseReport'
import { loadUsageMonths } from '../../utils/expenseUsage'
import { ReportSkeleton } from '../../components/Skeleton'

/**
 * Reports › Expense › Expense Report (client, 2026-11-12: "a report of all the
 * expenses of one vehicle or all ten, and what each vehicle costs"; modelled
 * on AI Revofleet's Expense, Vehicle Cost and Category Wise Expense reports).
 *
 * Three tables on the Movement Report's paper: every expense per vehicle,
 * the Vehicle Cost (per km, per day, per engine hour) and the totals per
 * Category and Type. The expenses come from the Expense module
 * (GET /api/expenses); the kilometres and engine hours from the Daywise
 * figures (utils/expenseUsage.js). Sums are in utils/expenseReport.js.
 */

const PRESETS = [
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'm3',        label: 'Last 3 Months' },
  { key: 'm6',        label: 'Last 6 Months' },
  { key: 'thisYear',  label: 'This Year' },
  { key: 'custom',    label: 'Custom' },
]

function presetDays(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth()
  const first = (yy, mm) => dateStr(new Date(yy, mm, 1))
  switch (key) {
    case 'thisMonth': return { from: first(y, m), to: dateStr(now) }
    case 'lastMonth': return { from: first(y, m - 1), to: dateStr(new Date(y, m, 0)) }
    case 'm3':        return { from: first(y, m - 2), to: dateStr(now) }
    case 'm6':        return { from: first(y, m - 5), to: dateStr(now) }
    case 'thisYear':  return { from: first(y, 0), to: dateStr(now) }
    default:          return null
  }
}

const digits = v => String(v ?? '').replace(/\D/g, '')
// The PDF's built-in font has no "·", "–" or "—": the export spells them plainly.
const plain = v => (typeof v === 'string' ? v.replace(/\s*·\s*/g, ' - ').replace(/[–—]/g, '-') : v)
const plainRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]))
const fmtDay = s => formatExpiryDate(String(s ?? '').slice(0, 10)) || '—'

const LIST_COLUMNS = [
  { key: 'date',     label: 'Date',                 width: '14%', pdf: 13 },
  { key: 'category', label: 'Category',             width: '8%',  pdf: 7 },
  { key: 'type',     label: 'Type',                 width: '11%', pdf: 10 },
  { key: 'details',  label: 'Vendor / Description', width: '30%', pdf: 30 },
  { key: 'odometer', label: 'Odometer (km)',        width: '9%',  pdf: 8, align: 'right' },
  { key: 'hours',    label: 'Work Hours',           width: '8%',  pdf: 7, align: 'right' },
  { key: 'amount',   label: 'Amount',               width: '20%', pdf: 17, align: 'right' },
]

const COST_COLUMNS = [
  { key: 'vehicle', label: 'Vehicle',         width: '15%', pdf: 14 },
  { key: 'branch',  label: 'Branch',          width: '13%', pdf: 12 },
  { key: 'total',   label: 'Expenses',        width: '13%', pdf: 12, align: 'right' },
  { key: 'km',      label: 'Distance (km)',   width: '10%', pdf: 9,  align: 'right' },
  { key: 'hours',   label: 'Engine Hours',    width: '9%',  pdf: 9,  align: 'right' },
  { key: 'days',    label: 'Days',            width: '6%',  pdf: 6,  align: 'right' },
  { key: 'perKm',   label: 'Cost per km',     width: '11%', pdf: 11, align: 'right' },
  { key: 'perDay',  label: 'Cost per Day',    width: '11%', pdf: 11, align: 'right' },
  { key: 'perHour', label: 'Cost per Engine Hour', width: '12%', pdf: 12, align: 'right' },
]

const CATEGORY_COLUMNS = [
  { key: 'category', label: 'Category',  width: '20%', pdf: 18 },
  { key: 'type',     label: 'Type',      width: '30%', pdf: 28 },
  { key: 'count',    label: 'Expenses',  width: '15%', pdf: 14, align: 'right' },
  { key: 'amount',   label: 'Amount',    width: '20%', pdf: 20, align: 'right' },
  { key: 'share',    label: 'Share',     width: '15%', pdf: 14, align: 'right' },
]

function listRow(r) {
  const parts = [r.vendor, r.subType, r.description].filter(Boolean)
  const spread = r.spread
    ? `${r.spread.days} of ${r.spread.of} days of ${aed(r.fullAmount)}`
    : r.category === 'Fix' ? `Whole period, ${aed(r.fullAmount)}` : ''
  return {
    key: r.id,
    date: r.toDate ? `${fmtDay(r.date)} – ${fmtDay(r.toDate)}` : fmtDay(r.date),
    category: r.category,
    type: r.type,
    details: [...parts, ...(r.referenceNo ? [`Ref ${r.referenceNo}`] : [])].join(' · ') || '—',
    odometer: r.odometer != null ? num(Number(r.odometer), 0) : '—',
    hours: r.workHours || '—',
    amount: spread ? `${aed(r.amount)}  (${spread})` : aed(r.amount),
  }
}

export default function ExpenseReport(props) {
  const title = useReportTitle('Expense Report')
  const { search } = useLocation()
  const { toasts, push, dismiss } = useToasts()
  const companies = useCompanies()
  const settingsVehicles = useVehicles()
  const { data } = useFlespiData()

  const now = useMemo(() => new Date(), [])
  const [preset, setPreset] = useState('thisMonth')
  const [from, setFrom] = useState(() => presetDays('thisMonth', now).from)
  const [to, setTo] = useState(() => presetDays('thisMonth', now).to)
  const [bgId, setBgId] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('')
  // null = all; a Vehicle Info "Full report" link preselects one (?vehicle=id).
  const [selectedIds, setSelectedIds] = useState(() => {
    const id = new URLSearchParams(search).get('vehicle')
    return id ? [id] : null
  })

  const vehicles = useMemo(() => (settingsVehicles ?? [])
    .filter(v => !bgId || String(v.companyId) === String(bgId))
    .map(v => ({ id: String(v.id), label: v.vehicleNumber || v.vehicleId || v.imei || String(v.id), company: companies.find(c => String(c.id) === String(v.companyId))?.name ?? '' }))
    .sort((a, b) => a.label.localeCompare(b.label)), [settingsVehicles, companies, bgId])
  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
        : `${effectiveIds.length} vehicles`
  const toggleVehicle = id => setSelectedIds(prev => {
    const base = prev ?? vehicles.map(v => v.id)
    return base.includes(id) ? base.filter(x => x !== id) : [...base, id]
  })

  const applyPreset = key => {
    setPreset(key)
    const r = presetDays(key)
    if (r) { setFrom(r.from); setTo(r.to) }
  }
  const rangeValid = !!from && !!to && from <= to

  // The expenses: one server read per change of range / category / type / BG.
  const [expenses, setExpenses] = useState(null)
  useEffect(() => {
    if (!IS_REAL || !rangeValid) return
    let live = true
    setExpenses(null)
    listExpenses(Object.fromEntries(Object.entries({ from, to, bgId, category, type }).filter(([, v]) => v)))
      .then(d => { if (live) setExpenses(d ?? []) })
      .catch(err => { if (live) { setExpenses([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, bgId, category, type, rangeValid])

  // Kilometres and engine hours for the same range, from the Daywise figures.
  const allIds = useMemo(() => (data?.vehicles ?? []).map(v => v.id), [data?.vehicles])
  const allKey = allIds.slice().sort((a, b) => a - b).join(',')
  const deviceByImei = useMemo(() => new Map((data?.vehicles ?? []).map(v => [digits(v.ident), v.id])), [data?.vehicles])
  const [usage, setUsage] = useState(null) // { byDevice, partial, missing }
  useEffect(() => {
    if (!rangeValid) return
    let live = true
    setUsage(null)
    loadUsageMonths(monthsBetween(from, to), allIds)
      .then(months => {
        if (!live) return
        setUsage({
          byDevice: usageInRange(months, from, to),
          partial: months.some(m => m.partial),
          missing: months.filter(m => !m.devices).length,
        })
      })
      .catch(() => { if (live) setUsage({ byDevice: new Map(), partial: false, missing: 1 }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, allKey, rangeValid])

  const idSet = useMemo(() => new Set(effectiveIds), [effectiveIds])
  const rows = useMemo(() => expenseRows(expenses ?? [], from, to).filter(r => idSet.has(String(r.vehicleId))), [expenses, from, to, idSet])
  const groups = useMemo(() => groupByVehicle(rows), [rows])
  const categories = useMemo(() => byCategory(rows), [rows])
  const today = dateStr(new Date())
  const days = daysBetween(from, to < today ? to : today)
  const cost = useMemo(() => {
    const byImei = new Map()
    for (const [imei, deviceId] of deviceByImei) {
      const u = usage?.byDevice?.get(deviceId)
      if (u) byImei.set(imei, u)
    }
    return vehicleCost(groups, byImei, days)
  }, [groups, usage, deviceByImei, days])
  const grand = rows.reduce((s, r) => s + r.amount, 0)

  const vehicleSummary = allSelected ? `All (${vehicles.length})` : selectionLabel
  const paperFilters = [
    ['Vehicles', vehicleSummary],
    ...(bgId ? [['Business Group', companies.find(c => String(c.id) === String(bgId))?.name ?? '']] : []),
    ['From', fmtDay(from)],
    ['To', fmtDay(to)],
    ['Category', category || 'All'],
    ['Type', type || 'All'],
  ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const printDate = useMemo(() => formatPrintDate(), [expenses])

  const listGroups = groups.map(g => ({
    key: g.vehicleId ?? g.plate,
    label: `${g.plate}${g.company ? `   ·   ${g.company}` : ''}${g.branch ? ` / ${g.branch}` : ''}`,
    rows: g.rows.map(listRow),
    total: `Total : ${aed(g.total)}   (${g.rows.length} expense${g.rows.length === 1 ? '' : 's'})`,
  }))
  const costRows = cost.map(c => ({
    key: c.vehicleId ?? c.plate,
    vehicle: c.plate,
    branch: c.branch || c.company || '—',
    total: aed(c.total),
    km: num(c.km, 1),
    hours: num(c.hours, 1),
    days: String(c.days),
    perKm: aed(c.perKm),
    perDay: aed(c.perDay),
    perHour: aed(c.perHour),
  }))
  const costTotalKm = cost.reduce((s, c) => s + (c.km ?? 0), 0)
  const costTotalH = cost.reduce((s, c) => s + (c.hours ?? 0), 0)
  if (costRows.length > 1) {
    costRows.push({
      key: 'total', strong: true, vehicle: 'Total', branch: '', total: aed(grand),
      km: num(costTotalKm, 1), hours: num(costTotalH, 1), days: String(days),
      perKm: aed(costTotalKm >= 1 ? grand / costTotalKm : null),
      perDay: aed(days > 0 ? grand / days : null),
      perHour: aed(costTotalH >= 0.1 ? grand / costTotalH : null),
    })
  }
  const categoryRows = categories.map(c => ({
    key: `${c.category}|${c.type}`,
    category: c.category, type: c.type, count: String(c.count), amount: aed(c.amount), share: `${num(c.share, 1)} %`,
  }))
  const usageNote = !usage ? 'Loading distance and engine hours…'
    : usage.missing ? 'Distance and engine hours are missing for part of the range, so some per-km and per-hour costs show "—".'
      : usage.partial ? 'Distance and engine hours are still being computed for some days of the range.'
        : null
  const summary = [
    { label: 'Total Expenses', value: String(rows.length) },
    { label: 'Total Amount', value: aed(grand) },
    { label: 'Vehicles', value: String(groups.length) },
    { label: 'Days', value: String(days) },
  ]

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filters: paperFilters.map(([k, v]) => [k, plain(v)]),
    printDate,
    systemName: 'FleetmaxX',
    reportSummary: summary,
    tables: [
      ...listGroups.map(g => ({
        heading: plain(g.label),
        columns: LIST_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
        rows: [...g.rows, { key: `${g.key}-total`, strong: true, date: g.total }].map(plainRow),
      })),
      { heading: 'Vehicle Cost', columns: COST_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: costRows.map(plainRow) },
      { heading: 'By Category', columns: CATEGORY_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: categoryRows.map(plainRow) },
    ],
  })
  const fail = err => push(err.message || String(err), { tone: 'error' })
  const file = fileNameOf(title)
  const types = category ? EXPENSE_TYPES[category] : [...EXPENSE_TYPES.Variable, ...EXPENSE_TYPES.Fix]

  return (
    <ReportFrame title={title} desc="Every expense of the chosen vehicles in a period, and what each vehicle cost per km, per day and per engine hour." {...props}>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Expenses are kept on the server, so this report needs the server and is not available in demo mode.</div>
      ) : (
        <>
          <div className="report-screen-only" style={{ ...CARD_SURFACE, padding: 16, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
              <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
                <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All vehicles</strong></CheckRow>
                <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                {vehicles.map(v => (
                  <CheckRow key={v.id} checked={effectiveIds.includes(v.id)} onChange={() => toggleVehicle(v.id)} note={v.company || null}>{v.label}</CheckRow>
                ))}
              </MultiSelect>
              {companies.length > 1 && (
                <div>
                  <label style={LABEL}>BUSINESS GROUP</label>
                  <select style={FIELD} value={bgId} onChange={e => { setBgId(e.target.value); setSelectedIds(null) }}>
                    <option value="">All</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={LABEL}>FROM DATE</label>
                <input type="date" style={FIELD} value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPreset('custom') }} />
              </div>
              <div>
                <label style={LABEL}>TO DATE</label>
                <input type="date" style={FIELD} value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPreset('custom') }} />
              </div>
              <div>
                <label style={LABEL}>CATEGORY</label>
                <select style={FIELD} value={category} onChange={e => { setCategory(e.target.value); setType('') }}>
                  <option value="">All</option>
                  <option value="Variable">Variable</option>
                  <option value="Fix">Fix</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>TYPE</label>
                <select style={FIELD} value={type} onChange={e => setType(e.target.value)}>
                  <option value="">All</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {!rangeValid && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#dc2626' }}>The From date must be on or before the To date.</p>}
          </div>

          <div className="report-screen-only" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              {expenses === null ? 'Loading expenses…' : `${rows.length} expense${rows.length === 1 ? '' : 's'} · ${groups.length} vehicle${groups.length === 1 ? '' : 's'} · ${aed(grand)}`}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), file).catch(fail)} icon={FileDown} primary disabled={!rows.length}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), file).catch(fail)} icon={FileSpreadsheet} disabled={!rows.length}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!rows.length}>Print</ToolbarButton>
            </div>
          </div>

          {expenses === null ? (
            <ReportSkeleton label="Loading…" />
          ) : (
            <>
              <PaperTable
                title={title}
                company="FleetmaxX"
                filters={paperFilters}
                columns={LIST_COLUMNS}
                groups={listGroups}
                printDate={printDate}
                summary={summary}
                emptyText="No expenses for these vehicles in this period. Add them under Settings › Master › Expense."
              />
              {rows.length > 0 && (
                <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
                  {usageNote && <p className="report-screen-only" style={{ margin: 0, fontSize: 12, color: 'var(--c-text3)' }}>{usageNote}</p>}
                  <PaperTable
                    title="Vehicle Cost"
                    company="FleetmaxX"
                    filters={paperFilters}
                    columns={COST_COLUMNS}
                    groups={[{ key: 'cost', label: `Vehicle Cost — ${fmtDay(from)} to ${fmtDay(to)}`, rows: costRows, total: false }]}
                    printDate={printDate}
                  />
                  <PaperTable
                    title="By Category"
                    company="FleetmaxX"
                    filters={paperFilters}
                    columns={CATEGORY_COLUMNS}
                    groups={[{ key: 'cat', label: 'Expenses by Category and Type', rows: categoryRows, total: `Total : ${aed(grand)}` }]}
                    printDate={printDate}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ReportFrame>
  )
}
