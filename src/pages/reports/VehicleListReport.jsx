import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, Search } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import PaperTable from '../../components/reports/PaperTable'
import LocationMapModal from '../../components/reports/LocationMapModal'
import { LABEL, FIELD, Chip, ToolbarButton } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import {
  useVehicles, useCompanies, useDrivers, companyNameFor, branchNameFor, imeiKey,
} from '../../data/settings'
import { STATUS, STATUS_KEYS } from '../../utils/vehicleStatus'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'
import { geocodeKey, reverseGeocodeMany } from '../../utils/geocode'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'

/**
 * List of Vehicles — the fleet register, after Ctrack's Fleet Status Report:
 * every vehicle with its registration details, driver, live status, last update
 * and last location, grouped per BG with a vehicle count.
 *
 * The register is Settings' vehicle list (scoped by the API); the live columns
 * join in from the Flespi snapshot by IMEI. A tracker with no Settings row is
 * still listed, under "Not registered", so the report never hides a device.
 */

const COLUMNS = [
  { key: 'vehicleId',  label: 'Vehicle ID',     width: '9%',  pdf: 7 },
  { key: 'plateNo',    label: 'Plate No',       width: '8%',  pdf: 6 },
  { key: 'branch',     label: 'Branch',         width: '8%',  pdf: 6 },
  { key: 'makeModel',  label: 'Make / Model',   width: '9%',  pdf: 7 },
  { key: 'type',       label: 'Type',           width: '6%',  pdf: 5 },
  { key: 'imei',       label: 'Device IMEI',    width: '10%', pdf: 8 },
  { key: 'sim',        label: 'SIM No',         width: '8%',  pdf: 6 },
  { key: 'driver',     label: 'Driver',         width: '9%',  pdf: 7 },
  { key: 'status',     label: 'Status',         width: '6%',  pdf: 5 },
  { key: 'lastUpdate', label: 'Last Update',    width: '9%',  pdf: 8 },
  { key: 'location',   label: 'Last Location',  width: '18%', pdf: 18, locate: true },
]

const NOT_REGISTERED = '__unregistered'

export default function VehicleListReport(props) {
  const { data } = useFlespiData()
  const registered = useVehicles()
  const companies = useCompanies()
  const drivers = useDrivers()

  const [bg, setBg] = useState('')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [addresses, setAddresses] = useState(() => new Map())
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const [printDate] = useState(() => formatPrintDate())

  // Every vehicle: Settings rows joined with the live snapshot, plus any live
  // tracker Settings does not know.
  const allRows = useMemo(() => {
    const live = new Map((data?.vehicles ?? []).map(v => [imeiKey(v.ident), v]))
    const used = new Set()
    const driverOf = new Map(drivers.map(d => [d.vehicleId, d]))

    const toRow = (reg, lv) => {
      const st = lv?.status ?? 'NoData'
      return {
        key: reg?.id ?? `live-${lv?.id}`,
        companyId: reg?.companyId || NOT_REGISTERED,
        vehicleId: reg?.vehicleId || lv?.name || '—',
        plateNo: reg?.vehicleNumber || '—',
        branch: reg ? branchNameFor(reg.branchId) : '—',
        makeModel: [reg?.make, reg?.model].filter(Boolean).join(' ') || '—',
        type: reg?.vehicleType || '—',
        imei: reg?.imei || lv?.ident || '—',
        sim: reg?.mobileNo || '—',
        driver: (reg && driverOf.get(reg.id)?.name) || '—',
        statusKey: st,
        status: STATUS[st]?.label ?? st,
        lastTs: lv?.lastTs ?? null,
        lastUpdate: lv?.lastTs ? formatDateTime(lv.lastTs) : 'Never',
        lat: lv?.lat ?? null,
        lng: lv?.lng ?? null,
        cellStyle: { status: { color: STATUS[st]?.color, fontWeight: 700 } },
      }
    }

    const rows = registered.map(reg => {
      const k = imeiKey(reg.imei)
      const lv = k ? live.get(k) : null
      if (lv) used.add(k)
      return toRow(reg, lv)
    })
    for (const [k, lv] of live) if (!used.has(k)) rows.push(toRow(null, lv))
    return rows.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId, undefined, { numeric: true }))
  }, [data, registered, drivers])

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => allRows.filter(r =>
    (!bg || r.companyId === bg) &&
    (status === 'all' || r.statusKey === status) &&
    (!q || [r.vehicleId, r.plateNo, r.imei, r.driver, r.makeModel, r.branch].some(v => String(v).toLowerCase().includes(q)))
  ), [allRows, bg, status, q])

  // Last positions to street addresses, a batch at a time as the list changes.
  useEffect(() => {
    const coords = rows.filter(r => r.lat != null && !addresses.has(geocodeKey(r.lat, r.lng))).slice(0, 200)
    if (!coords.length) return
    const ctrl = new AbortController()
    reverseGeocodeMany(coords.map(r => ({ lat: r.lat, lng: r.lng })), { signal: ctrl.signal, limit: 200 })
      .then(({ addresses: found }) => {
        if (!found.size) return
        setAddresses(prev => new Map([...prev, ...found]))
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [rows, addresses])

  const withLocation = useMemo(() => rows.map(r => {
    const coords = r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : '—'
    const location = r.lat != null ? (addresses.get(geocodeKey(r.lat, r.lng)) || coords) : '—'
    return {
      ...r,
      location,
      mapUrl: locationUrl({ lat: r.lat, lng: r.lng, vehicle: r.vehicleId, time: r.lastTs ? r.lastUpdate : null, address: location }),
    }
  }), [rows, addresses])

  const groups = useMemo(() => {
    const by = new Map()
    for (const r of withLocation) {
      if (!by.has(r.companyId)) by.set(r.companyId, [])
      by.get(r.companyId).push(r)
    }
    return [...by.entries()]
      .map(([id, list]) => ({
        key: id,
        label: id === NOT_REGISTERED ? 'Not registered in Settings' : companyNameFor(id),
        rows: list,
        total: `Total Vehicles : ${list.length}`,
      }))
      .sort((a, b) => (a.key === NOT_REGISTERED) - (b.key === NOT_REGISTERED) || a.label.localeCompare(b.label))
  }, [withLocation])

  const company = bg ? companyNameFor(bg) : companies.length === 1 ? companies[0].name : 'All BGs'
  const filters = [
    ['BG', company],
    ['Status', status === 'all' ? 'All' : STATUS[status]?.label],
    ['Search', query.trim() || '—'],
    ['Total Vehicles', String(withLocation.length)],
  ]

  const exportOpts = () => ({
    title: 'List of Vehicles',
    subtitle: company,
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate,
    systemName: 'FleetmaxX',
    tables: groups.map(g => ({
      heading: `${g.label} — ${g.total}`,
      columns: COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, hrefKey: c.locate ? 'mapUrl' : undefined })),
      rows: g.rows,
    })),
  })

  return (
    <ReportFrame
      title="List of Vehicles"
      desc="Every vehicle with its registration details, driver, live status, last update and last location."
      {...props}
    >
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {companies.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              <span style={LABEL}>BG</span>
              <select value={bg} onChange={e => setBg(e.target.value)} style={FIELD}>
                <option value="">All BGs</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 220 }}>
            <span style={LABEL}>SEARCH</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Vehicle, plate, IMEI or driver" style={{ ...FIELD, paddingLeft: 30, width: '100%', boxSizing: 'border-box' }} />
            </div>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 14 }}>
          <Chip active={status === 'all'} onClick={() => setStatus('all')}>All</Chip>
          {STATUS_KEYS.map(k => (
            <Chip key={k} active={status === k} onClick={() => setStatus(k)}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS[k].color, marginRight: 6 }} />
              {STATUS[k].label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="report-screen-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>{withLocation.length} vehicle{withLocation.length === 1 ? '' : 's'}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), 'List_of_Vehicles')} icon={FileDown} primary disabled={!withLocation.length}>Download PDF</ToolbarButton>
          <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), 'List_of_Vehicles')} icon={FileSpreadsheet} disabled={!withLocation.length}>Download Excel</ToolbarButton>
          <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!withLocation.length}>Print</ToolbarButton>
        </div>
      </div>

      <PaperTable
        title="List of Vehicles"
        company={company}
        filters={filters}
        columns={COLUMNS}
        groups={groups}
        printDate={printDate}
        onLocate={r => setLocated({ lat: r.lat, lng: r.lng, ts: r.lastTs, vehicleId: r.vehicleId, status: r.status, location: r.location })}
        emptyText={data ? 'No vehicle matches this selection.' : 'Loading vehicles…'}
      />

      <LocationMapModal point={located} onClose={closeLocated} />
    </ReportFrame>
  )
}
