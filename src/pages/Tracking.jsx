import { useState, useEffect, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import VehicleDetailPanel from '../components/tracking/VehicleDetailPanel'
import { useFlespiMQTT } from '../hooks/useFlespiMQTT'
import {
  ALL, FILTERS, statusColor, statusLabel,
  filterLabel, filterColor, countByFilter, matchesFilter,
} from '../utils/vehicleStatus'
import { fetchDeviceTrack, buildSegments } from '../utils/replay'

// One step per tick while playing — fixed pace regardless of the actual time
// gap between consecutive messages, so playback speed doesn't depend on how
// densely a device reported.
const REPLAY_STEP_MS = 400

// Fix Leaflet default icon broken by bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function makeIcon(color, delay = 0) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);animation:markerDrop 0.45s cubic-bezier(0.175,0.885,0.32,1.275) ${delay}ms both"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  })
}

function fmt(ts) {
  if (!ts) return 'N/A'
  return new Date(ts * 1000).toLocaleString()
}

// Plate number is the spec's primary identifier; fall back to the Flespi
// device name until vehicle master data has been filled in.
function vehicleName(v) {
  return v.master?.plateNo || v.name || v.ident || `Device ${v.id}`
}

function MapFlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], 15, { animate: true, duration: 1 })
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Leaflet caches its container size, so any layout change that resizes the map
// box leaves grey gutters until invalidateSize() runs. The delay lets the CSS
// transition settle before we measure.
function MapResizer({ trigger }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250)
    return () => clearTimeout(t)
  }, [trigger]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function Tracking({ isDark, toggleTheme, themeMode, setTheme }) {
  // Sidebar: closed on mobile, open on desktop
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  )
  // Vehicle panel: always hidden by default; CSS keeps it visible on desktop
  const [panelOpen, setPanelOpen] = useState(false)

  // Live vehicle data, shared MQTT session, no REST polling. The map and shell
  // render immediately — nothing here gates the UI. Vehicles appear as MQTT
  // messages arrive; the hook's background REST bootstrap only fills in names
  // and last-known positions if and when it returns.
  const { vehicles, isConnected, error } = useFlespiMQTT()

  const [activeTab, setActiveTab]   = useState(ALL)
  const [search, setSearch]         = useState('')
  const [focusId, setFocusId]       = useState(null)
  const [flyTarget, setFlyTarget]   = useState(null)
  const flyCount                    = useRef(0)

  // Replay/History: scoped to whichever vehicle is currently selected. Reset
  // whenever the selection changes so a stale route never survives a switch.
  const [replayVehicleId, setReplayVehicleId] = useState(null)
  const [replayPoints, setReplayPoints]       = useState([])
  const [replayIndex, setReplayIndex]         = useState(0)
  const [replayPlaying, setReplayPlaying]     = useState(false)
  const [replayLoading, setReplayLoading]     = useState(false)
  const [replayError, setReplayError]         = useState(null)
  const [replayTruncated, setReplayTruncated] = useState(false)
  const [replayStatus, setReplayStatus]       = useState(null)

  useEffect(() => {
    setReplayVehicleId(null)
    setReplayPoints([])
    setReplayIndex(0)
    setReplayPlaying(false)
    setReplayError(null)
    setReplayTruncated(false)
    setReplayStatus(null)
  }, [focusId])

  // Fixed-pace playback: advance one point per tick, auto-pausing at the end.
  useEffect(() => {
    if (!replayPlaying || replayPoints.length === 0) return
    if (replayIndex >= replayPoints.length - 1) { setReplayPlaying(false); return }
    const t = setTimeout(() => setReplayIndex(i => Math.min(i + 1, replayPoints.length - 1)), REPLAY_STEP_MS)
    return () => clearTimeout(t)
  }, [replayPlaying, replayIndex, replayPoints.length])

  const handleReplayLoad = useCallback(async (fromTs, toTs) => {
    if (!focusId) return
    setReplayLoading(true)
    setReplayError(null)
    setReplayStatus(null)
    try {
      const { points, truncated } = await fetchDeviceTrack(focusId, fromTs, toTs, setReplayStatus)
      setReplayPoints(points)
      setReplayIndex(0)
      setReplayPlaying(false)
      setReplayTruncated(truncated)
      if (points.length === 0) {
        setReplayError('No GPS points in this range.')
      } else {
        setFlyTarget({ lat: points[0].lat, lng: points[0].lng, n: ++flyCount.current })
      }
    } catch (e) {
      setReplayError(e.message)
      setReplayPoints([])
    } finally {
      setReplayLoading(false)
      setReplayStatus(null)
    }
  }, [focusId])

  const replay = {
    active:    replayVehicleId === focusId && focusId != null,
    points:    replayPoints,
    index:     replayIndex,
    playing:   replayPlaying,
    loading:   replayLoading,
    error:     replayError,
    truncated: replayTruncated,
    status:    replayStatus,
    onStart:   () => setReplayVehicleId(focusId),
    onStop:    () => { setReplayVehicleId(null); setReplayPoints([]); setReplayPlaying(false) },
    onLoad:    handleReplayLoad,
    onPlayToggle: () => setReplayPlaying(p => !p),
    onSeek:    (idx) => { setReplayPlaying(false); setReplayIndex(idx) },
  }

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

  const counts = countByFilter(vehicles)

  const filtered = vehicles
    .filter(v => matchesFilter(v, activeTab))
    .filter(v => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        String(v.id).includes(q) ||
        (v.name             || '').toLowerCase().includes(q) ||
        (v.ident            || '').toLowerCase().includes(q) ||
        (v.master?.plateNo  || '').toLowerCase().includes(q) ||
        (v.master?.fleetNo  || '').toLowerCase().includes(q) ||
        (v.master?.driver?.name || '').toLowerCase().includes(q)
      )
    })

  // While a vehicle's route is loaded, its live marker is replaced by the
  // replay marker below so there's only ever one dot for that vehicle.
  const replayShowing = replay.active && replay.points.length > 0
  const mapped   = vehicles
    .filter(v => v.lat != null && v.lng != null)
    .filter(v => !(replayShowing && v.id === focusId))
  const selected = vehicles.find(v => v.id === focusId) ?? null
  const replaySegments = replayShowing ? buildSegments(replay.points) : []
  const replayPoint    = replayShowing ? replay.points[replay.index] : null

  const handleSelect = useCallback((v) => {
    setFocusId(v.id)
    if (v.lat != null && v.lng != null) {
      setFlyTarget({ lat: v.lat, lng: v.lng, n: ++flyCount.current })
    }
    // On mobile: close panel after selecting a vehicle so map is visible
    if (window.innerWidth < 1024) setPanelOpen(false)
  }, [])

  // Only live-connection failures reach the UI. Background REST bootstrap
  // failures are swallowed by the hook by design.
  const statusMessage = error

  return (
    <>
      <style>{`
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

        /* Right column: map on top, detail tabs beneath. min-height:0 on both
           the column and the map is what lets the flex children actually
           shrink instead of overflowing the viewport. */
        .track-split {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          z-index: 1;
        }
        .track-map {
          position: relative;
          flex: 1 1 auto;
          min-height: 0;
        }
        /* Mobile: hidden until a vehicle is selected (inline style overrides).
           Desktop: always visible, roughly the bottom half per the spec. */
        .track-detail {
          display: none;
          flex: 0 0 46%;
          min-height: 0;
        }
        @media (min-width: 1024px) {
          .track-detail { display: block; }
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
            isConnected={isConnected}
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
                {FILTERS.map(key => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    style={{
                      flex: 1,
                      padding: '10px 2px 8px',
                      fontSize: 9,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === key ? '2px solid #3b82f6' : '2px solid transparent',
                      color: activeTab === key ? '#3b82f6' : 'var(--c-text3)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      transition: 'color 0.15s',
                      letterSpacing: '0.01em',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: filterColor(key), lineHeight: 1 }}>
                      {counts[key]}
                    </span>
                    {filterLabel(key)}
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
                    placeholder="Search plate, fleet no, driver, IMEI..."
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
                {statusMessage ? (
                  <div style={{ padding: '16px 14px', color: '#ef4444', fontSize: 12, lineHeight: 1.6 }}>
                    <strong>Error:</strong> {statusMessage}
                  </div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 32, color: 'var(--c-text3)', fontSize: 12, textAlign: 'center', lineHeight: 1.7 }}>
                    {vehicles.length === 0 ? 'Waiting for live data…' : 'No vehicles found'}
                  </div>
                ) : (
                  filtered.map((v, idx) => {
                    const sel = focusId === v.id

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
                            backgroundColor: statusColor(v.status),
                            flexShrink: 0,
                            boxShadow: `0 0 0 2.5px ${statusColor(v.status)}30`,
                          }} />
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--c-text1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {vehicleName(v)}
                          </span>
                          <span style={{ fontSize: 10, color: statusColor(v.status), fontWeight: 700, flexShrink: 0 }}>
                            {statusLabel(v.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-text2)', paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {v.master?.fleetNo && <span>Fleet: {v.master.fleetNo}</span>}
                          <span>Driver: {v.master?.driver?.name || 'Unassigned'}</span>
                          <span>Speed: {v.speed != null ? `${v.speed} km/h` : 'N/A'}</span>
                          <span>Last update: {fmt(v.lastTs)}</span>
                          {v.lat != null && v.lng != null && (
                            <span style={{ color: 'var(--c-text3)' }}>
                              {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* ── Right column: map on top, detail tabs beneath (spec layout) ── */}
            <div className="track-split">

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

              {/* Map */}
              <div className="track-map">
                {/* Status banner — live connection errors only. Non-blocking:
                    the map stays interactive underneath. */}
                {statusMessage && (
                  <div style={{
                    position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 500, backgroundColor: '#ef4444', color: '#fff',
                    padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    whiteSpace: 'nowrap',
                  }}>
                    {statusMessage}
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
                  {/* The detail panel appearing on mobile shrinks the map box;
                      Leaflet needs telling or it renders grey tiles. */}
                  <MapResizer trigger={!!selected} />

                  {mapped.map((v, idx) => (
                    <Marker
                      key={v.id}
                      position={[v.lat, v.lng]}
                      icon={makeIcon(statusColor(v.status), Math.min(idx * 60, 600))}
                      eventHandlers={{ click: () => handleSelect(v) }}
                    >
                      <Popup>
                        <div style={{ fontSize: 13, lineHeight: 1.75, minWidth: 190 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#111' }}>
                            {vehicleName(v)}
                          </div>
                          <div style={{ color: statusColor(v.status), fontWeight: 600, marginBottom: 4 }}>
                            ● {statusLabel(v.status)}
                          </div>
                          {v.master?.fleetNo && <div style={{ color: '#444' }}>Fleet No: {v.master.fleetNo}</div>}
                          <div style={{ color: '#444' }}>Driver: {v.master?.driver?.name || 'Unassigned'}</div>
                          <div style={{ color: '#444' }}>Speed: {v.speed != null ? `${v.speed} km/h` : 'N/A'}</div>
                          <div style={{ color: '#444' }}>Last Updated: {fmt(v.lastTs)}</div>
                          {v.ident && <div style={{ color: '#444' }}>IMEI: {v.ident}</div>}
                          {v.lat != null && (
                            <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>
                              {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                  {replaySegments.map(seg => (
                    <Polyline
                      key={seg.key}
                      positions={seg.positions}
                      pathOptions={{ color: seg.color, weight: 4, opacity: 0.85 }}
                    />
                  ))}

                  {replayPoint && (
                    <Marker
                      position={[replayPoint.lat, replayPoint.lng]}
                      icon={makeIcon(statusColor(replayPoint.status))}
                    >
                      <Popup>
                        <div style={{ fontSize: 13, lineHeight: 1.75, minWidth: 170 }}>
                          <div style={{ color: statusColor(replayPoint.status), fontWeight: 700, marginBottom: 4 }}>
                            ● {statusLabel(replayPoint.status)}
                          </div>
                          <div style={{ color: '#444' }}>Speed: {replayPoint.speed} km/h</div>
                          <div style={{ color: '#444' }}>Time: {fmt(replayPoint.ts)}</div>
                          <div style={{ color: '#888', fontSize: 11, marginTop: 3 }}>
                            {replayPoint.lat.toFixed(5)}, {replayPoint.lng.toFixed(5)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>

              {/* Detail tabs — always present on desktop, revealed on mobile
                  once a vehicle is selected (inline style overrides the class). */}
              <div className="track-detail" style={selected ? { display: 'block' } : undefined}>
                <VehicleDetailPanel vehicle={selected} replay={replay} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
