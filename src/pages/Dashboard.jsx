import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Sidebar               from '../components/Sidebar'
import Header                from '../components/Header'
import FleetHealthScore      from '../components/FleetHealthScore'
import FleetGauge, { buildFleetMetrics, FLEET_GAUGE_FOOTNOTE } from '../components/dashboard/FleetGauge'
import WelcomeGreeting        from '../components/dashboard/WelcomeGreeting'
import FleetPerformanceRadar  from '../components/FleetPerformanceRadar'
import FleetTripsCard         from '../components/FleetTripsCard'
import FleetScoreCard         from '../components/FleetScoreCard'
import AlertMarkersCard      from '../components/AlertMarkersCard'
import FleetCompositionCard  from '../components/FleetCompositionCard'
import MaintenanceScoreCard  from '../components/MaintenanceScoreCard'
import TopDriversPanel       from '../components/TopDriversPanel'
import VehicleActivity       from '../components/VehicleActivity'
import LiveMap               from '../components/LiveMap'
import AIInsights            from '../components/AIInsights'
import VehicleStatus         from '../components/VehicleStatus'
import DriverPerformance     from '../components/DriverPerformance'
import AlertsOverview        from '../components/AlertsOverview'
import FuelEnergy            from '../components/FuelEnergy'
import TripAnalysis          from '../components/TripAnalysis'
import CostSummary           from '../components/CostSummary'
import { useFlespiData }     from '../hooks/useFlespiData'
import { computeHealthScore } from '../utils/healthScore'

// ── Widget registry ────────────────────────────────────────────────────────
const WIDGET_LIST = [
  { id: 'fleetHealth',       label: 'Fleet Health Gauge'     },
  { id: 'fleetRadar',        label: 'Fleet Performance Radar'},
  { id: 'fleetTrend',        label: 'Trips & Distance'       },
  { id: 'fleetScore',        label: 'Fleet Score Card'       },
  { id: 'alertMarkers',      label: 'Alert Markers'          },
  { id: 'fleetComposition',  label: 'Fleet Composition'      },
  { id: 'maintenanceScore',  label: 'Fleet Reliability'      },
  { id: 'vehicleActivity',   label: 'Vehicle Activity Chart' },
  { id: 'liveMap',           label: 'Live Fleet Map'         },
  { id: 'aiInsights',        label: 'AI Insights'            },
  { id: 'vehicleStatus',     label: 'Vehicle Status Table'   },
  { id: 'driverPerf',        label: 'Driver Performance'     },
  { id: 'alertsOverview',    label: 'Alerts Overview'        },
  { id: 'fuelEnergy',        label: 'Fuel & Energy'          },
  { id: 'tripAnalysis',      label: 'Trip Analysis'          },
  { id: 'costSummary',       label: 'Cost Summary'           },
]

// ── Helpers ────────────────────────────────────────────────────────────────
function loadHiddenWidgets() {
  try { return JSON.parse(localStorage.getItem('ft-hidden-widgets') || '[]') }
  catch { return [] }
}

function fmtUpdated(date) {
  if (!date) return ''
  const mins = Math.round((Date.now() - date.getTime()) / 60_000)
  return mins < 1 ? 'Just updated' : `Updated ${mins} min ago`
}

function recomputeData(data, vehicleIds) {
  if (!data || !vehicleIds) return data
  const vehicles    = data.vehicles.filter(v => vehicleIds.includes(v.id))
  const total       = vehicles.length
  const running     = vehicles.filter(v => v.status === 'Running').length
  const idle        = vehicles.filter(v => v.status === 'Idle').length
  const stopped     = vehicles.filter(v => v.status === 'Stopped').length
  const inactive    = vehicles.filter(v => v.status === 'Inactive').length
  const noData      = vehicles.filter(v => v.status === 'NoData').length
  const active      = running + idle
  const partial     = { total, active, running, idle, stopped, inactive, noData, vehicles,
    totalTrips: running * 3 + stopped,
    totalDistance: running * 85 + stopped * 12,
  }
  return { ...partial, healthScore: computeHealthScore(partial) }
}

// ── Inline SVGs ────────────────────────────────────────────────────────────
const IcoGear = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
)
const IcoClose = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IcoFilter = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)
const IcoSearch = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M9.375 3.042A6.333 6.333 0 003.042 9.375a6.333 6.333 0 006.333 6.333 6.333 6.333 0 006.333-6.333 6.333 6.333 0 00-6.333-6.333zm-7.833 6.333a7.833 7.833 0 1114.233 4.565l2.958 2.958a.75.75 0 11-1.06 1.06l-2.958-2.957A7.833 7.833 0 011.542 9.375z"/>
  </svg>
)
const IcoChevron = ({ open }) => (
  <svg style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

// ── WidgetWrapper ──────────────────────────────────────────────────────────
function WidgetWrapper({ id, hidden, onHide, onRefresh, children, className = '', noGear = false }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  if (hidden) return null

  return (
    <div className={`widget-wrapper${className ? ' ' + className : ''}`} style={{ position: 'relative' }}>
      {children}
      {!noGear && <div ref={menuRef} style={{ position: 'absolute', top: 10, right: 10, zIndex: 20 }}>
        <button
          className="widget-gear-btn"
          onClick={e => { e.stopPropagation(); setMenuOpen(s => !s) }}
          title="Widget options"
          style={{
            width: 26, height: 26, borderRadius: 8,
            border: '1px solid var(--c-border2)', background: 'var(--c-card)',
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--c-text3)',
            opacity: 0, transition: 'opacity 0.18s ease, color 0.15s ease, border-color 0.15s ease',
            boxShadow: '0 2px 8px -2px rgba(15,23,42,0.18)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--ft-accent)'; e.currentTarget.style.borderColor = 'var(--ft-accent)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--c-text3)'; e.currentTarget.style.borderColor = 'var(--c-border2)' }}
        >
          <IcoGear />
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 30, right: 0, minWidth: 168,
            background: 'var(--c-card)', border: '1px solid var(--c-border)',
            borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
            padding: '4px 0', zIndex: 100,
          }}>
            {[
              {
                label: 'Hide this widget',
                action: () => onHide(id),
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
              },
              {
                label: 'Refresh',
                action: () => onRefresh?.(),
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
              },
            ].map(item => (
              <button
                key={item.label}
                onClick={() => { item.action(); setMenuOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 14px', background: 'none',
                  border: 'none', cursor: 'pointer', fontSize: 12,
                  color: 'var(--c-text2)', textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>}
    </div>
  )
}

// ── FilterDropdown ─────────────────────────────────────────────────────────
function FilterSelect({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: 'var(--c-text3)', display: 'block', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '6px 10px', borderRadius: 6,
          border: '1px solid var(--c-border2)', background: 'var(--c-input)',
          color: 'var(--c-text1)', fontSize: 12, cursor: 'pointer', outline: 'none',
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard({ isDark, toggleTheme, themeMode, setTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  const { data, loading, error, mqttFatalError, mqttRetryNotice, lastUpdated, refresh, isConnected } = useFlespiData()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  // Widget visibility
  const [hiddenWidgets, setHiddenWidgets] = useState(loadHiddenWidgets)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Filter panel
  const [filterPanelOpen, setFilterPanelOpen]       = useState(false)
  const [filterSearch,    setFilterSearch]           = useState('')
  const [vehicleGroupOpen,setVehicleGroupOpen]       = useState(true)
  const [filterCompany,   setFilterCompany]          = useState('All')
  const [filterBranch,    setFilterBranch]           = useState('All')
  const [filterVehicleGroup, setFilterVehicleGroup] = useState('All')
  const [filterVehicleType,  setFilterVehicleType]  = useState('All')
  const [pendingIds, setPendingIds] = useState(null)
  const [appliedIds, setAppliedIds] = useState(null)

  // Load saved filter on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ft-saved-filter') || 'null')
      if (!saved) return
      if (saved.pendingIds         !== undefined) setPendingIds(saved.pendingIds)
      if (saved.filterCompany)      setFilterCompany(saved.filterCompany)
      if (saved.filterBranch)       setFilterBranch(saved.filterBranch)
      if (saved.filterVehicleGroup) setFilterVehicleGroup(saved.filterVehicleGroup)
      if (saved.filterVehicleType)  setFilterVehicleType(saved.filterVehicleType)
    } catch {}
  }, [])

  useEffect(() => {
    const onResize = () => { if (window.innerWidth < 1024) setSidebarOpen(false) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const filteredData = useMemo(
    () => recomputeData(data, appliedIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, appliedIds ? appliedIds.join(',') : null]
  )

  const panelVehicles = useMemo(() => {
    if (!data?.vehicles) return []
    const q = filterSearch.trim().toLowerCase()
    return q
      ? data.vehicles.filter(v => v.name.toLowerCase().includes(q) || v.ident.toLowerCase().includes(q))
      : data.vehicles
  }, [data?.vehicles, filterSearch])

  const allIds    = data?.vehicles?.map(v => v.id) ?? []
  const isChecked = id => pendingIds === null || pendingIds.includes(id)

  const toggleVehicle = id => {
    if (pendingIds === null) {
      setPendingIds(allIds.filter(vid => vid !== id))
    } else {
      const next = pendingIds.includes(id)
        ? pendingIds.filter(vid => vid !== id)
        : [...pendingIds, id]
      setPendingIds(next.length === allIds.length ? null : next)
    }
  }

  const handleApply = () => { setAppliedIds(pendingIds) }
  const handleSaveFilter = () => {
    localStorage.setItem('ft-saved-filter', JSON.stringify({
      pendingIds, filterCompany, filterBranch, filterVehicleGroup, filterVehicleType,
    }))
  }
  const handleDeleteFilter = () => {
    localStorage.removeItem('ft-saved-filter')
    setAppliedIds(null)
    setPendingIds(null)
  }

  const toggleWidget = useCallback(id => {
    setHiddenWidgets(prev => {
      const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id]
      localStorage.setItem('ft-hidden-widgets', JSON.stringify(next))
      return next
    })
  }, [])

  // Widget wrapper helper — cls applies Tailwind grid span etc., noGear suppresses the settings button
  const W = (id, node, cls = '', noGear = false) => (
    <WidgetWrapper id={id} hidden={hiddenWidgets.includes(id)} onHide={toggleWidget} onRefresh={refresh} className={cls} noGear={noGear}>
      {node}
    </WidgetWrapper>
  )

  const activeFilterCount = appliedIds !== null ? appliedIds.length : null

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="relative flex flex-col flex-1 overflow-hidden min-w-0" style={{ backgroundColor: 'var(--c-page)' }}>
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Header
          isDark={isDark}
          toggleTheme={toggleTheme}
          themeMode={themeMode}
          setTheme={setTheme}
          onMenuClick={() => setSidebarOpen(s => !s)}
          searchVehicles={data?.vehicles}
          isConnected={isConnected}
        />

        <main className="flex-1 overflow-y-auto no-scrollbar" style={{ overflowX: 'hidden' }}>
          <div className="p-4 md:p-5 xl:p-6 space-y-5">

            {/* ── Greeting + action bar ─────────────────────────────────
                Greeting owns the left; every control is grouped on the right
                so the page has one action cluster instead of two. */}
            <div className="flex items-end justify-between flex-wrap gap-3">

              <WelcomeGreeting />

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {loading && !data && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-text3)' }}>
                    <div style={{ width: 12, height: 12, border: '2px solid var(--c-border2)', borderTopColor: 'var(--ft-accent)', borderRadius: '50%', animation: 'db-spin 0.75s linear infinite' }} />
                    <span className="hidden sm:inline">Fetching fleet data...</span>
                    <span className="sm:hidden">Loading...</span>
                  </div>
                )}
                {lastUpdated && (
                  <div className="ft-chip">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span className="hidden sm:inline">{fmtUpdated(lastUpdated)} &middot; live via MQTT</span>
                    <span className="sm:hidden">{fmtUpdated(lastUpdated)}</span>
                    <button onClick={handleRefresh} title="Refresh now" disabled={refreshing} style={{ background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer', color: 'var(--ft-accent)', padding: 0, display: 'flex', alignItems: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: refreshing ? 'db-spin 0.7s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setCustomizeOpen(true)}
                  className="ft-btn"
                  title="Show or hide dashboard widgets"
                >
                  <IcoGear size={13} />
                  <span className="hidden sm:inline">Customize Dashboard</span>
                  <span className="sm:hidden">Customize</span>
                  {hiddenWidgets.length > 0 && (
                    <span style={{ background: 'var(--ft-accent)', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      {hiddenWidgets.length} hidden
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setFilterPanelOpen(s => !s)}
                  title="Toggle filter panel"
                  className={`ft-btn${filterPanelOpen || activeFilterCount !== null ? ' ft-btn--active' : ''}`}
                >
                  <IcoFilter />
                  <span className="hidden sm:inline">Filter</span>
                  {activeFilterCount !== null && (
                    <span style={{ background: 'var(--ft-accent)', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Red when the live feed is permanently broken, amber while it is
                merely rate-limited and retrying on its own. */}
            {(mqttFatalError || mqttRetryNotice) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: mqttFatalError ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${mqttFatalError ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.3)'}`,
                borderRadius: 12, padding: '10px 16px', fontSize: 12,
                color: mqttFatalError ? '#dc2626' : '#b45309',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {mqttFatalError || mqttRetryNotice} Showing last known positions from the fleet API instead.
              </div>
            )}

            {/* ════════════════════════════════════════════════════════
                MOBILE layout  (< 1024 px)
            ════════════════════════════════════════════════════════ */}
            <div className="lg:hidden space-y-4">

              {/* Row 2 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 items-stretch">
                {W('fleetHealth',     <FleetHealthScore isDark={isDark} fleetData={filteredData} loading={loading} />)}
                {W('vehicleActivity', <VehicleActivity  isDark={isDark} vehicleCount={filteredData?.total ?? 0} />)}
                {W('liveMap',         <LiveMap fleetData={filteredData} loading={loading} />)}
                {W('aiInsights',      <AIInsights fleetData={filteredData} />)}
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-1 gap-4">
                {W('vehicleStatus',  <VehicleStatus vehicles={filteredData?.vehicles} loading={loading} />)}
                {W('driverPerf',     <DriverPerformance />)}
                {W('alertsOverview', <AlertsOverview />)}
              </div>

              {/* Row 4 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 items-stretch">
                {W('fuelEnergy',   <FuelEnergy   isDark={isDark} />)}
                {W('tripAnalysis', <TripAnalysis isDark={isDark} />)}
                {W('costSummary',  <CostSummary  isDark={isDark} />)}
              </div>
            </div>

            {/* ════════════════════════════════════════════════════════
                DESKTOP layout  (>= 1024 px)  — ClyHealth style
            ════════════════════════════════════════════════════════ */}
            <div className="hidden lg:block space-y-5">

              {/* ── Hero panel ── */}
              <div className="ft-hero" style={{
                /* Symmetric side padding, so the radar's left margin and the
                   Trips card's right margin are identical and both sit fully
                   inside the panel. Bottom padding houses the gauge footnote,
                   which hangs out of flow just below the gauge so the arc
                   baseline can sit level with the bottom of the cards. */
                padding: '20px 30px 24px',
              }}>
                {/* Glow orbs */}
                <div style={{
                  position: 'absolute', top: -80, right: -80, width: 380, height: 380,
                  background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, transparent 70%)',
                  pointerEvents: 'none', borderRadius: '50%',
                  animation: 'hero-glow-float 6s ease-in-out infinite',
                }} />
                <div style={{
                  position: 'absolute', bottom: -100, left: -60, width: 320, height: 320,
                  background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
                  pointerEvents: 'none', borderRadius: '50%',
                }} />
                {/* Hairline sheen along the top edge */}
                <div style={{
                  position: 'absolute', top: 0, left: '12%', right: '12%', height: 1,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                  pointerEvents: 'none',
                }} />

                {/* Row 1: Radar | Gauge | Trips & Distance.
                    The two side columns are exactly equal (1fr each), which is
                    what puts the gauge's dome and centre readout on the hero's
                    true horizontal centre — an asymmetric pair would shift the
                    middle column off-centre by half the difference.
                    alignItems:stretch gives all three cells a common top and
                    bottom edge; each child decides how to sit inside its cell
                    (radar centred, gauge bottom-anchored, Trips card filling). */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.42fr) minmax(0, 1fr)', alignItems: 'stretch', gap: 24, position: 'relative', zIndex: 1 }}>
                  <div className="min-w-0 flex">
                    {W('fleetRadar', <FleetPerformanceRadar fleetData={filteredData} heroMode />, 'w-full min-w-0', true)}
                  </div>
                  {/* alignItems:flex-end drops the gauge onto the row's bottom
                      edge, so the flat base of the semicircle lines up with the
                      bottom of the cards either side. */}
                  <div
                    className="min-w-0"
                    style={{
                      overflow: 'visible',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    }}
                  >
                    {W('fleetHealth', (
                      <FleetGauge
                        percentile={(loading && !filteredData) ? 0 : computeHealthScore(filteredData)}
                        title="Your fleet performance"
                        metrics={buildFleetMetrics(filteredData)}
                        footnote={FLEET_GAUGE_FOOTNOTE}
                      />
                    ), 'w-full min-w-0', true)}
                  </div>
                  <div className="min-w-0 flex">
                    {W('fleetTrend', <FleetTripsCard fleetData={filteredData} />, 'w-full min-w-0', true)}
                  </div>
                </div>

              </div>

              {/* Every row below uses the same gap in both directions
                  (gap-5 = 20px) and stretches its cells, so cards in a row
                  always share one top and one bottom edge. */}

              {/* Score+Alerts (4) | Composition (4) | Maintenance (4) */}
              <div className="grid grid-cols-12 gap-5 items-stretch">
                <div className="col-span-4 min-w-0 flex flex-col gap-5">
                  {W('fleetScore',   <FleetScoreCard fleetData={filteredData} loading={loading} />)}
                  {W('alertMarkers', <AlertMarkersCard />)}
                </div>
                <div className="col-span-4 min-w-0 flex">
                  {W('fleetComposition', <FleetCompositionCard fleetData={filteredData} loading={loading} />)}
                </div>
                <div className="col-span-4 min-w-0 flex">
                  {W('maintenanceScore', <MaintenanceScoreCard fleetData={filteredData} loading={loading} />)}
                </div>
              </div>

              {/* Top Drivers | Live Map */}
              <div className="grid grid-cols-2 gap-5 items-stretch">
                <div className="min-w-0 flex">{W('driverPerf', <TopDriversPanel />)}</div>
                <div className="min-w-0 flex">{W('liveMap',    <LiveMap fleetData={filteredData} loading={loading} />)}</div>
              </div>

              {/* Vehicle Status | AI Insights | Alerts Overview */}
              <div className="grid grid-cols-3 gap-5 items-stretch">
                {W('vehicleStatus',  <VehicleStatus vehicles={filteredData?.vehicles} loading={loading} />)}
                {W('aiInsights',     <AIInsights fleetData={filteredData} />)}
                {W('alertsOverview', <AlertsOverview />)}
              </div>

              {/* Trip Analysis | Cost Summary | Fuel & Energy */}
              <div className="grid grid-cols-3 gap-5 items-stretch">
                {W('tripAnalysis', <TripAnalysis isDark={isDark} />)}
                {W('costSummary',  <CostSummary  isDark={isDark} />)}
                {W('fuelEnergy',   <FuelEnergy   isDark={isDark} />)}
              </div>
            </div>

          </div>
        </main>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Right Filter Panel
      ══════════════════════════════════════════════════════════════ */}
      {filterPanelOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(0,0,0,0.3)' }}
          onClick={() => setFilterPanelOpen(false)}
        />
      )}

      <div
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh',
          width: 300, zIndex: 50,
          background: 'var(--c-card)',
          borderLeft: '1px solid var(--c-border)',
          display: 'flex', flexDirection: 'column',
          transform: filterPanelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '-6px 0 32px rgba(0,0,0,0.12)',
          pointerEvents: filterPanelOpen ? 'auto' : 'none',
        }}
      >
        <div style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IcoFilter size={15} />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text1)' }}>Filter Vehicles</span>
          </div>
          <button
            onClick={() => setFilterPanelOpen(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <IcoClose />
          </button>
        </div>

        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          <FilterSelect label="Company"       value={filterCompany}      options={['All', 'AI Tracking']} onChange={setFilterCompany} />
          <FilterSelect label="Branch"        value={filterBranch}       options={['All']}                onChange={setFilterBranch} />
          <FilterSelect label="Vehicle Group" value={filterVehicleGroup} options={['All']}                onChange={setFilterVehicleGroup} />
          <FilterSelect label="Vehicle Type"  value={filterVehicleType}  options={['All']}                onChange={setFilterVehicleType} />

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.05em', color: 'var(--c-text3)', fontWeight: 600, marginBottom: 10 }}>
              OBJECT SELECTION
            </div>

            <div style={{ position: 'relative', marginBottom: 8 }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', display: 'flex' }}>
                <IcoSearch />
              </span>
              <input
                type="text"
                placeholder="Search vehicles..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '6px 10px 6px 26px', borderRadius: 6,
                  border: '1px solid var(--c-border2)', background: 'var(--c-input)',
                  color: 'var(--c-text1)', fontSize: 12, outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[
                { label: 'Select All',   action: () => setPendingIds(null) },
                { label: 'Deselect All', action: () => setPendingIds([]) },
              ].map(btn => (
                <button
                  key={btn.label}
                  onClick={btn.action}
                  style={{
                    flex: 1, padding: '5px 0', borderRadius: 5,
                    border: '1px solid var(--c-border2)', background: 'var(--c-input)',
                    cursor: 'pointer', fontSize: 11, color: 'var(--c-text2)', fontWeight: 500,
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ft-accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--c-border2)'}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div style={{ border: '1px solid var(--c-border2)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setVehicleGroupOpen(s => !s)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', background: 'var(--c-card2)', border: 'none',
                  cursor: 'pointer',
                  borderBottom: vehicleGroupOpen ? '1px solid var(--c-border2)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text1)' }}>
                  AI Tracking [{data?.vehicles?.length ?? 0}]
                </span>
                <IcoChevron open={vehicleGroupOpen} />
              </button>

              {vehicleGroupOpen && (
                <div className="no-scrollbar" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {loading && !data && (
                    <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--c-text3)', textAlign: 'center' }}>
                      Loading vehicles...
                    </div>
                  )}
                  {!loading && panelVehicles.length === 0 && (
                    <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--c-text3)', textAlign: 'center' }}>
                      No vehicles found
                    </div>
                  )}
                  {panelVehicles.map(v => (
                    <label
                      key={v.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', cursor: 'pointer',
                        borderBottom: '1px solid var(--c-border)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked(v.id)}
                        onChange={() => toggleVehicle(v.id)}
                        style={{ width: 13, height: 13, accentColor: 'var(--ft-accent)', flexShrink: 0, cursor: 'pointer' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--c-text1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.name}
                        </div>
                        {v.ident && (
                          <div style={{ fontSize: 10, color: 'var(--c-text3)', fontFamily: 'monospace' }}>
                            {v.ident}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--c-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleApply}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 7,
              background: 'var(--ft-accent)', border: 'none',
              color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--ft-accent-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--ft-accent)'}
          >
            Apply
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSaveFilter}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 7,
                border: '1px solid var(--c-border2)', background: 'var(--c-input)',
                color: 'var(--c-text2)', fontWeight: 500, fontSize: 12, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ft-accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--c-border2)'}
            >
              Save Filter
            </button>
            <button
              onClick={handleDeleteFilter}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 7,
                border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.05)',
                color: '#ef4444', fontWeight: 500, fontSize: 12, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.05)'}
            >
              Delete Filter
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          Customize Dashboard Modal
      ══════════════════════════════════════════════════════════════ */}
      {customizeOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.15s ease',
          }}
          onClick={() => setCustomizeOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--c-card)', borderRadius: 'var(--ft-radius)',
              border: '1px solid var(--c-border)',
              width: 400, maxWidth: '92vw', maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 70px -20px rgba(15,23,42,0.45)',
              animation: 'scaleIn 0.18s ease',
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--c-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IcoGear size={16} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--c-text1)' }}>Customize Dashboard</div>
                  <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 1 }}>Toggle widgets to show or hide</div>
                </div>
              </div>
              <button
                onClick={() => setCustomizeOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', display: 'flex', padding: 4, borderRadius: 5 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--c-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <IcoClose size={17} />
              </button>
            </div>

            <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
              {WIDGET_LIST.map((widget, i) => {
                const hidden = hiddenWidgets.includes(widget.id)
                return (
                  <div
                    key={widget.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '11px 0',
                      borderBottom: i < WIDGET_LIST.length - 1 ? '1px solid var(--c-border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: 2,
                        background: hidden ? 'var(--c-border2)' : 'var(--ft-accent)',
                        transition: 'background 0.2s',
                      }} />
                      <span style={{
                        fontSize: 13, fontWeight: 500,
                        color: hidden ? 'var(--c-text3)' : 'var(--c-text1)',
                        transition: 'color 0.2s',
                      }}>
                        {widget.label}
                      </span>
                    </div>

                    <button
                      onClick={() => toggleWidget(widget.id)}
                      style={{
                        width: 40, height: 22, borderRadius: 11,
                        background: hidden ? 'var(--c-border2)' : 'var(--ft-accent)',
                        border: 'none', cursor: 'pointer', position: 'relative',
                        transition: 'background 0.2s', flexShrink: 0,
                        outline: 'none',
                      }}
                    >
                      <div style={{
                        position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s',
                        left: hidden ? 3 : 21,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                  </div>
                )
              })}
            </div>

            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--c-border)',
              display: 'flex', gap: 8, justifyContent: 'space-between',
            }}>
              <button
                onClick={() => {
                  setHiddenWidgets([])
                  localStorage.setItem('ft-hidden-widgets', '[]')
                }}
                style={{
                  padding: '7px 14px', borderRadius: 7,
                  border: '1px solid var(--c-border2)', background: 'var(--c-input)',
                  color: 'var(--c-text2)', fontWeight: 500, fontSize: 12, cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ft-accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--c-border2)'}
              >
                Show All
              </button>
              <button
                onClick={() => setCustomizeOpen(false)}
                style={{
                  padding: '7px 24px', borderRadius: 7,
                  background: 'var(--ft-accent)', border: 'none',
                  color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ft-accent-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--ft-accent)'}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes db-spin { to { transform: rotate(360deg) } }
        @keyframes hero-glow-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-20px, 20px) scale(1.08); }
        }
        .widget-wrapper:hover .widget-gear-btn { opacity: 1 !important; }
        @media (hover: none) {
          .widget-gear-btn { opacity: 1 !important; }
        }
      `}</style>
    </div>
  )
}
