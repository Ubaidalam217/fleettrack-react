import { useState, useEffect, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'

// Fix Leaflet default icon broken by bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const BASE_URL = import.meta.env.DEV ? '/flespi' : 'https://flespi.io'

const FLESPI_TOKEN = import.meta.env.VITE_FLESPI_TOKEN
const HEADERS = {
  'Authorization': `FlespiToken ${FLESPI_TOKEN}`,
  'Content-Type': 'application/json',
}
const TABS = ['Running', 'Idle', 'Stopped', 'Inactive', 'NoData', 'Total']

const STATUS_COLORS = {
  Running: '#22c55e',
  Idle:    '#eab308',
  Stopped: '#ef4444',
  Inactive:'#6b7280',
  NoData:  '#6b7280',
}

const TAB_COLORS = {
  Running: '#22c55e',
  Idle:    '#eab308',
  Stopped: '#ef4444',
  Inactive:'#6b7280',
  NoData:  '#6b7280',
  Total:   '#3b82f6',
}

function makeIcon(color, delay = 0) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);animation:markerDrop 0.45s cubic-bezier(0.175,0.885,0.32,1.275) ${delay}ms both"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  })
}

function getStatus(tel) {
  if (!tel) return 'NoData'
  const timestamps = Object.values(tel).map(v => v?.ts).filter(Boolean)
  if (!timestamps.length) return 'NoData'
  const lastTs = Math.max(...timestamps)
  if (Date.now() / 1000 - lastTs > 86400) return 'Inactive'
  const ignition = tel['engine.ignition.status']?.value
  const speed = tel['position.speed']?.value ?? 0
  if (ignition === true && speed > 0) return 'Running'
  if (ignition === true && speed === 0) return 'Idle'
  if (ignition === false) return 'Stopped'
  return 'NoData'
}

function getLastTs(tel) {
  if (!tel) return null
  const tss = Object.values(tel).map(v => v?.ts).filter(Boolean)
  return tss.length ? Math.max(...tss) : null
}

function fmt(ts) {
  if (!ts) return 'N/A'
  return new Date(ts * 1000).toLocaleString()
}

function vehicleName(v) {
  return v.name || v.configuration?.name || v.ident || `Device ${v.id}`
}

function MapFlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 15, { animate: true, duration: 1 })
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function Spinner({ size = 28 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `${size > 20 ? 4 : 3}px solid var(--c-border2)`,
      borderTopColor: '#3b82f6',
      borderRadius: '50%',
      animation: 'fleet-spin 0.75s linear infinite',
      flexShrink: 0,
    }} />
  )
}

export default function Tracking({ isDark, toggleTheme, themeMode, setTheme }) {
  // Sidebar: closed on mobile, open on desktop
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  // Vehicle panel: always hidden by default; CSS keeps it visible on desktop
  const [panelOpen, setPanelOpen] = useState(false)

  const [vehicles, setVehicles]     = useState([])
  const [telemetry, setTelemetry]   = useState({})
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState(null)
  const [activeTab, setActiveTab]   = useState('Total')
  const [search, setSearch]         = useState('')
  const [focusId, setFocusId]       = useState(null)
  const [flyTarget, setFlyTarget]   = useState(null)
  const flyCount                    = useRef(0)
  const isFirstLoad                 = useRef(true)

  // Auto-close sidebar on resize to mobile; reset panel state when entering desktop
  // so returning to mobile starts with panel closed (CSS handles desktop visibility)
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) setSidebarOpen(false)
      if (window.innerWidth >= 1024) setPanelOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fetchData = useCallback(async () => {
    if (!isFirstLoad.current) setRefreshing(true)
    try {
      const [devRes, telRes] = await Promise.all([
        fetch(`${BASE_URL}/gw/devices/all`, { headers: HEADERS }),
        fetch(`${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,engine.ignition.status,timestamp`, { headers: HEADERS }),
      ])
      if (!devRes.ok) throw new Error(`Devices API ${devRes.status}: ${devRes.statusText}`)
      if (!telRes.ok) throw new Error(`Telemetry API ${telRes.status}: ${telRes.statusText}`)
      const [devData, telData] = await Promise.all([devRes.json(), telRes.json()])
      setVehicles(devData.result || [])
      const telMap = {}
      ;(telData.result || []).forEach(item => { telMap[item.id] = item.telemetry })
      setTelemetry(telMap)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      isFirstLoad.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30000)
    return () => clearInterval(id)
  }, [fetchData])

  const enriched = vehicles.map(v => ({
    ...v,
    tel: telemetry[v.id] || null,
    status: getStatus(telemetry[v.id] || null),
  }))

  const counts = {
    Running:  enriched.filter(v => v.status === 'Running').length,
    Idle:     enriched.filter(v => v.status === 'Idle').length,
    Stopped:  enriched.filter(v => v.status === 'Stopped').length,
    Inactive: enriched.filter(v => v.status === 'Inactive').length,
    NoData:   enriched.filter(v => v.status === 'NoData').length,
    Total:    enriched.length,
  }

  const filtered = enriched
    .filter(v => activeTab === 'Total' || v.status === activeTab)
    .filter(v => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        String(v.id).includes(q) ||
        (v.name  || '').toLowerCase().includes(q) ||
        (v.ident || '').toLowerCase().includes(q) ||
        (v.configuration?.name || '').toLowerCase().includes(q)
      )
    })

  const mapped = enriched.filter(v =>
    v.tel?.['position.latitude']?.value != null &&
    v.tel?.['position.longitude']?.value != null
  )

  const handleSelect = useCallback((v) => {
    setFocusId(v.id)
    const lat = v.tel?.['position.latitude']?.value
    const lng = v.tel?.['position.longitude']?.value
    if (lat != null && lng != null) {
      setFlyTarget({ lat, lng, n: ++flyCount.current })
    }
    // On mobile: close panel after selecting a vehicle so map is visible
    if (window.innerWidth < 1024) setPanelOpen(false)
  }, [])

  return (
    <>
      <style>{`
        @keyframes fleet-spin { to { transform: rotate(360deg) } }
        @keyframes markerDrop {
          0%   { opacity: 0; transform: scale(0) translateY(-10px); }
          60%  { opacity: 1; transform: scale(1.25) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Mobile: fixed overlay that slides in from left, above map and Leaflet layers */
        .track-panel {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 320px !important;
          height: 100vh !important;
          z-index: 1000 !important;
          background-color: var(--c-card);
          border-right: 1px solid var(--c-border2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: transform 0.3s ease;
        }
        /* Desktop: inline flex participant, always visible, no z-index tricks */
        @media (min-width: 1024px) {
          .track-panel {
            position: relative !important;
            top: auto !important;
            left: auto !important;
            height: 100% !important;
            transform: translateX(0) !important;
            z-index: 1 !important;
          }
        }
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-page)' }}>
        <Sidebar sidebarOpen={sidebarOpen} />

        <div className="relative flex flex-col flex-1 overflow-hidden min-w-0" style={{ backgroundColor: 'var(--c-page)' }}>
          {/* Sidebar backdrop */}
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
          />

          {/* Tracking body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>

            {/* ── Vehicle panel backdrop — mobile only, hidden on desktop via lg:hidden ── */}
            {panelOpen && (
              <div
                className="fixed inset-0 lg:hidden"
                style={{ background: 'rgba(0,0,0,0.5)', zIndex: 999 }}
                onClick={() => setPanelOpen(false)}
              />
            )}

            {/* ── Left Panel ──
                Desktop (≥1024px): CSS overrides to relative + always visible
                Mobile (<1024px):  fixed overlay, slides in/out via transform
            */}
            <div
              className="track-panel"
              style={{ transform: panelOpen ? 'translateX(0)' : 'translateX(-100%)' }}
            >
              {/* Mobile-only panel header with close button — hidden on desktop */}
              <div
                className="flex lg:hidden items-center justify-between px-3 py-2"
                style={{ borderBottom: '1px solid var(--c-border2)', backgroundColor: 'var(--c-card)', paddingTop: '52px' }}
              >
                <span className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Vehicles ({filtered.length})</span>
                <button
                  onClick={() => setPanelOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', padding: 4, display: 'flex' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Status tabs */}
              <div style={{
                display: 'flex',
                borderBottom: '1px solid var(--c-border2)',
                flexShrink: 0,
                backgroundColor: 'var(--c-card)',
              }}>
                {TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      flex: 1,
                      padding: '10px 2px 8px',
                      fontSize: 9,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                      color: activeTab === tab ? '#3b82f6' : 'var(--c-text3)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      transition: 'color 0.15s',
                      letterSpacing: '0.01em',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: TAB_COLORS[tab], lineHeight: 1 }}>
                      {counts[tab]}
                    </span>
                    {tab}
                  </button>
                ))}
              </div>

              {/* Search bar */}
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--c-border2)', flexShrink: 0 }}>
                <div style={{ position: 'relative' }}>
                  <svg
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-text3)', pointerEvents: 'none' }}
                    width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5"
                  >
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, IMEI..."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px 8px 32px',
                      borderRadius: 8,
                      border: '1px solid var(--c-border)',
                      backgroundColor: 'var(--c-input)',
                      color: 'var(--c-text1)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Vehicle list */}
              <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                {loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48, color: 'var(--c-text2)', fontSize: 13 }}>
                    <Spinner />
                    Loading vehicles…
                  </div>
                ) : error ? (
                  <div style={{ padding: '16px 14px', color: '#ef4444', fontSize: 12, lineHeight: 1.6 }}>
                    <strong>Error:</strong> {error}
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 32, color: 'var(--c-text3)', fontSize: 12, textAlign: 'center' }}>
                    No vehicles found
                  </div>
                ) : (
                  filtered.map((v, idx) => {
                    const lat    = v.tel?.['position.latitude']?.value
                    const lng    = v.tel?.['position.longitude']?.value
                    const speed  = v.tel?.['position.speed']?.value
                    const lastTs = getLastTs(v.tel)
                    const sel    = focusId === v.id

                    return (
                      <div
                        key={v.id}
                        onClick={() => handleSelect(v)}
                        style={{
                          padding: '11px 14px',
                          borderBottom: '1px solid var(--c-border)',
                          cursor: 'pointer',
                          backgroundColor: sel ? 'var(--c-hover)' : 'transparent',
                          transition: 'background 0.15s',
                          animation: 'fadeInUp 0.35s ease both',
                          animationDelay: `${Math.min(idx * 35, 400)}ms`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                          <div style={{
                            width: 9, height: 9, borderRadius: '50%',
                            backgroundColor: STATUS_COLORS[v.status],
                            flexShrink: 0,
                            boxShadow: `0 0 0 2.5px ${STATUS_COLORS[v.status]}30`,
                          }} />
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--c-text1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {vehicleName(v)}
                          </span>
                          <span style={{ fontSize: 10, color: STATUS_COLORS[v.status], fontWeight: 700, flexShrink: 0 }}>
                            {v.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-text2)', paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span>Last seen: {fmt(lastTs)}</span>
                          <span>Speed: {speed != null ? `${speed} km/h` : 'N/A'}</span>
                          {lat != null && lng != null && (
                            <span style={{ color: 'var(--c-text3)' }}>
                              {lat.toFixed(5)}, {lng.toFixed(5)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}

                {refreshing && !loading && (
                  <div style={{
                    position: 'absolute', bottom: 12, right: 12,
                    display: 'flex', alignItems: 'center', gap: 6,
                    backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border2)',
                    borderRadius: 20, padding: '4px 10px', fontSize: 11, color: 'var(--c-text3)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  }}>
                    <Spinner size={12} />
                    Refreshing…
                  </div>
                )}
              </div>
            </div>

            {/* ── Map ── */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0, zIndex: 1 }}>

              {/* Mobile: fixed toggle button bottom-left — hidden on desktop via lg:hidden */}
              <button
                className="lg:hidden"
                onClick={() => setPanelOpen(p => !p)}
                style={{
                  position: 'fixed', bottom: 20, left: 20,
                  zIndex: 1001,
                  display: 'flex', alignItems: 'center', gap: 8,
                  backgroundColor: '#3b82f6', color: '#fff',
                  border: 'none', borderRadius: 24, padding: '10px 18px',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                }}
              >
                {panelOpen ? '✕ Close' : '☰ Vehicles'}
              </button>

              {/* Initial load overlay */}
              {loading && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'var(--c-card)', gap: 14, color: 'var(--c-text2)', fontSize: 14,
                }}>
                  <Spinner size={36} />
                  Loading map…
                </div>
              )}

              {/* API error banner */}
              {error && !loading && (
                <div style={{
                  position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
                  zIndex: 500, backgroundColor: '#ef4444', color: '#fff',
                  padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                  whiteSpace: 'nowrap',
                }}>
                  {error}
                </div>
              )}

              <MapContainer
                center={[24.4539, 54.3773]}
                zoom={11}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapFlyTo target={flyTarget} />

                {mapped.map((v, idx) => (
                  <Marker
                    key={v.id}
                    position={[
                      v.tel['position.latitude'].value,
                      v.tel['position.longitude'].value,
                    ]}
                    icon={makeIcon(STATUS_COLORS[v.status], Math.min(idx * 60, 600))}
                    eventHandlers={{ click: () => handleSelect(v) }}
                  >
                    <Popup>
                      <div style={{ fontSize: 13, lineHeight: 1.75, minWidth: 180 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#111' }}>
                          {vehicleName(v)}
                        </div>
                        <div style={{ color: STATUS_COLORS[v.status], fontWeight: 600, marginBottom: 4 }}>
                          ● {v.status}
                        </div>
                        <div style={{ color: '#444' }}>Speed: {v.tel['position.speed']?.value != null ? `${v.tel['position.speed'].value} km/h` : 'N/A'}</div>
                        <div style={{ color: '#444' }}>Last seen: {fmt(getLastTs(v.tel))}</div>
                        {v.ident && <div style={{ color: '#444' }}>IMEI: {v.ident}</div>}
                        {v.tel['position.latitude']?.value != null && (
                          <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>
                            {v.tel['position.latitude'].value.toFixed(5)}, {v.tel['position.longitude'].value.toFixed(5)}
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
