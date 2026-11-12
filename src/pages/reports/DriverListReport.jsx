import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, Search } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import { LABEL, FIELD, Chip, ToolbarButton } from '../../components/reports/controls'
import { useDrivers, useVehicles, useCompanies, companyNameFor, vehicleLabel } from '../../data/settings'
import { licenceExpiryState, formatExpiryDate } from '../../utils/licenceExpiry'
import { formatPrintDate } from '../../utils/movementReport'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'

/**
 * List of Drivers — the driver register, after Ctrack's Driver List Report:
 * contact, licence (with its expiry state), assigned vehicle and status,
 * grouped per BG with a driver count. Built from Settings > Drivers.
 */

const COLUMNS = [
  { key: 'name',          label: 'Driver Name',      width: '15%', pdf: 10 },
  { key: 'mobile',        label: 'Mobile',           width: '11%', pdf: 8 },
  { key: 'licenseNo',     label: 'Licence No',       width: '11%', pdf: 8 },
  { key: 'expiry',        label: 'Licence Expiry',   width: '10%', pdf: 7 },
  { key: 'licenceState',  label: 'Licence Status',   width: '11%', pdf: 8 },
  { key: 'vehicle',       label: 'Assigned Vehicle', width: '12%', pdf: 8 },
  { key: 'status',        label: 'Status',           width: '7%',  pdf: 5 },
  { key: 'notes',         label: 'Notes',            width: '23%', pdf: 14 },
]

const LICENCE_COLOR = { expired: '#dc2626', expiring: '#d97706', valid: '#16a34a' }

const LICENCE_FILTERS = [
  { key: 'all', label: 'All licences' },
  { key: 'expired', label: 'Expired' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'valid', label: 'Valid' },
]

export default function DriverListReport(props) {
  const [hiddenCols, setHiddenCols] = useHiddenColumns('driver-list')
  const shownCols = useVisibleColumns(COLUMNS, hiddenCols)
  const drivers = useDrivers()
  const vehicles = useVehicles()
  const companies = useCompanies()

  const [bg, setBg] = useState('')
  const [status, setStatus] = useState('all')
  const [licence, setLicence] = useState('all')
  const [query, setQuery] = useState('')
  const [printDate] = useState(() => formatPrintDate())

  const allRows = useMemo(() => {
    const vehicleById = new Map(vehicles.map(v => [v.id, v]))
    return drivers.map(d => {
      const lic = licenceExpiryState(d.licenseExpiry)
      return {
        key: d.id,
        companyId: d.companyId,
        name: d.name || '—',
        mobile: d.mobile || '—',
        licenseNo: d.licenseNo || '—',
        expiry: formatExpiryDate(d.licenseExpiry) || '—',
        licenceKey: lic.state,
        licenceState: lic.label,
        vehicle: d.vehicleId ? vehicleLabel(vehicleById.get(d.vehicleId)) : 'Not assigned',
        status: d.status || 'Active',
        notes: d.notes || '',
        cellStyle: { licenceState: { color: LICENCE_COLOR[lic.state], fontWeight: 700 } },
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [drivers, vehicles])

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => allRows.filter(r =>
    (!bg || r.companyId === bg) &&
    (status === 'all' || r.status === status) &&
    (licence === 'all' || r.licenceKey === licence) &&
    (!q || [r.name, r.mobile, r.licenseNo, r.vehicle].some(v => String(v).toLowerCase().includes(q)))
  ), [allRows, bg, status, licence, q])

  const groups = useMemo(() => {
    const by = new Map()
    for (const r of rows) {
      if (!by.has(r.companyId)) by.set(r.companyId, [])
      by.get(r.companyId).push(r)
    }
    return [...by.entries()]
      .map(([id, list]) => ({ key: id, label: companyNameFor(id), rows: list, total: `Total Drivers : ${list.length}` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const company = bg ? companyNameFor(bg) : companies.length === 1 ? companies[0].name : 'All Business Groups'
  const filters = [
    ['Business Group', company],
    ['Status', status === 'all' ? 'All' : status],
    ['Licence', LICENCE_FILTERS.find(f => f.key === licence)?.label],
    ['Total Drivers', String(rows.length)],
  ]

  const exportOpts = () => ({
    title: 'List of Drivers Report',
    subtitle: company,
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf })),
      rows: g.rows,
    })),
  })

  return (
    <ReportFrame
      title="List of Drivers Report"
      desc="Every driver with contact, licence details and expiry, assigned vehicle and status."
      {...props}
    >
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {companies.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              <span style={LABEL}>BUSINESS GROUP</span>
              <select value={bg} onChange={e => setBg(e.target.value)} style={FIELD}>
                <option value="">All Business Groups</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', minWidth: 160 }}>
            <span style={LABEL}>STATUS</span>
            <select value={status} onChange={e => setStatus(e.target.value)} style={FIELD}>
              <option value="all">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 220 }}>
            <span style={LABEL}>SEARCH</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, mobile, licence or vehicle" style={{ ...FIELD, paddingLeft: 30 }} />
            </div>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 14 }}>
          {LICENCE_FILTERS.map(f => (
            <Chip key={f.key} active={licence === f.key} onClick={() => setLicence(f.key)}>{f.label}</Chip>
          ))}
        </div>
      </div>

      <div className="report-screen-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>{rows.length} driver{rows.length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ColumnPicker columns={COLUMNS} hidden={hiddenCols} onChange={setHiddenCols} />
          <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'List_of_Drivers_Report')} icon={FileDown} primary disabled={!rows.length}>Download PDF</ToolbarButton>
          <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'List_of_Drivers_Report')} icon={FileSpreadsheet} disabled={!rows.length}>Download Excel</ToolbarButton>
          <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!rows.length}>Print</ToolbarButton>
        </div>
      </div>

      <PaperTable
        title="List of Drivers Report"
        company={company}
        filters={filters}
        columns={shownCols}
        groups={groups}
        printDate={printDate}
        emptyText={drivers.length ? 'No driver matches this selection.' : 'No drivers yet. Add them under Settings > Driver.'}
      />
    </ReportFrame>
  )
}
