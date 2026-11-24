import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, Search } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { LABEL, FIELD, ToolbarButton } from '../../components/reports/controls'
import { useDrivers, useCompanies, companyNameFor } from '../../data/settings'
import { formatPrintDate } from '../../utils/movementReport'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import {
  GATE_PASS_FILTERS, buildGatePassRows, groupGatePassRows, gatePassSummary, contractorOptions,
} from '../../utils/gatePass'

/**
 * Expiry Gate Pass (client, 2026-11-24): "as soon as we add a driver and they
 * have an access card (gate pass) that expires in 1-2 years, then they get a new
 * card. The report must automatically list whose card has expired (or is
 * expiring), taken from the driver list saved against each BG."
 *
 * Columns after the client's sample sheet (S. NO, DriverName, TagNumber,
 * TagExpiry, IdNumber, Contractor Name) plus Status and Days Left. Built from
 * the drivers (Settings > Driver > Additional Info > Gate pass), grouped per BG.
 */

const COLUMNS = [
  { key: 'sno',            label: 'S. NO',           width: '6%',  pdf: 5 },
  { key: 'driverName',     label: 'Driver Name',     width: '20%', pdf: 16 },
  { key: 'tagNumber',      label: 'Tag Number',      width: '20%', pdf: 18 },
  { key: 'tagExpiry',      label: 'Tag Expiry',      width: '11%', pdf: 9 },
  { key: 'idNumber',       label: 'ID Number',       width: '12%', pdf: 10 },
  { key: 'contractorName', label: 'Contractor Name', width: '17%', pdf: 15 },
  { key: 'status',         label: 'Status',          width: '8%',  pdf: 7 },
  { key: 'daysLeft',       label: 'Days Left',       width: '6%',  pdf: 6, align: 'right' },
]

const STATE_COLOR = { expired: '#dc2626', expiring: '#d97706', valid: '#16a34a', none: '#6b7280' }

export default function ExpiryGatePassReport(props) {
  const [hiddenCols, setHiddenCols] = useHiddenColumns('expiry-gate-pass')
  const shownCols = useVisibleColumns(COLUMNS, hiddenCols)
  const drivers = useDrivers()
  const companies = useCompanies()

  const [bg, setBg] = useState('')
  const [filter, setFilter] = useState('attention')
  const [contractor, setContractor] = useState('')
  const [driverStatus, setDriverStatus] = useState('Active')
  const [query, setQuery] = useState('')
  const [printDate] = useState(() => formatPrintDate())

  const contractors = useMemo(() => contractorOptions(drivers, bg), [drivers, bg])

  const rows = useMemo(
    () => buildGatePassRows(drivers, { filter, companyId: bg, contractor, driverStatus, query }),
    [drivers, filter, bg, contractor, driverStatus, query]
  )

  const groups = useMemo(() => groupGatePassRows(rows, companyNameFor).map(g => ({
    ...g,
    // Expired cards stand out: the status text in red, bold.
    rows: g.rows.map(r => ({ ...r, cellStyle: { status: { color: STATE_COLOR[r.state], fontWeight: 700 }, ...(r.state === 'expired' ? { tagExpiry: { color: STATE_COLOR.expired, fontWeight: 700 }, daysLeft: { color: STATE_COLOR.expired, fontWeight: 700 } } : {}) } })),
  })), [rows])

  const company = bg ? companyNameFor(bg) : companies.length === 1 ? companies[0].name : 'All Business Groups'
  const statusLabel = GATE_PASS_FILTERS.find(f => f.key === filter)?.label
  const filters = [
    ['Business Group', company],
    ['Status', statusLabel],
    ['Contractor', contractor || 'All'],
    ['Total Drivers', String(rows.length)],
  ]
  const summary = useMemo(() => gatePassSummary(rows), [rows])

  const exportOpts = () => ({
    title: 'Expiry Gate Pass Report',
    subtitle: company,
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate,
    systemName: 'FleetmaxX',
    reportSummary: summary,
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })),
      rows: g.rows,
    })),
  })

  const hasCards = drivers.some(d => d.gatePassTag || d.gatePassExpiry)

  return (
    <ReportFrame
      title="Expiry Gate Pass Report"
      desc="Drivers whose gate pass (site access card) has expired or is about to, from the drivers saved against each Business Group."
      {...props}
    >
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {companies.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              <span style={LABEL}>BUSINESS GROUP</span>
              <select value={bg} onChange={e => { setBg(e.target.value); setContractor('') }} style={FIELD}>
                <option value="">All Business Groups</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', minWidth: 230 }}>
            <span style={LABEL}>STATUS</span>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={FIELD}>
              {GATE_PASS_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', minWidth: 190 }}>
            <span style={LABEL}>CONTRACTOR</span>
            <select value={contractor} onChange={e => setContractor(e.target.value)} style={FIELD}>
              <option value="">All contractors</option>
              {contractors.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', minWidth: 150 }}>
            <span style={LABEL}>DRIVER</span>
            <select value={driverStatus} onChange={e => setDriverStatus(e.target.value)} style={FIELD}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Suspended">Suspended</option>
              <option value="all">All</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 220 }}>
            <span style={LABEL}>SEARCH</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, tag, ID number or contractor" style={{ ...FIELD, paddingLeft: 30 }} />
            </div>
          </label>
        </div>
      </div>

      <div className="report-screen-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>{rows.length} driver{rows.length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ColumnPicker columns={COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
          <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'Expiry_Gate_Pass_Report')} icon={FileDown} primary disabled={!rows.length}>Download PDF</ToolbarButton>
          <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'Expiry_Gate_Pass_Report')} icon={FileSpreadsheet} disabled={!rows.length}>Download Excel</ToolbarButton>
          <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!rows.length}>Print</ToolbarButton>
        </div>
      </div>

      <PaperTable
        title="Expiry Gate Pass Report"
        company={company}
        filters={filters}
        columns={shownCols}
        groups={groups}
        summary={summary}
        printDate={printDate}
        emptyText={hasCards
          ? 'No gate pass matches this selection.'
          : 'No gate passes yet. Add the tag number and expiry on a driver under Settings > Driver > Additional Info.'}
      />
    </ReportFrame>
  )
}
