import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle, Search } from 'lucide-react'
import Sidebar from '../../components/Sidebar'
import Header from '../../components/Header'
import DaywiseTable from '../../components/reports/DaywiseTable'
import {
  LABEL, FIELD, MultiSelect, CheckRow, ToolbarButton, HelpTip,
} from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import {
  settingsProfileForImei, driverNameForDevice, useVehicles, useCompanies, useDrivers,
} from '../../data/settings'
import {
  loadDaywiseMonth, warmDaywiseMonth, rowsFromDerived,
  currentUaeMonth, daysInMonth, lastElapsedDay, monthLabel,
  formatHoursMinutes, formatKm, isAbortError,
} from '../../utils/daywise'
import { exportDaywiseExcel, exportDaywisePdf, printDaywiseReport } from '../../utils/daywiseExport'

/**
 * Daywise Work Hour and Daywise Distance.
 *
 * One page, two variants. The reports differ in three places — their identity
 * columns, how a cell is formatted, and which derived array it reads — and are
 * otherwise the same screen: same month picker, same vehicle/BG filter, same
 * fetch with progress and cancel, same exports. VARIANTS below is that
 * difference, written once.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Vehicles come from useFlespiData(), which is the live snapshot already
 * filtered to the signed-in account by useScopedSnapshot (data/fleetScope.js,
 * fed by GET /api/me/vehicles). The report therefore cannot see a device the
 * account cannot, and the Flespi token it fetches with is the per-user ACL token
 * in real mode. In mock mode the snapshot is the whole demo account and the
 * public read-only token covers it — same code path either way.
 */

/**
 * The vehicle's driver today, from Settings > Driver (legacy device metadata as
 * the fallback). Narrow on purpose: it is a label beside the vehicle, and every
 * point of width it takes comes out of the 31 day columns in the PDF. It is the
 * CURRENT assignment — nothing on these trackers records who drove a past day.
 */
const DRIVER_COLUMN = { key: 'driver', label: 'Driver', width: 120, get: r => r.driver || '—' }

const VARIANTS = {
  workHour: {
    title: 'Daywise Work Hour',
    subtitle: 'Engine-on hours per vehicle per day, for the selected month.',
    exportName: 'Daywise_Work_Hour',
    totalLabel: 'Total Work Hour',
    format: formatHoursMinutes,
    valueOf: (row, day) => row.ignitionSec[day] ?? 0,
    totalOf: row => row.totalSec,
    dayLabel: d => String(d),
    // The reference's Work Hour sheet identifies a row by "Object" alone; the
    // client asked for the driver beside it.
    identity: [
      { key: 'label', label: 'Object', width: 190, get: r => r.label },
      DRIVER_COLUMN,
    ],
    help: (
      <>
        <p style={{ margin: '0 0 8px' }}>
          A day&apos;s <strong>Work Hour</strong> is the time the engine was on —
          the gaps between consecutive messages whose earlier reading has
          <code> engine.ignition.status</code> set, summed per day.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          A silence longer than 30 minutes is treated as engine-off and excluded:
          these trackers sleep with the ignition, so a longer gap is parking, not
          unreported running. This is the same rule the vehicle Usage tab uses, so
          its running + idle for a day equals the cell here.
        </p>
        <p style={{ margin: 0 }}>
          Days are UAE days (UTC+4). A session running through midnight is split
          between the two days in proportion to the time either side of it.
        </p>
      </>
    ),
  },

  distance: {
    title: 'Daywise Distance Report',
    subtitle: 'Kilometres driven per vehicle per day, for the selected month.',
    exportName: 'Daywise_Distance',
    totalLabel: 'Total Distance',
    format: formatKm,
    valueOf: (row, day) => row.distanceKm[day] ?? 0,
    totalOf: row => row.totalKm,
    // The reference pads the day columns to 01..31 on this sheet.
    dayLabel: d => String(d).padStart(2, '0'),
    // The client asked for the company in the report HEADER, not as a column:
    // it is shown once above the table and in the PDF/Excel band (bgLabel).
    identity: [
      { key: 'label', label: 'Vehicle', width: 190, get: r => r.label },
      DRIVER_COLUMN,
    ],
    help: (
      <>
        <p style={{ margin: '0 0 8px' }}>
          A day&apos;s <strong>Distance</strong> is the increase in the tracker&apos;s own
          odometer (<code>vehicle.mileage</code>) across that day — the same rule
          the Movement Report&apos;s Cumulative Odo column uses, so the two agree for
          any given vehicle and day.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          Trackers that do not report an odometer are measured from GPS instead —
          the distance between consecutive positions while the vehicle is moving.
          GPS reads a few percent under a real odometer, because a fix every minute
          cuts corners.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          An odometer drop of more than a kilometre is a reset or a replaced unit,
          not driving: that stretch is measured from GPS rather than subtracted.
        </p>
        <p style={{ margin: 0 }}>
          Days are UAE days (UTC+4). A drive through midnight is split between the
          two days in proportion to the time either side of it.
        </p>
      </>
    ),
  },
}

const NOT_ASSIGNED = 'Not assigned'

export default function DaywisePage({ variant, isDark, toggleTheme, themeMode, setTheme }) {
  const V = VARIANTS[variant]

  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )

  const { data, noVehicles } = useFlespiData()
  // Subscribed so a BG renamed on the Company page, or a vehicle registered
  // after this page mounted, changes the Company column without a reload —
  // settingsProfileForImei reads both stores.
  const settingsVehicles = useVehicles()
  const companies = useCompanies()
  const drivers = useDrivers()

  /**
   * The live fleet, joined to its Settings registration.
   *
   * Same IMEI join the Live Map's vehicle panel uses. A device with no Settings
   * row is not an error — a tracker added to Flespi but not yet registered is an
   * ordinary state — so it keeps its row and reads "Not assigned".
   */
  const vehicles = useMemo(() => {
    const list = (data?.vehicles ?? []).map(v => {
      const profile = settingsProfileForImei(v.ident)
      return {
        id: v.id,
        ident: v.ident,
        label: profile.plateNo || v.master?.plateNo || profile.fleetNo || v.name,
        company: profile.linked ? (profile.bgName || NOT_ASSIGNED) : NOT_ASSIGNED,
        driver: driverNameForDevice(v),
      }
    })
    return list.sort((a, b) => a.label.localeCompare(b.label))
    // settingsVehicles, companies and drivers are not read directly here — they
    // are the stores settingsProfileForImei and driverNameForDevice read, so they
    // belong in the deps even though the linter cannot see through the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, settingsVehicles, companies, drivers])

  const bgOptions = useMemo(
    () => [...new Set(vehicles.map(v => v.company))].sort((a, b) => a.localeCompare(b)),
    [vehicles]
  )

  // ── filters ──
  const today = useRef(currentUaeMonth()).current
  const [month, setMonth] = useState(() => `${today.year}-${String(today.month).padStart(2, '0')}`)
  const [search, setSearch] = useState('')
  // null = all. Starts empty on every report: the client wants the vehicles
  // picked on purpose, not the whole fleet selected by default.
  const [selectedIds, setSelectedIds] = useState([])
  const [selectedBgs, setSelectedBgs] = useState(null) // null = all
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' })

  const [year, monthNo] = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    return [y, m]
  }, [month])

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const allBgs = selectedBgs === null || selectedBgs.length === bgOptions.length

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0
      ? 'Select vehicles'
      : effectiveIds.length === 1
      ? (vehicles.find(v => v.id === effectiveIds[0])?.label ?? '1 vehicle')
      : `${effectiveIds.length} vehicles`

  // Shown in the report header (screen, PDF, Excel), so it names the company
  // rather than counting them.
  const bgLabel = allBgs
    ? (bgOptions.length === 1 ? bgOptions[0] : 'All companies')
    : selectedBgs.length === 0 ? 'None' : selectedBgs.join(', ')

  // ── report state ──
  const [report, setReport] = useState(null) // { rows, days, year, month, capped }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const busy = progress !== null

  const toggleVehicle = id => {
    const current = selectedIds ?? vehicles.map(v => v.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedIds(next.length === vehicles.length ? null : next)
  }

  const toggleBg = name => {
    const current = selectedBgs ?? bgOptions
    const next = current.includes(name) ? current.filter(x => x !== name) : [...current, name]
    setSelectedBgs(next.length === bgOptions.length ? null : next)
  }

  const generate = useCallback(async () => {
    if (effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setReport(null)
    setProgress({ done: 0, total: daysInMonth(year, monthNo), text: 'Generating report...' })

    try {
      // The whole fleet is fetched even for a narrower selection: it is the same
      // one request per day, and it is what the background warm-up cached, so
      // any selection is served from the cache.
      const allIds = vehicles.map(v => v.id)
      const { derived, capped } = await loadDaywiseMonth(allIds, year, monthNo, {
        signal: controller.signal,
        onProgress: p => setProgress(p),
      })
      const selected = vehicles.filter(v => effectiveIds.includes(v.id))
      setReport({ ...rowsFromDerived(derived, selected, year, monthNo), capped })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [effectiveIds, vehicles, year, monthNo])

  const cancel = () => abortRef.current?.abort()

  // Stop waiting if the page unmounts mid-run. The month itself still finishes
  // into the cache (utils/daywise.js loadDaywiseMonth), so coming back is instant.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Compute the picked month in the background while the filters are being set,
  // so Generate finds it ready. A month already computed costs nothing.
  const fleetKey = vehicles.map(v => v.id).join(',')
  useEffect(() => {
    if (!fleetKey) return
    warmDaywiseMonth(fleetKey.split(',').map(Number), year, monthNo)
  }, [fleetKey, year, monthNo])

  // ── view model ──
  const visibleRows = useMemo(() => {
    if (!report) return []
    const q = search.trim().toLowerCase()
    let rows = report.rows
    if (q) {
      rows = rows.filter(r =>
        r.label.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.driver.toLowerCase().includes(q) ||
        String(r.ident ?? '').includes(q)
      )
    }
    if (!allBgs) rows = rows.filter(r => selectedBgs.includes(r.company))

    const dir = sort.dir === 'asc' ? 1 : -1
    const key = sort.key
    return rows.slice().sort((a, b) => {
      if (key === 'total') return (V.totalOf(a) - V.totalOf(b)) * dir
      return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir
    })
  }, [report, search, allBgs, selectedBgs, sort, V])

  const onSort = key => {
    setSort(s => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      // Names read best A-Z; a total reads best biggest-first, which is also how
      // the client's sample is sorted.
      : { key, dir: key === 'total' ? 'desc' : 'asc' }))
  }

  const columns = useMemo(() => [
    ...V.identity,
    { key: 'total', label: V.totalLabel, width: 110, align: 'right', get: r => V.format(V.totalOf(r)) },
  ], [V])

  const title = `${V.title} — ${monthLabel(year, monthNo)}`
  const lastElapsed = lastElapsedDay(year, monthNo)
  const days = daysInMonth(year, monthNo)

  const exportMeta = {
    title: V.title,
    monthLabel: monthLabel(year, monthNo),
    exportName: V.exportName,
    selection: selectionLabel,
    bgLabel,
  }
  const exportModel = { rows: visibleRows, days, lastElapsed, columns, format: V.format, valueOf: V.valueOf }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
        <Header
          isDark={isDark} toggleTheme={toggleTheme}
          themeMode={themeMode} setTheme={setTheme}
          onMenuClick={() => setSidebarOpen(s => !s)}
          noVehicles={noVehicles}
        />

        <main className="flex-1 overflow-y-auto no-scrollbar" id="daywise-main">
          <div style={{ maxWidth: 1600, margin: '0 auto', padding: '20px 16px 48px' }}>

            {/* ── header ── */}
            <div className="report-screen-only" style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>{V.title}</h1>
              <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '4px 0 0' }}>{V.subtitle}</p>
            </div>

            {/* ── toolbar ── */}
            <div className="report-screen-only" style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 12, padding: 16, marginBottom: 18,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
                <div>
                  <label style={LABEL}>MONTH</label>
                  <input
                    type="month"
                    style={FIELD}
                    value={month}
                    max={`${today.year}-${String(today.month).padStart(2, '0')}`}
                    onChange={e => { if (e.target.value) setMonth(e.target.value) }}
                  />
                </div>

                <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
                  <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}>
                    <strong>All vehicles</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {vehicles.map(v => (
                    <CheckRow
                      key={v.id}
                      checked={effectiveIds.includes(v.id)}
                      onChange={() => toggleVehicle(v.id)}
                      note={v.company}
                    >
                      {v.label}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <MultiSelect label="COMPANY (BG)" summary={bgLabel} disabled={bgOptions.length === 0}>
                  <CheckRow checked={allBgs} onChange={() => setSelectedBgs(allBgs ? [] : null)}>
                    <strong>All companies</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {bgOptions.map(name => (
                    <CheckRow
                      key={name}
                      checked={(selectedBgs ?? bgOptions).includes(name)}
                      onChange={() => toggleBg(name)}
                    >
                      {name}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <div>
                  <label style={LABEL}>SEARCH</label>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={13}
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)' }}
                    />
                    <input
                      type="search"
                      style={{ ...FIELD, paddingLeft: 30 }}
                      placeholder="Vehicle, driver, company or IMEI"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* ── actions ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--c-text3)', display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
                  {vehicles.length === 0 && 'No vehicles assigned to your account yet.'}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <HelpTip title={`How ${V.title} is calculated`}>{V.help}</HelpTip>
                  {busy && <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={busy || effectiveIds.length === 0}
                    style={{
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: busy || effectiveIds.length === 0 ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                      cursor: busy || effectiveIds.length === 0 ? 'not-allowed' : 'pointer',
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
                    {progress.total > 0 && <span style={{ fontWeight: 700 }}>{Math.round((progress.done / progress.total) * 100)}%</span>}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999, background: 'var(--ft-accent)',
                      width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      transition: 'width 0.25s ease',
                    }} />
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

            {report && (
              <div id="daywise-paper">
                <div className="report-screen-only" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                    <strong style={{ color: 'var(--c-text1)' }}>{visibleRows.length}</strong>
                    {' '}vehicle{visibleRows.length === 1 ? '' : 's'} · {monthLabel(year, monthNo)}
                    {' · '}Company: <strong style={{ color: 'var(--c-text1)' }}>{bgLabel}</strong>
                    {report.capped && (
                      <span style={{ color: '#f97316' }}> · truncated at Flespi&apos;s 3,000-message cap on at least one day</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <ToolbarButton onClick={() => exportDaywisePdf(exportModel, exportMeta)} icon={FileDown} primary>
                      Download PDF
                    </ToolbarButton>
                    <ToolbarButton onClick={() => exportDaywiseExcel(exportModel, exportMeta)} icon={FileSpreadsheet}>
                      Download Excel
                    </ToolbarButton>
                    <ToolbarButton onClick={printDaywiseReport} icon={Printer}>
                      Print
                    </ToolbarButton>
                  </div>
                </div>

                {/* Print-only title, so the sheet says which report and month it
                    is once the app chrome is hidden. */}
                <h2 className="daywise-print-title" style={{ display: 'none' }}>{title}</h2>

                <DaywiseTable
                  columns={columns}
                  rows={visibleRows}
                  days={days}
                  lastElapsed={lastElapsed}
                  valueOf={V.valueOf}
                  totalOf={V.totalOf}
                  format={V.format}
                  dayLabel={V.dayLabel}
                  sort={sort}
                  onSort={onSort}
                />
              </div>
            )}

            {!report && !busy && (
              <div className="report-screen-only" style={{
                background: 'var(--c-card)', border: '1px solid var(--c-border)',
                borderRadius: 12, padding: '48px 24px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text1)' }}>
                  Choose a month and press Generate Report.
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text3)', marginTop: 6 }}>
                  One row per vehicle, one column per day, exportable to PDF or Excel.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 6mm; }
          html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          #daywise-paper, #daywise-paper * { visibility: visible !important; }
          #daywise-paper { position: absolute !important; left: 0; top: 0; width: 100%; }
          #daywise-main { overflow: visible !important; }
          .report-screen-only { display: none !important; }
          .daywise-print-title { display: block !important; font-size: 13px; font-weight: 700; margin: 0 0 6px; }
          aside, header { display: none !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}
