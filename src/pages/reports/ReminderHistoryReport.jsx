import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, Search } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import { ToolbarButton } from '../../components/reports/controls'
import { CARD_SURFACE, inputStyle } from '../settings/formStyles'
import ToastStack from '../../components/tracking/Toasts'
import { useToasts } from '../../hooks/useToasts'
import { handleApiError } from '../settings/pageChrome'
import { useCompanies } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import { reminderHistory } from '../../data/reminders'
import { formatExpiryDate } from '../../utils/licenceExpiry'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { formatPrintDate } from '../../utils/movementReport'

// Reports › Reminder › Acknowledgement History (client, 2026-11-10): every
// reminder marked done — when, at what odometer, with what note, and by whom.
// The list is on the Movement Report's paper (client, 2026-11-11).

// Paper columns: width is the on-screen share, pdf the export weight.
const COLUMNS = [
  { key: 'doneOn',   label: 'Done on',  width: '9%',  pdf: 8 },
  { key: 'vehicle',  label: 'Vehicle',  width: '11%', pdf: 10 },
  { key: 'reminder', label: 'Reminder', width: '16%', pdf: 14 },
  { key: 'type',     label: 'Type',     width: '13%', pdf: 12 },
  { key: 'odometer', label: 'Odometer', width: '10%', pdf: 9, align: 'right' },
  { key: 'hours',    label: 'Engine h', width: '8%',  pdf: 7, align: 'right' },
  { key: 'note',     label: 'Note',     width: '21%', pdf: 22 },
  { key: 'by',       label: 'By',       width: '12%', pdf: 11 },
]

const paperRow = r => ({
  key: r.id,
  doneOn: formatExpiryDate(r.doneAt),
  vehicle: r.vehicleLabel,
  reminder: r.ruleName,
  type: r.type,
  odometer: r.odometer != null ? `${Math.round(r.odometer).toLocaleString('en-US')} km` : '—',
  hours: r.engineHours != null ? String(Math.round(r.engineHours * 10) / 10) : '—',
  note: r.note || '—',
  by: r.byName || '—',
})

const monthAgo = () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) }

export default function ReminderHistoryReport(props) {
  const companies = useCompanies()
  const { toasts, push, dismiss } = useToasts()
  const [filters, setFilters] = useState({ bgId: '', from: monthAgo(), to: '' })
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!IS_REAL) return
    let live = true
    setRows(null)
    reminderHistory(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))
      .then(d => { if (live) setRows(d ?? []) })
      .catch(err => { if (live) { setRows([]); handleApiError(err, { push }) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => !q || [r.vehicleLabel, r.ruleName, r.type, r.note, r.byName].some(s => String(s ?? '').toLowerCase().includes(q)))
  }, [rows, search])

  const bgName = companies.find(c => String(c.id) === String(filters.bgId))?.name
  const paperFilters = [
    ['Business Group', bgName || 'All'],
    ['From', filters.from ? formatExpiryDate(filters.from) : '—'],
    ['To', filters.to ? formatExpiryDate(filters.to) : 'Today'],
    ...(search.trim() ? [['Search', search.trim()]] : []),
  ]
  // Worked out "now", so the stamp moves with each reload of the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const printDate = useMemo(() => formatPrintDate(), [rows])
  const paperRows = useMemo(() => shown.map(paperRow), [shown])
  const exportOpts = () => ({
    title: 'Acknowledgement History',
    subtitle: 'FleetmaxX',
    filtersText: paperFilters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate,
    systemName: 'FleetmaxX',
    tables: [{
      heading: `Marked done — ${shown.length}`,
      columns: COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: paperRows,
    }],
  })
  const fail = err => push(err.message || String(err), { tone: 'error' })

  const box = { ...inputStyle(false), height: 38, width: 'auto' }
  return (
    <ReportFrame title="Acknowledgement History" desc="Every reminder marked done: when, at what odometer, and by whom." {...props}>
      {!IS_REAL ? (
        <div style={{ ...CARD_SURFACE, padding: 24, fontSize: 13, color: 'var(--c-text2)' }}>Reminders are kept on the server, so they are not available in demo mode.</div>
      ) : (
        <>
          <div className="report-screen-only" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
              <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }} />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle, reminder or note" aria-label="Search"
                style={{ ...inputStyle(false), height: 38, paddingLeft: 30 }} />
            </div>
            {companies.length > 1 && (
              <select value={filters.bgId} onChange={e => setFilters(f => ({ ...f, bgId: e.target.value }))} aria-label="Business Group" style={box}>
                <option value="">All Business Groups</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} aria-label="From" style={box} />
            <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>to</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} aria-label="To" style={box} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'Acknowledgement_History').catch(fail)} icon={FileDown} primary disabled={!shown.length}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'Acknowledgement_History').catch(fail)} icon={FileSpreadsheet} disabled={!shown.length}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!shown.length}>Print</ToolbarButton>
            </div>
          </div>
          {rows === null ? (
            <div style={{ ...CARD_SURFACE, padding: 36, textAlign: 'center', fontSize: 13, color: 'var(--c-text3)' }}>Loading…</div>
          ) : (
            <PaperTable
              title="Acknowledgement History"
              company="FleetmaxX"
              filters={paperFilters}
              columns={COLUMNS}
              groups={[{ key: 'all', label: `Marked done (${shown.length})`, rows: paperRows, total: `Total : ${shown.length}` }]}
              printDate={printDate}
              emptyText="Nothing marked done in this period."
            />
          )}
        </>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ReportFrame>
  )
}
