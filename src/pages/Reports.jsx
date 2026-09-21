import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { FileDown, FileSpreadsheet, Printer, ChevronDown, X, AlertTriangle, MapPin } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Header  from '../components/Header'
import MovementTable from '../components/reports/MovementTable'
import { useFlespiData } from '../hooks/useFlespiData'
import {
  fetchMovementMessages,
  deriveMovementReport,
  resolveReportLocations,
  countPendingGeocodes,
  formatDateTime,
  formatPrintDate,
  STATUS_DEFS,
  AVAILABLE_STATUS_KEYS,
  isAbortError,
} from '../utils/movementReport'
import { exportMovementPdf, exportMovementExcel, printMovementReport } from '../utils/reportExport'

// How many rows the on-screen table renders before asking. Exports and Print
// always emit everything; this only keeps the DOM from carrying five thousand
// rows before the user has decided the report is the one they wanted.
const PAGE_ROWS = 800

// Default cap on *network* reverse-geocode lookups per report. Nominatim allows
// ~1/sec, so this is also a time budget: 600 lookups is ~11 minutes worst case,
// far less in practice because an idling vehicle reuses one coordinate.
const DEFAULT_GEOCODE_LIMIT = 600

// One /messages request per calendar day per vehicle. Past this many the report
// is slow enough, and rate-limit-prone enough, to warn about before sending it.
const WARN_REQUESTS = 20

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

// Weeks run Monday to Sunday, same as the Replay panel's presets.
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

// ── shared control styling ────────────────────────────────────────────────

const LABEL = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--c-text2)', marginBottom: 6, letterSpacing: '0.02em' }

const FIELD = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 8, outline: 'none',
  border: '1px solid var(--c-border2)',
  background: 'var(--c-input)', color: 'var(--c-text1)',
  fontSize: 12.5, fontFamily: 'inherit',
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0, padding: '5px 12px', borderRadius: 999,
        border: `1px solid ${active ? 'var(--ft-accent)' : 'var(--c-border2)'}`,
        background: active ? 'color-mix(in srgb, var(--ft-accent) 12%, transparent)' : 'var(--c-input)',
        color: active ? 'var(--ft-accent)' : 'var(--c-text2)',
        fontSize: 11.5, fontWeight: active ? 700 : 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  )
}

/** Dropdown with checkboxes. Closes on outside click and on Escape. */
function MultiSelect({ label, summary, children, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={LABEL}>{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          ...FIELD, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--c-text3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 6,
          maxHeight: 280, overflowY: 'auto',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function CheckRow({ checked, onChange, disabled, title, children, note }) {
  return (
    <label
      title={title}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        fontSize: 12.5, color: 'var(--c-text1)',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--c-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{ marginTop: 2, accentColor: 'var(--ft-accent)', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block' }}>{children}</span>
        {note && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--c-text3)', marginTop: 1 }}>{note}</span>}
      </span>
    </label>
  )
}

function ToolbarButton({ onClick, icon: Icon, children, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '8px 14px', borderRadius: 8,
        border: primary ? 'none' : '1px solid var(--c-border2)',
        background: primary ? 'var(--ft-accent)' : 'var(--c-card)',
        color: primary ? '#fff' : 'var(--c-text1)',
        fontSize: 12.5, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} />
      {children}
    </button>
  )
}

// ── page ──────────────────────────────────────────────────────────────────

export default function Reports({ isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  const { data } = useFlespiData()
  const vehicles = useMemo(
    () => (data?.vehicles ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  )

  // ── filter form state ──
  const now = useRef(new Date()).current
  const [selectedIds,     setSelectedIds]     = useState(null) // null = all
  const [preset,          setPreset]          = useState('today')
  const [fromDate,        setFromDate]        = useState(() => dateStr(startOfDay(now)))
  const [toDate,          setToDate]          = useState(() => dateStr(now))
  const [fromTime,        setFromTime]        = useState('00:00')
  const [toTime,          setToTime]          = useState(() => timeStr(now))
  const [applyTolerance,  setApplyTolerance]  = useState(false)
  const [toleranceMeters, setToleranceMeters] = useState(0)
  const [statuses,        setStatuses]        = useState(AVAILABLE_STATUS_KEYS)
  const [resolveAddr,     setResolveAddr]     = useState(true)
  const [geocodeLimit,    setGeocodeLimit]    = useState(DEFAULT_GEOCODE_LIMIT)

  // ── report state ──
  const [byDevice,  setByDevice]  = useState(null)   // raw messages, kept for offline re-derive
  const [report,    setReport]    = useState(null)
  const [applied,   setApplied]   = useState(null)   // the range/selection the report was built for
  const [progress,  setProgress]  = useState(null)
  const [error,     setError]     = useState(null)
  const [visible,   setVisible]   = useState(PAGE_ROWS)
  const [geoTick,   setGeoTick]   = useState(0)      // forces a re-render as addresses land
  const abortRef = useRef(null)

  const busy = progress !== null

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected  = selectedIds === null || selectedIds.length === vehicles.length

  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs   = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000),   [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs

  const requestCount = rangeValid ? Math.max(1, Math.ceil((toTs - fromTs) / 86400)) * effectiveIds.length : 0

  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 1
      ? (vehicles.find(v => v.id === effectiveIds[0])?.master?.plateNo || vehicles.find(v => v.id === effectiveIds[0])?.name || '1 vehicle')
      : `${effectiveIds.length} vehicles`

  const statusesLabel = statuses.length === AVAILABLE_STATUS_KEYS.length
    ? 'All'
    : statuses.length === 0
      ? 'None'
      : STATUS_DEFS.filter(s => statuses.includes(s.key)).map(s => s.label).join(', ')

  // Signature of everything that can be re-derived without re-fetching. When it
  // stops matching the report's, the effect below re-derives from the messages
  // already in memory — no network, which is what makes the generated report
  // usable offline.
  const deriveSig = useMemo(
    () => JSON.stringify([[...statuses].sort(), applyTolerance, toleranceMeters]),
    [statuses, applyTolerance, toleranceMeters]
  )

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
    const current = selectedIds ?? vehicles.map(v => v.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedIds(next.length === vehicles.length ? null : next)
  }

  const toggleStatus = key => {
    setStatuses(s => (s.includes(key) ? s.filter(x => x !== key) : [...s, key]))
  }

  // ── generate ──
  const generate = useCallback(async () => {
    if (!rangeValid || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setReport(null)
    setByDevice(null)
    setVisible(PAGE_ROWS)
    setProgress({ phase: 'fetch', done: 0, total: effectiveIds.length, text: 'Starting...' })

    const snapshot = {
      fromTs, toTs, selectionLabel,
      printDate: formatPrintDate(),
    }

    try {
      const messages = await fetchMovementMessages(effectiveIds, fromTs, toTs, {
        onProgress: setProgress,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return

      setProgress({ phase: 'derive', done: 0, total: 1, text: 'Deriving movement rows...' })
      const built = deriveMovementReport(messages, {
        vehicles, statuses, applyTolerance, toleranceMeters,
      })
      built.deriveSig = deriveSig
      // `skipped` is what the "N locations unresolved" line reads, so seed it
      // with everything not already in the geocode cache — that is the true
      // figure when address lookups are switched off entirely.
      built.geocoded = { resolved: 0, skipped: countPendingGeocodes(built) }

      // Show the table before geocoding: the rows are already correct, the
      // Location column just fills in behind them.
      setByDevice(messages)
      setApplied(snapshot)
      setReport(built)

      if (resolveAddr && built.totalRows > 0) {
        const result = await resolveReportLocations(built, {
          limit: geocodeLimit,
          signal: controller.signal,
          onProgress: p => {
            setProgress(p)
            // Repainting a thousand rows once a second for ten minutes is
            // wasted work — batch the visible update.
            if (p.done % 10 === 0 || p.done === p.total) setGeoTick(t => t + 1)
          },
        })
        built.geocoded = result
        setGeoTick(t => t + 1)
      }
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, effectiveIds, fromTs, toTs, selectionLabel, vehicles, statuses, applyTolerance, toleranceMeters, deriveSig, resolveAddr, geocodeLimit])

  const cancel = () => abortRef.current?.abort()

  // Re-derive from messages already in memory when a client-side filter changes.
  // limit: 0 means "use the geocode cache, make no requests", so the addresses
  // already resolved survive the re-derive without a second round of lookups.
  useEffect(() => {
    if (!byDevice || busy || !report) return
    if (report.deriveSig === deriveSig) return

    const rebuilt = deriveMovementReport(byDevice, { vehicles, statuses, applyTolerance, toleranceMeters })
    rebuilt.deriveSig = deriveSig
    resolveReportLocations(rebuilt, { limit: 0 }).then(result => {
      rebuilt.geocoded = { resolved: report.geocoded?.resolved ?? 0, skipped: result.skipped }
      setReport(rebuilt)
      setVisible(PAGE_ROWS)
    })
  }, [byDevice, busy, report, deriveSig, vehicles, statuses, applyTolerance, toleranceMeters])

  // Resolve the addresses a capped run left behind.
  const resolveMore = async () => {
    if (!report) return
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ phase: 'geocode', done: 0, total: 1, text: 'Resolving addresses...' })
    try {
      const result = await resolveReportLocations(report, {
        limit: geocodeLimit,
        signal: controller.signal,
        onProgress: p => {
          setProgress(p)
          if (p.done % 10 === 0 || p.done === p.total) setGeoTick(t => t + 1)
        },
      })
      report.geocoded = {
        resolved: (report.geocoded?.resolved ?? 0) + result.resolved,
        skipped:  result.skipped,
      }
      setGeoTick(t => t + 1)
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  // Memoised so MovementTable's memo() is not defeated by a fresh object on
  // every live-telemetry re-render.
  const reportFilters = useMemo(() => applied && {
    selection:       applied.selectionLabel,
    fromLabel:       formatDateTime(applied.fromTs),
    toLabel:         formatDateTime(applied.toTs),
    applyTolerance,
    toleranceMeters: applyTolerance ? toleranceMeters : 0,
    statusesLabel,
    printDate:       applied.printDate,
  }, [applied, applyTolerance, toleranceMeters, statusesLabel])

  const exportMeta = { subtitle: 'AI Revofleet', systemName: 'FleetmaX', printDate: applied?.printDate }

  const showMore = useCallback(() => setVisible(v => v + PAGE_ROWS * 2), [])

  const handlePrint = () => {
    // Print must contain everything, not just the windowed rows.
    setVisible(Number.MAX_SAFE_INTEGER)
    requestAnimationFrame(() => setTimeout(printMovementReport, 0))
  }

  const handlePdf = async () => {
    try {
      await exportMovementPdf(report, reportFilters, exportMeta)
    } catch (err) {
      setError(`PDF export failed: ${err.message || err}`)
    }
  }

  const handleExcel = async () => {
    try {
      await exportMovementExcel(report, reportFilters, exportMeta)
    } catch (err) {
      setError(`Excel export failed: ${err.message || err}`)
    }
  }

  // Maintained wherever geocoding happens rather than recounted here — the page
  // re-renders on every live-telemetry push, and walking every row of a
  // five-thousand-row report that often is pure waste.
  const pendingGeocodes = report && !busy ? (report.geocoded?.skipped ?? 0) : 0
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null

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

        <main className="flex-1 overflow-y-auto no-scrollbar" id="reports-main">
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 16px 48px' }}>

            {/* ── Page header ── */}
            <div className="report-screen-only" style={{ marginBottom: 16 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text1)', margin: 0 }}>Movement Report</h1>
              <p style={{ fontSize: 12.5, color: 'var(--c-text3)', margin: '4px 0 0' }}>
                Per-vehicle movement log derived from Flespi telemetry — start-ups, driving, idling and ignition-off events with cumulative distance and location.
              </p>
            </div>

            {/* ── Filter form ── */}
            <div className="report-screen-only" style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 12, padding: 16, marginBottom: 18,
            }}>
              {/* Presets */}
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                {PRESETS.map(p => (
                  <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>

                <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
                  <CheckRow
                    checked={allSelected}
                    onChange={() => setSelectedIds(allSelected ? [] : null)}
                  >
                    <strong>All vehicles</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {vehicles.map(v => (
                    <CheckRow
                      key={v.id}
                      checked={effectiveIds.includes(v.id)}
                      onChange={() => toggleVehicle(v.id)}
                      note={v.master?.plateNo && v.master.plateNo !== v.name ? v.name : null}
                    >
                      {v.master?.plateNo || v.name}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <div>
                  <label style={LABEL}>FROM DATE</label>
                  <input type="date" style={FIELD} value={fromDate}
                    onChange={e => { setFromDate(e.target.value); setPreset('custom') }} />
                </div>

                <div>
                  <label style={LABEL}>FROM TIME</label>
                  <input type="time" style={FIELD} value={fromTime}
                    onChange={e => { setFromTime(e.target.value); setPreset('custom') }} />
                </div>

                <div>
                  <label style={LABEL}>TO DATE</label>
                  <input type="date" style={FIELD} value={toDate}
                    onChange={e => { setToDate(e.target.value); setPreset('custom') }} />
                </div>

                <div>
                  <label style={LABEL}>TO TIME</label>
                  <input type="time" style={FIELD} value={toTime}
                    onChange={e => { setToTime(e.target.value); setPreset('custom') }} />
                </div>

                <MultiSelect label="STATUSES" summary={statusesLabel}>
                  <CheckRow
                    checked={statuses.length === AVAILABLE_STATUS_KEYS.length}
                    onChange={() => setStatuses(
                      statuses.length === AVAILABLE_STATUS_KEYS.length ? [] : AVAILABLE_STATUS_KEYS
                    )}
                  >
                    <strong>All statuses</strong>
                  </CheckRow>
                  <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
                  {STATUS_DEFS.map(s => (
                    <CheckRow
                      key={s.key}
                      checked={statuses.includes(s.key)}
                      disabled={!!s.unavailable}
                      title={s.unavailable || undefined}
                      note={s.unavailable}
                      onChange={() => toggleStatus(s.key)}
                    >
                      {s.label}
                    </CheckRow>
                  ))}
                </MultiSelect>

                <div>
                  <label style={LABEL}>TOLERANCE (M)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={applyTolerance}
                      onChange={e => setApplyTolerance(e.target.checked)}
                      title="Apply Tolerance"
                      style={{ accentColor: 'var(--ft-accent)', cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
                    />
                    <input
                      type="number" min={0} step={5}
                      style={{ ...FIELD, opacity: applyTolerance ? 1 : 0.5 }}
                      value={toleranceMeters}
                      disabled={!applyTolerance}
                      onChange={e => setToleranceMeters(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>

                <div>
                  <label style={LABEL}>ADDRESS LOOKUPS</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={resolveAddr}
                      onChange={e => setResolveAddr(e.target.checked)}
                      title="Resolve addresses"
                      style={{ accentColor: 'var(--ft-accent)', cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
                    />
                    <input
                      type="number" min={0} step={100}
                      style={{ ...FIELD, opacity: resolveAddr ? 1 : 0.5 }}
                      value={geocodeLimit}
                      disabled={!resolveAddr}
                      onChange={e => setGeocodeLimit(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>
              </div>

              {/* Warnings + action */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
                <div style={{ fontSize: 11.5, color: 'var(--c-text3)', display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
                  {!rangeValid && (
                    <><AlertTriangle size={13} color="#f97316" /> From must be earlier than To.</>
                  )}
                  {rangeValid && requestCount > WARN_REQUESTS && (
                    <><AlertTriangle size={13} color="#f97316" /> {requestCount} Flespi requests for this range — this may hit the rate limit and take a few minutes.</>
                  )}
                  {rangeValid && requestCount <= WARN_REQUESTS && effectiveIds.length > 0 && (
                    <>{requestCount} Flespi request{requestCount === 1 ? '' : 's'} · {effectiveIds.length} vehicle{effectiveIds.length === 1 ? '' : 's'}</>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {busy && (
                    <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>
                  )}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={busy || !rangeValid || effectiveIds.length === 0}
                    style={{
                      padding: '9px 20px', borderRadius: 8, border: 'none',
                      background: busy || !rangeValid ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                      cursor: busy || !rangeValid ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busy ? 'Generating...' : 'Generate Report'}
                  </button>
                </div>
              </div>

              {/* Progress */}
              {progress && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c-text2)', marginBottom: 5 }}>
                    <span>{progress.text}</span>
                    {pct != null && <span style={{ fontWeight: 700 }}>{pct}%</span>}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999, background: 'var(--ft-accent)',
                      width: `${pct ?? 0}%`, transition: 'width 0.25s ease',
                    }} />
                  </div>
                </div>
              )}
            </div>

            {/* ── Error ── */}
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
            {report && report.totalRows > 0 && (
              <>
                <div className="report-screen-only" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, flexWrap: 'wrap', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
                    <strong style={{ color: 'var(--c-text1)' }}>{report.totalRows.toLocaleString()}</strong> rows
                    {' · '}{report.vehicles.length} vehicle{report.vehicles.length === 1 ? '' : 's'}
                    {report.truncated && (
                      <span style={{ color: '#f97316' }}> · truncated at Flespi's 3,000-message cap for at least one vehicle</span>
                    )}
                    {pendingGeocodes > 0 && (
                      <span style={{ color: 'var(--c-text3)' }}> · {pendingGeocodes.toLocaleString()} location{pendingGeocodes === 1 ? '' : 's'} unresolved</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {pendingGeocodes > 0 && (
                      <ToolbarButton onClick={resolveMore} icon={MapPin} disabled={busy}>
                        Resolve addresses
                      </ToolbarButton>
                    )}
                    <ToolbarButton onClick={handlePdf} icon={FileDown} disabled={busy} primary>
                      Download PDF
                    </ToolbarButton>
                    <ToolbarButton onClick={handleExcel} icon={FileSpreadsheet} disabled={busy}>
                      Download Excel
                    </ToolbarButton>
                    <ToolbarButton onClick={handlePrint} icon={Printer} disabled={busy}>
                      Print
                    </ToolbarButton>
                  </div>
                </div>

                <MovementTable
                  report={report}
                  filters={reportFilters}
                  limit={visible}
                  tick={geoTick}
                  onShowMore={showMore}
                />
              </>
            )}

            {/* ── Empty ── */}
            {report && report.totalRows === 0 && (
              <div className="report-screen-only" style={{
                background: 'var(--c-card)', border: '1px solid var(--c-border)',
                borderRadius: 12, padding: '48px 24px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text1)' }}>
                  No movement data for the selected range.
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text3)', marginTop: 6 }}>
                  Try a wider date range, more vehicles, or re-enable a status you filtered out.
                </div>
              </div>
            )}

            {!report && !busy && !error && (
              <div className="report-screen-only" style={{
                background: 'var(--c-card)', border: '1px dashed var(--c-border2)',
                borderRadius: 12, padding: '48px 24px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text1)' }}>
                  Choose a range and press Generate Report.
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text3)', marginTop: 6 }}>
                  Results are grouped by vehicle and date, and can be exported to PDF or Excel.
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Print: send the report paper only, in landscape, with the app chrome
          and the page's scroll containers out of the way. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          #movement-report-paper, #movement-report-paper * { visibility: visible !important; }
          #movement-report-paper {
            position: absolute !important; left: 0; top: 0; width: 100%;
            border: none !important; border-radius: 0 !important;
          }
          #movement-report-paper .report-screen-only { display: none !important; }
          #reports-main { overflow: visible !important; }
          .report-screen-only { display: none !important; }
          aside, header { display: none !important; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}
