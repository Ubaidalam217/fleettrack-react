import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle, MapPin } from 'lucide-react'
import Sidebar from '../../components/Sidebar'
import Header  from '../../components/Header'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton, HelpTip } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useGeofences } from '../../data/settings'
import { IS_REAL } from '../../data/mode'
import {
  fetchGeoZoneMessages, estimateRequestCount, rangeDays, isAbortError,
} from '../../utils/geoZoneFetch'
import {
  buildGeoZoneAnalysis, buildTripReport, buildVisitedSummary, buildAddressVisits,
  buildGeofenceHistory, buildG2GTripSummary,
  resolveGeoZoneLocations, countGeoZonePendingGeocodes,
} from '../../utils/geoZoneReports'
import {
  TRIP_COLUMNS, VISITED_OVERVIEW_COLUMNS, VISITED_DETAIL_COLUMNS, ADDRESS_VISITS_COLUMNS,
  HISTORY_SUMMARY_COLUMNS, HISTORY_DETAIL_COLUMNS, G2G_OVERVIEW_COLUMNS, G2G_DETAIL_COLUMNS,
  withLocationText,
  exportTripReportPdf, exportTripReportExcel,
  exportVisitedSummaryPdf, exportVisitedSummaryExcel,
  exportAddressVisitsPdf, exportAddressVisitsExcel,
  exportGeofenceHistoryPdf, exportGeofenceHistoryExcel,
  exportG2GTripSummaryPdf, exportG2GTripSummaryExcel,
  printGeoZoneReport,
} from '../../utils/geoZoneExport'
import { formatDateTime, formatPrintDate } from '../../utils/movementReport'

// Hard cap the user explicitly asked for: a long range across many vehicles
// can hammer Flespi (each day of range is one request per vehicle), so the
// Generate button is disabled outright past this, not just warned about —
// unlike Movement Report's WARN_REQUESTS, which only ever warns.
const MAX_RANGE_DAYS = 31
const WARN_REQUESTS = 20
// Real mode geocodes through the backend's self-hosted Photon; mock mode asks the
// public Nominatim at ~1/sec (see the same constant in pages/Reports.jsx).
const DEFAULT_GEOCODE_LIMIT = IS_REAL ? 20000 : 600

const SUB_REPORTS = [
  { key: 'trip',     label: 'Trip Report' },
  { key: 'visited',  label: 'Visited Summary' },
  { key: 'address',  label: 'Address Visits' },
  { key: 'history',  label: 'History' },
  { key: 'g2g',      label: 'Geofence-to-Geofence' },
]

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'lastWeek',  label: 'Last Week' },
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'd30',       label: 'Last 30 days' },
  { key: 'custom',    label: 'Custom' },
]

const DAY_MS = 86_400_000
const pad = n => String(n).padStart(2, '0')
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())

function startOfWeek(d) {
  const s = startOfDay(d)
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

function presetRange(key, now = new Date()) {
  const today = startOfDay(now)
  switch (key) {
    case 'today':     return { from: today, to: now, toEndOfDay: false }
    case 'yesterday': { const y = new Date(today.getTime() - DAY_MS); return { from: y, to: y, toEndOfDay: true } }
    case 'thisWeek':  return { from: startOfWeek(now), to: now, toEndOfDay: false }
    case 'lastWeek':  {
      const thisMon = startOfWeek(now)
      const lastMon = new Date(thisMon.getTime() - 7 * DAY_MS)
      return { from: lastMon, to: new Date(thisMon.getTime() - DAY_MS), toEndOfDay: true }
    }
    case 'd7':  return { from: new Date(today.getTime() - 6 * DAY_MS),  to: now, toEndOfDay: false }
    case 'd30': return { from: new Date(today.getTime() - 29 * DAY_MS), to: now, toEndOfDay: false }
    default:    return null
  }
}

// ── on-screen table ──────────────────────────────────────────────────────────

function GeoZoneTable({ columns, rows, emptyText }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--c-text3)' }}>
        {emptyText || 'No rows for this selection.'}
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--c-border)', borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5, whiteSpace: 'nowrap' }}>
        <thead>
          <tr style={{ background: 'var(--c-card2, var(--c-card))' }}>
            {columns.map(c => (
              <th key={c.key} style={{
                position: 'sticky', top: 0, background: 'var(--c-card2, var(--c-card))',
                textAlign: c.align === 'right' ? 'right' : 'left', padding: '8px 10px',
                borderBottom: '1px solid var(--c-border)', color: 'var(--c-text2)', fontWeight: 700,
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? 'var(--c-hover)' : 'transparent' }}>
              {columns.map(c => (
                <td key={c.key} style={{
                  padding: '7px 10px', textAlign: c.align === 'right' ? 'right' : 'left',
                  color: 'var(--c-text1)', borderBottom: '1px solid var(--c-border)',
                }}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function GeoZoneReport({ isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  const { data } = useFlespiData()
  const vehicles = useMemo(
    () => (data?.vehicles ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  )
  const allZones = useGeofences()
  const geofenceZones = useMemo(() => allZones.filter(z => z.kind === 'GEOFENCE'), [allZones])
  const addressZones  = useMemo(() => allZones.filter(z => z.kind === 'ADDRESS'),  [allZones])

  // ── filter form state ──
  const now = useRef(new Date()).current
  const [activeTab,        setActiveTab]        = useState('trip')
  // null = all. Starts empty on every report: the client wants the vehicles
  // picked on purpose, not the whole fleet selected by default.
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([])
  const [selectedGeoIds,   setSelectedGeoIds]   = useState(null) // null = all (Set<string> to narrow)
  const [selectedAddrIds,  setSelectedAddrIds]  = useState(null)
  const [preset,           setPreset]           = useState('today')
  const [fromDate,         setFromDate]         = useState(() => dateStr(startOfDay(now)))
  const [toDate,           setToDate]           = useState(() => dateStr(now))
  const [fromTime,         setFromTime]         = useState('00:00')
  const [toTime,           setToTime]           = useState(() => timeStr(now))
  const [dwellSec,          setDwellSec]        = useState(60)
  const [mergeGapSec,       setMergeGapSec]     = useState(120)

  // ── report state ──
  const [byDeviceMessages, setByDeviceMessages] = useState(null)
  const [applied,   setApplied]   = useState(null)
  const [progress,  setProgress]  = useState(null)
  const [error,     setError]     = useState(null)
  const [resolving, setResolving] = useState(false)
  const [geoTick,   setGeoTick]   = useState(0)
  const abortRef = useRef(null)

  const busy = progress !== null

  const effectiveVehicleIds = selectedVehicleIds ?? vehicles.map(v => v.id)
  const allVehiclesSelected = selectedVehicleIds === null || (vehicles.length > 0 && selectedVehicleIds.length === vehicles.length)

  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs   = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000),   [toDate, toTime])
  const rangeValid   = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const days         = rangeValid ? rangeDays(fromTs, toTs) : 0
  const rangeTooLong = rangeValid && days > MAX_RANGE_DAYS
  const requestCount = rangeValid ? estimateRequestCount(effectiveVehicleIds.length, fromTs, toTs) : 0

  const vehicleSelectionLabel = allVehiclesSelected
    ? `All (${vehicles.length})`
    : effectiveVehicleIds.length === 0
      ? 'Select vehicles'
      : effectiveVehicleIds.length === 1
      ? (vehicles.find(v => v.id === effectiveVehicleIds[0])?.master?.plateNo || vehicles.find(v => v.id === effectiveVehicleIds[0])?.name || '1 vehicle')
      : `${effectiveVehicleIds.length} vehicles`

  const geoSelectionLabel = selectedGeoIds === null ? `All (${geofenceZones.length})` : `${selectedGeoIds.size} selected`
  const addrSelectionLabel = selectedAddrIds === null ? `All (${addressZones.length})` : `${selectedAddrIds.size} selected`

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
    const current = selectedVehicleIds ?? vehicles.map(v => v.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedVehicleIds(next.length === vehicles.length ? null : next)
  }

  const toggleZone = (id, which) => {
    const [selected, setSelected, all] = which === 'geo'
      ? [selectedGeoIds, setSelectedGeoIds, geofenceZones]
      : [selectedAddrIds, setSelectedAddrIds, addressZones]
    const current = selected ?? new Set(all.map(z => String(z.id)))
    const next = new Set(current)
    const key = String(id)
    if (next.has(key)) next.delete(key); else next.add(key)
    setSelected(next.size === all.length ? null : next)
  }

  // ── generate ──
  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveVehicleIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setByDeviceMessages(null)
    setProgress({ done: 0, total: effectiveVehicleIds.length, text: 'Starting...' })

    const snapshot = { fromTs, toTs, vehicleSelectionLabel, printDate: formatPrintDate() }

    try {
      const messages = await fetchGeoZoneMessages(effectiveVehicleIds, fromTs, toTs, {
        onProgress: setProgress,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setByDeviceMessages(messages)
      setApplied(snapshot)
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveVehicleIds, fromTs, toTs, vehicleSelectionLabel])

  const cancel = () => abortRef.current?.abort()

  // ── derive the engine + all 5 sub-reports from the one fetch, in memory ──
  // No network below this point — dwell/merge/zone-selection changes just
  // re-run these pure functions over the messages already fetched.
  const fetchedVehicles = useMemo(
    () => (byDeviceMessages ? vehicles.filter(v => byDeviceMessages.has(v.id)) : []),
    [byDeviceMessages, vehicles]
  )

  const analysis = useMemo(() => {
    if (!byDeviceMessages) return null
    return buildGeoZoneAnalysis(byDeviceMessages, fetchedVehicles, geofenceZones, addressZones, {
      dwellSec, mergeGapSec, isMockMode: !IS_REAL,
      selectedGeofenceIds: selectedGeoIds, selectedAddressIds: selectedAddrIds,
    })
  }, [byDeviceMessages, fetchedVehicles, geofenceZones, addressZones, dwellSec, mergeGapSec, selectedGeoIds, selectedAddrIds])

  const tripReport    = useMemo(() => (analysis ? buildTripReport(analysis)      : null), [analysis])
  const visitedReport = useMemo(() => (analysis ? buildVisitedSummary(analysis)  : null), [analysis])
  const addressReport = useMemo(() => (analysis ? buildAddressVisits(analysis)   : null), [analysis])
  const historyReport = useMemo(() => (analysis ? buildGeofenceHistory(analysis) : null), [analysis])
  const g2gReport      = useMemo(() => (analysis ? buildG2GTripSummary(analysis)  : null), [analysis])

  const locationRefsForTab = {
    trip: tripReport?.locationRefs, visited: visitedReport?.locationRefs,
    history: historyReport?.locationRefs, address: null, g2g: null,
  }[activeTab]

  // Auto-resolve whichever sub-report's locations the user is looking at.
  // Idempotent against the shared geocode cache, so switching tabs back and
  // forth never re-spends the network budget on the same coordinates.
  useEffect(() => {
    if (!analysis || !locationRefsForTab || locationRefsForTab.length === 0) return
    if (countGeoZonePendingGeocodes(locationRefsForTab) === 0) return
    let cancelled = false
    setResolving(true)
    resolveGeoZoneLocations(locationRefsForTab, {
      limit: DEFAULT_GEOCODE_LIMIT,
      onProgress: (done, total) => { if (!cancelled && (done % 10 === 0 || done === total)) setGeoTick(t => t + 1) },
    }).finally(() => { if (!cancelled) { setResolving(false); setGeoTick(t => t + 1) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, activeTab])

  const pendingGeocodes = locationRefsForTab ? countGeoZonePendingGeocodes(locationRefsForTab) : 0

  // ── export plumbing ──
  const exportMeta = useMemo(() => ({
    subtitle: 'FleetmaX', systemName: 'FleetmaX',
    printDate: applied?.printDate ?? formatPrintDate(),
  }), [applied])

  const exportFilters = useMemo(() => ({
    rangeLabel: applied
      ? `${formatDateTime(applied.fromTs)} – ${formatDateTime(applied.toTs)} · ${applied.vehicleSelectionLabel} · dwell ${dwellSec}s / merge ${mergeGapSec}s`
      : '',
  }), [applied, dwellSec, mergeGapSec])

  const EXPORTERS = {
    trip:    { pdf: exportTripReportPdf,         excel: exportTripReportExcel,         report: tripReport,    filename: 'Geofence Trip Report' },
    visited: { pdf: exportVisitedSummaryPdf,      excel: exportVisitedSummaryExcel,      report: visitedReport, filename: 'Geofence Visited Summary' },
    address: { pdf: exportAddressVisitsPdf,       excel: exportAddressVisitsExcel,       report: addressReport, filename: 'Address Visits' },
    history: { pdf: exportGeofenceHistoryPdf,     excel: exportGeofenceHistoryExcel,     report: historyReport, filename: 'Geofence History' },
    g2g:     { pdf: exportG2GTripSummaryPdf,      excel: exportG2GTripSummaryExcel,      report: g2gReport,     filename: 'Geofence to Geofence Trip Summary' },
  }

  const handlePdf = async () => {
    const x = EXPORTERS[activeTab]
    if (!x.report) return
    try { await x.pdf(x.report, exportFilters, exportMeta) }
    catch (err) { setError(`PDF export failed: ${err.message || err}`) }
  }
  const handleExcel = async () => {
    const x = EXPORTERS[activeTab]
    if (!x.report) return
    try { await x.excel(x.report, exportFilters, exportMeta) }
    catch (err) { setError(`Excel export failed: ${err.message || err}`) }
  }
  const handlePrint = () => { requestAnimationFrame(() => setTimeout(printGeoZoneReport, 0)) }

  const resolveMore = async () => {
    if (!locationRefsForTab) return
    const controller = new AbortController()
    abortRef.current = controller
    setResolving(true)
    try {
      await resolveGeoZoneLocations(locationRefsForTab, {
        limit: DEFAULT_GEOCODE_LIMIT, signal: controller.signal,
        onProgress: () => setGeoTick(t => t + 1),
      })
      setGeoTick(t => t + 1)
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setResolving(false)
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null

  // ── on-screen rows per tab — fold in resolved address text, recomputed on
  //    every geoTick so the table fills in as lookups land. ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tripRows    = useMemo(() => tripReport ? tripReport.perVehiclePages.flatMap(p => withLocationText(p.rows, [['startLocation', 'startLat', 'startLng'], ['endLocation', 'endLat', 'endLng']])) : [], [tripReport, geoTick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visitedDetailRows = useMemo(() => visitedReport ? visitedReport.perVehiclePages.flatMap(p => withLocationText(p.rows, [['reachLocation', 'reachLat', 'reachLng'], ['departLocation', 'departLat', 'departLng']]).map(r => ({ ...r, vehicle: p.meta.vehicleId }))) : [], [visitedReport, geoTick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historyDetailRows = useMemo(() => historyReport ? historyReport.groups.flatMap(g => withLocationText(g.detailRows, [['entryPosition', 'entryLat', 'entryLng'], ['exitPosition', 'exitLat', 'exitLng']])) : [], [historyReport, geoTick])

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSidebarOpen(false)} />
        )}

        <Header
          isDark={isDark} toggleTheme={toggleTheme}
          themeMode={themeMode} setTheme={setTheme}
          onMenuClick={() => setSidebarOpen(s => !s)}
        />

        <main className="flex-1 overflow-y-auto no-scrollbar" id="geozone-report-main">
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 16px 48px' }}>

            <div className="report-screen-only" style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>Geo Zone Visit Report</h1>
              <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '4px 0 0' }}>
                Trips, visits and dwell time at your geofences and addresses, derived from one Flespi fetch per run.
              </p>
            </div>

            {/* ── Sub-report tabs ── */}
            <div className="report-screen-only" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
              {SUB_REPORTS.map(r => (
                <Chip key={r.key} active={activeTab === r.key} onClick={() => setActiveTab(r.key)}>{r.label}</Chip>
              ))}
            </div>

            {/* ── Filter form ── */}
            <div className="report-screen-only" style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 12, padding: 16, marginBottom: 18,
            }}>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                {PRESETS.map(p => (
                  <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
                <MultiSelect label="VEHICLES" summary={vehicleSelectionLabel} disabled={vehicles.length === 0}>
                  <CheckRow checked={allVehiclesSelected} onChange={() => setSelectedVehicleIds(allVehiclesSelected ? [] : null)}>
                    <strong>All vehicles</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {vehicles.map(v => (
                    <CheckRow key={v.id} checked={effectiveVehicleIds.includes(v.id)} onChange={() => toggleVehicle(v.id)}
                      note={v.master?.plateNo && v.master.plateNo !== v.name ? v.name : null}>
                      {v.master?.plateNo || v.name}
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

                <MultiSelect label="GEOFENCES" summary={geoSelectionLabel} disabled={geofenceZones.length === 0}>
                  <CheckRow checked={selectedGeoIds === null} onChange={() => setSelectedGeoIds(selectedGeoIds === null ? new Set() : null)}>
                    <strong>All geofences</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {geofenceZones.map(z => (
                    <CheckRow key={z.id} checked={selectedGeoIds === null || selectedGeoIds.has(String(z.id))} onChange={() => toggleZone(z.id, 'geo')}>
                      {z.name}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <MultiSelect label="ADDRESSES" summary={addrSelectionLabel} disabled={addressZones.length === 0}>
                  <CheckRow checked={selectedAddrIds === null} onChange={() => setSelectedAddrIds(selectedAddrIds === null ? new Set() : null)}>
                    <strong>All addresses</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {addressZones.map(z => (
                    <CheckRow key={z.id} checked={selectedAddrIds === null || selectedAddrIds.has(String(z.id))} onChange={() => toggleZone(z.id, 'addr')}>
                      {z.name}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <div>
                  <label style={LABEL}>DWELL TIME (S)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min={0} step={5} style={FIELD} value={dwellSec}
                      onChange={e => setDwellSec(Math.max(0, Number(e.target.value) || 0))} />
                    <HelpTip title="Dwell time">
                      A containment run shorter than this is GPS jitter at a boundary, not a real visit, and is dropped. Default 60s.
                    </HelpTip>
                  </div>
                </div>

                <div>
                  <label style={LABEL}>MERGE GAP (S)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min={0} step={5} style={FIELD} value={mergeGapSec}
                      onChange={e => setMergeGapSec(Math.max(0, Number(e.target.value) || 0))} />
                    <HelpTip title="Short-exit merge">
                      If the vehicle leaves a fence and re-enters the SAME fence within this many seconds, the two are merged into one visit instead of counted as two. Default 120s.
                    </HelpTip>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--c-text3)', display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
                  {!rangeValid && (<><AlertTriangle size={13} color="#f97316" /> From must be earlier than To.</>)}
                  {rangeValid && rangeTooLong && (
                    <><AlertTriangle size={13} color="#ef4444" /> Date range cannot exceed {MAX_RANGE_DAYS} days (currently {days}).</>
                  )}
                  {rangeValid && !rangeTooLong && requestCount > WARN_REQUESTS && (
                    <><AlertTriangle size={13} color="#f97316" /> Long date range — this report may take a few minutes.</>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {busy && <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>}
                  <button
                    type="button" onClick={generate}
                    disabled={busy || !rangeValid || rangeTooLong || effectiveVehicleIds.length === 0}
                    style={{
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: (busy || !rangeValid || rangeTooLong) ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                      cursor: (busy || !rangeValid || rangeTooLong) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busy ? 'Generating...' : 'Generate Report'}
                  </button>
                </div>
              </div>

              {progress && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c-text2)', marginBottom: 5 }}>
                    <span>{progress.text}</span>
                    {pct != null && <span style={{ fontWeight: 700 }}>{pct}%</span>}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: 'var(--ft-accent)', width: `${pct ?? 0}%`, transition: 'width 0.25s ease' }} />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="report-screen-only" style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16,
                fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            {/* ── Results ── */}
            {analysis && (
              <>
                <div className="report-screen-only" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                    {SUB_REPORTS.find(r => r.key === activeTab)?.label}
                    {resolving && <span style={{ color: 'var(--c-text3)' }}> · resolving addresses...</span>}
                    {!resolving && pendingGeocodes > 0 && (
                      <span style={{ color: 'var(--c-text3)' }}> · {pendingGeocodes.toLocaleString()} location{pendingGeocodes === 1 ? '' : 's'} unresolved</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {pendingGeocodes > 0 && (
                      <ToolbarButton onClick={resolveMore} icon={MapPin} disabled={resolving}>Resolve addresses</ToolbarButton>
                    )}
                    <ToolbarButton onClick={handlePdf} icon={FileDown} primary>Download PDF</ToolbarButton>
                    <ToolbarButton onClick={handleExcel} icon={FileSpreadsheet}>Download Excel</ToolbarButton>
                    <ToolbarButton onClick={handlePrint} icon={Printer}>Print</ToolbarButton>
                  </div>
                </div>

                <div id="geozone-report-paper" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {activeTab === 'trip' && (
                    <>
                      <SummaryCards cards={[
                        ['Distance (km)', tripReport.summary.distanceKm], ['Running', tripReport.summary.runningSec],
                        ['Idle', tripReport.summary.idleSec], ['Stop', tripReport.summary.stopSec],
                        ['Inactive', tripReport.summary.inactiveSec], ['Fuel Consumed', tripReport.summary.fuelConsumed],
                      ]} />
                      <GeoZoneTable columns={TRIP_COLUMNS} rows={tripRows} />
                    </>
                  )}
                  {activeTab === 'visited' && (
                    <>
                      <SummaryCards cards={[
                        ['No of Visits', visitedReport.summary.noOfVisits],
                        ['Geofence Duration', visitedReport.summary.geofenceDuration],
                        ['Geofence Outside Duration', visitedReport.summary.geofenceOutsideDuration],
                      ]} />
                      <GeoZoneTable columns={VISITED_OVERVIEW_COLUMNS} rows={visitedReport.vehicleRows} emptyText="No visited geofences for this selection." />
                      <GeoZoneTable columns={[{ key: 'vehicle', label: 'Vehicle', width: 1 }, ...VISITED_DETAIL_COLUMNS]} rows={visitedDetailRows} />
                    </>
                  )}
                  {activeTab === 'address' && (
                    <>
                      <SummaryCards cards={[['Total Visits', addressReport.rows.length]]} />
                      <GeoZoneTable columns={ADDRESS_VISITS_COLUMNS} rows={addressReport.rows} emptyText="No address visits for this selection." />
                    </>
                  )}
                  {activeTab === 'history' && (
                    <>
                      <SummaryCards cards={[['Geofence×Vehicle Pairs', historyReport.groups.length]]} />
                      <GeoZoneTable columns={HISTORY_SUMMARY_COLUMNS} rows={historyReport.groups} emptyText="No geofence history for this selection." />
                      <GeoZoneTable columns={HISTORY_DETAIL_COLUMNS} rows={historyDetailRows} />
                    </>
                  )}
                  {activeTab === 'g2g' && (
                    <>
                      <SummaryCards cards={[
                        ['No of Trips', g2gReport.summary.noOfTrips], ['Distance (km)', g2gReport.summary.distanceKm],
                        ['Running', g2gReport.summary.running], ['Stop', g2gReport.summary.stop], ['Inactive', g2gReport.summary.inactive],
                      ]} />
                      <GeoZoneTable columns={G2G_OVERVIEW_COLUMNS} rows={g2gReport.vehicleRows} emptyText="No geofence-to-geofence trips for this selection." />
                      <GeoZoneTable columns={G2G_DETAIL_COLUMNS} rows={g2gReport.perVehiclePages.flatMap(p => p.rows)} />
                    </>
                  )}
                </div>
              </>
            )}

            {!analysis && !busy && !error && (
              <div className="report-screen-only" style={{
                background: 'var(--c-card)', border: '1px dashed var(--c-border2)',
                borderRadius: 12, padding: '48px 24px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text1)' }}>
                  Choose a range and press Generate Report.
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text3)', marginTop: 6 }}>
                  One fetch builds all five sub-reports — switch tabs above without re-fetching.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          #geozone-report-paper, #geozone-report-paper * { visibility: visible !important; }
          #geozone-report-paper { position: absolute !important; left: 0; top: 0; width: 100%; }
          #geozone-report-main { overflow: visible !important; }
          .report-screen-only { display: none !important; }
          aside, header { display: none !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

function SummaryCards({ cards }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {cards.map(([label, value]) => (
        <div key={label} style={{
          background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 10,
          padding: '10px 14px', minWidth: 120,
        }}>
          <div style={{ fontSize: 10.5, color: 'var(--c-text3)', fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 15, color: 'var(--c-text1)', fontWeight: 700, marginTop: 3 }}>{value}</div>
        </div>
      ))}
    </div>
  )
}
