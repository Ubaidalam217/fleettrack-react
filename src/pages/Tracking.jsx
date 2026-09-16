import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Polyline, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import VehicleDetailPanel from '../components/tracking/VehicleDetailPanel'
import VehicleListCard, { LIST_CARD_CSS } from '../components/tracking/VehicleListCard'
import VehiclePopup from '../components/tracking/VehiclePopup'
import CarMarker, { CAR_MARKER_CSS } from '../components/tracking/CarMarker'
import ReplayPanel from '../components/tracking/ReplayPanel'
import ReplayInfoCard, { REPLAY_INFO_CSS } from '../components/tracking/ReplayInfoCard'
import { DEFAULT_REPLAY_FIELDS } from '../components/tracking/replayFields'
import { useFlespiMQTT } from '../hooks/useFlespiMQTT'
import {
  ALL, FILTERS, statusColor, statusLabel,
  filterLabel, filterColor, countByFilter, matchesFilter,
} from '../utils/vehicleStatus'
import { fetchDeviceTrack, buildSegments } from '../utils/replay'

// Points per second at 1x. The playback effect derives its tick interval and
// its stride from this and the chosen speed multiplier.
const REPLAY_BASE_STEP_MS = 400
// Ceiling on how often state is allowed to change during playback. Without it,
// 10x would mean a 40ms tick — 25 re-renders a second of the whole page — so
// past this point the track advances several points per tick instead.
const MAX_TICKS_PER_SEC = 8

const DESKTOP_MIN = 1024
const FIELDS_KEY  = 'ft-replay-fields'

// Fix Leaflet default icon broken by bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function loadFields() {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELDS_KEY) || 'null')
    return saved ? { ...DEFAULT_REPLAY_FIELDS, ...saved } : DEFAULT_REPLAY_FIELDS
  } catch {
    return DEFAULT_REPLAY_FIELDS
  }
}

function fmt(ts) {
  if (!ts) return 'N/A'
  return new Date(ts * 1000).toLocaleString()
}

// Plate number is the spec's primary identifier; fall back to the Flespi
// device name until vehicle master data has been filled in.
function vehicleName(v) {
  if (!v) return ''
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

// Keeps the replay marker on screen and clear of the control dock as the track
// plays.
//
// The inset along the bottom is what stops the marker and its info card from
// ending up underneath the replay dock. Only pans when the marker has actually
// left the safe rectangle, so it doesn't drag the map away from a user who
// panned somewhere deliberately, and never animates — at 10x a smooth pan is
// still running when the next point arrives.
const FOLLOW_INSET = { top: 70, right: 60, bottom: 175, left: 60 }

function ReplayFollow({ point }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    const size = map.getSize()
    const p    = map.latLngToContainerPoint([point.lat, point.lng])

    // Positive dy pans the view down, which moves the marker up the screen.
    let dx = 0
    let dy = 0
    if (p.x < FOLLOW_INSET.left)               dx = p.x - FOLLOW_INSET.left
    else if (p.x > size.x - FOLLOW_INSET.right) dx = p.x - (size.x - FOLLOW_INSET.right)
    if (p.y < FOLLOW_INSET.top)                dy = p.y - FOLLOW_INSET.top
    else if (p.y > size.y - FOLLOW_INSET.bottom) dy = p.y - (size.y - FOLLOW_INSET.bottom)

    if (dx || dy) map.panBy([dx, dy], { animate: false })
  }, [point]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Leaflet caches its container size, so any layout change that resizes the map
// box leaves grey gutters — and a stale getSize() — until invalidateSize()
// runs.
//
// Observing the container beats firing a timer after each layout change: a
// timer has to guess when the sheet and list transitions have settled, and
// when it guesses short Leaflet keeps reporting the pre-transition height.
// ReplayFollow's safe-rect maths reads getSize(), so that staleness silently
// stopped the map following the replay marker at all.
function MapAutoSize() {
  const map = useMap()
  useEffect(() => {
    let raf = null
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    ro.observe(map.getContainer())
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [map])
  return null
}

export default function Tracking({ isDark, toggleTheme, themeMode, setTheme }) {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN
  )
  // Sidebar: closed on mobile, open on desktop
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN
  )
  // Vehicle list: one piece of state for both breakpoints now. Open by default
  // on desktop, closed on mobile where it covers the map.
  const [listOpen, setListOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN
  )

  // Live vehicle data, shared MQTT session, no REST polling. The map and shell
  // render immediately — nothing here gates the UI. Vehicles appear as MQTT
  // messages arrive; the hook's background REST bootstrap only fills in names
  // and last-known positions if and when it returns.
  const { vehicles, isConnected, error } = useFlespiMQTT()

  const [activeTab, setActiveTab]   = useState(ALL)
  const [search, setSearch]         = useState('')
  const [focusId, setFocusId]       = useState(null)
  const [flyTarget, setFlyTarget]   = useState(null)
  const [openPopupId, setOpenPopupId] = useState(null)
  const flyCount                    = useRef(0)
  const rowRefs                     = useRef(new Map())

  // Replay/History: scoped to one vehicle at a time.
  const [replayVehicleId, setReplayVehicleId] = useState(null)
  const [replayPoints, setReplayPoints]       = useState([])
  const [replayIndex, setReplayIndex]         = useState(0)
  const [replayPlaying, setReplayPlaying]     = useState(false)
  const [replayLoading, setReplayLoading]     = useState(false)
  const [replayError, setReplayError]         = useState(null)
  const [replayTruncated, setReplayTruncated] = useState(false)
  const [replayStatus, setReplayStatus]       = useState(null)
  const [replaySpeed, setReplaySpeed]         = useState(1)
  const [replayFields, setReplayFields]       = useState(loadFields)

  const setFields = useCallback(next => {
    setReplayFields(next)
    try { localStorage.setItem(FIELDS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }, [])

  const clearReplay = useCallback(() => {
    setReplayVehicleId(null)
    setReplayPoints([])
    setReplayIndex(0)
    setReplayPlaying(false)
    setReplayError(null)
    setReplayTruncated(false)
    setReplayStatus(null)
  }, [])

  // Fixed-pace playback. Above MAX_TICKS_PER_SEC the stride grows instead of
  // the tick shrinking, so 10x stays at ~6 renders/sec while still covering 25
  // points a second.
  useEffect(() => {
    if (!replayPlaying || replayPoints.length === 0) return
    if (replayIndex >= replayPoints.length - 1) { setReplayPlaying(false); return }

    const ptsPerSec = (1000 / REPLAY_BASE_STEP_MS) * replaySpeed
    const stride    = Math.max(1, Math.ceil(ptsPerSec / MAX_TICKS_PER_SEC))
    const tickMs    = Math.round(1000 * stride / ptsPerSec)

    const t = setTimeout(
      () => setReplayIndex(i => Math.min(i + stride, replayPoints.length - 1)),
      tickMs
    )
    return () => clearTimeout(t)
  }, [replayPlaying, replayIndex, replayPoints.length, replaySpeed])

  const handleReplayLoad = useCallback(async (fromTs, toTs) => {
    if (!replayVehicleId) return
    setReplayLoading(true)
    setReplayError(null)
    setReplayStatus(null)
    try {
      const { points, truncated } = await fetchDeviceTrack(replayVehicleId, fromTs, toTs, setReplayStatus)
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
  }, [replayVehicleId])

  // Track the viewport so the list toggle can behave differently per breakpoint
  // without a second piece of state to keep in sync.
  useEffect(() => {
    const onResize = () => {
      const desktop = window.innerWidth >= DESKTOP_MIN
      setIsDesktop(prev => {
        if (prev === desktop) return prev
        // Crossing the breakpoint resets both drawers to that layout's default,
        // otherwise a list left open on mobile reappears as an overlay.
        setSidebarOpen(desktop)
        setListOpen(desktop)
        return desktop
      })
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

  const selected = vehicles.find(v => v.id === focusId) ?? null

  // The sheet keeps rendering its vehicle for the length of the slide-down, so
  // deselecting animates away instead of vanishing mid-transition.
  const [sheetVehicleId, setSheetVehicleId] = useState(null)
  useEffect(() => {
    if (focusId != null) { setSheetVehicleId(focusId); return }
    const t = setTimeout(() => setSheetVehicleId(null), 400)
    return () => clearTimeout(t)
  }, [focusId])
  const sheetVehicle = vehicles.find(v => v.id === sheetVehicleId) ?? null

  // Pull the freshly expanded card into view.
  //
  // Scrolls the card, not the row that owns it: 'nearest' is a no-op while any
  // part of the target is visible, so targeting the row leaves the card itself
  // hanging off the bottom whenever the row header happens to be on screen.
  //
  // Watches the card's size rather than timing the animation. Nothing about
  // when the card reaches its final height is predictable: it grows through a
  // grid-template-rows transition, and then grows again a second later when
  // the reverse-geocoded address arrives and wraps onto another line. Both a
  // fixed delay and transitionend fire too early and scroll short.
  //
  // ResizeObserver fires on every frame of both, the debounce collapses them
  // into one scroll against final layout, and 'nearest' makes any later call a
  // no-op once the card is fully visible.
  useEffect(() => {
    if (focusId == null) return
    const card = rowRefs.current.get(focusId)?.querySelector('.vl-card')
    if (!card) return

    let settle = null
    const reveal   = () => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const schedule = () => { clearTimeout(settle); settle = setTimeout(reveal, 90) }

    const ro = new ResizeObserver(schedule)
    ro.observe(card)
    return () => { ro.disconnect(); clearTimeout(settle) }
  }, [focusId])

  // While a vehicle's route is loaded, its live marker is replaced by the
  // replay marker below so there's only ever one car for that vehicle.
  const replayActive  = replayVehicleId != null
  const replayShowing = replayActive && replayPoints.length > 0
  const mapped = vehicles
    .filter(v => v.lat != null && v.lng != null)
    .filter(v => !(replayShowing && v.id === replayVehicleId))

  // Keyed on the points array only. Rebuilding this inline meant every playback
  // tick produced new positions arrays for every segment, so react-leaflet
  // re-ran setLatLngs()/setStyle() on the whole track several times a second.
  // The track itself never changes during playback. pathOptions is built here
  // rather than inline in the JSX for the same reason: a fresh object literal
  // per render is a prop change to react-leaflet and costs a setStyle() call.
  const replaySegments = useMemo(
    () => (replayShowing
      ? buildSegments(replayPoints).map(s => ({
          ...s,
          pathOptions: { color: s.color, weight: 4, opacity: 0.85 },
        }))
      : []),
    [replayShowing, replayPoints]
  )
  const replayPoint = replayShowing ? replayPoints[replayIndex] : null

  const flyTo = (v) => {
    if (v.lat == null || v.lng == null) return
    setFlyTarget({ lat: v.lat, lng: v.lng, n: ++flyCount.current })
  }

  const selectVehicle = (v, { startReplay = false } = {}) => {
    // A route belonging to some other vehicle is meaningless here — drop it.
    if (replayVehicleId !== v.id) clearReplay()
    setFocusId(v.id)
    flyTo(v)
    // On mobile the list covers the map, so get out of the way of the thing
    // the user just asked to look at.
    if (!isDesktop) setListOpen(false)
    if (startReplay) setReplayVehicleId(v.id)
  }

  // Clicking the already-open row closes its card and the detail sheet with it.
  const handleRowClick = (v) => {
    if (focusId === v.id) {
      setFocusId(null)
      clearReplay()
      return
    }
    selectVehicle(v)
  }

  const replay = {
    points:    replayPoints,
    index:     replayIndex,
    playing:   replayPlaying,
    loading:   replayLoading,
    error:     replayError,
    truncated: replayTruncated,
    status:    replayStatus,
    speed:     replaySpeed,
    fields:    replayFields,
    onStop:    clearReplay,
    onLoad:    handleReplayLoad,
    onPlayToggle:   () => setReplayPlaying(p => !p),
    onSeek:         (idx) => { setReplayPlaying(false); setReplayIndex(idx) },
    onSpeedChange:  setReplaySpeed,
    onFieldsChange: setFields,
  }

  // Only live-connection failures reach the UI. Background REST bootstrap
  // failures are swallowed by the hook by design.
  const statusMessage = error
  const sheetOpen = !!selected
  // On mobile the list is a full-height overlay with its own close button, so
  // the floating toggle would just sit on top of it.
  const toggleHidden = !isDesktop && listOpen

  return (
    <>
      <style>{`
        ${CAR_MARKER_CSS}
        ${LIST_CARD_CSS}
        ${REPLAY_INFO_CSS}

        /* ── Vehicle list ──
           Mobile: full-height overlay sliding in from the left, above the map.
           Desktop: an inline flex child whose width animates to zero. The inner
           wrapper keeps a fixed 320px so the contents don't reflow while the
           outer box is mid-animation. */
        .track-panel {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          z-index: 1000;
          overflow: hidden;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
        }
        .track-panel[data-open="true"] { transform: translateX(0); }

        .track-panel-inner {
          width: 320px;
          height: 100%;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background-color: var(--c-card);
          border-right: 1px solid var(--c-border2);
        }

        @media (min-width: ${DESKTOP_MIN}px) {
          .track-panel {
            position: relative;
            top: auto;
            left: auto;
            height: 100%;
            z-index: 1;
            width: 0;
            min-width: 0;
            transform: none;
            transition: width 0.3s ease;
          }
          .track-panel[data-open="true"] { width: 320px; min-width: 320px; }
          .track-panel-inner {
            transform: translateX(-100%);
            transition: transform 0.3s ease;
          }
          .track-panel[data-open="true"] .track-panel-inner { transform: translateX(0); }
        }

        /* Right column: map on top, detail sheet beneath. min-height:0 on both
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

        /* List toggle. Lives inside .track-map, so it can never land on top of
           the detail sheet the way the old fixed-position button did. Leaflet's
           own controls sit at z-index 800. */
        .track-toggle {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 900;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 8px 13px;
          border-radius: 10px;
          border: 1px solid var(--c-border2);
          background-color: var(--c-card);
          color: var(--c-text1);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(0,0,0,0.18);
          transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.15s;
        }
        .track-toggle[data-hidden="true"] {
          opacity: 0;
          pointer-events: none;
          transform: translateX(-8px);
        }

        /* Replay dock — floats over the bottom of the map, above the sheet. */
        .track-replay-dock {
          position: absolute;
          left: 50%;
          bottom: 14px;
          transform: translateX(-50%);
          z-index: 900;
          width: min(700px, calc(100% - 24px));
        }

        /* ── Detail sheet ──
           Hidden outright with nothing selected; slides up when a vehicle is.
           display:none can't be transitioned, so the height of the outer box
           and the transform of the inner one are animated together. */
        .track-detail {
          /* Roughly the proportion the sheet had before it became collapsible,
             which leaves the phone-sized map tall enough for a marker popup. */
          --sheet-h: 52vh;
          flex: 0 0 auto;
          height: 0;
          min-height: 0;
          overflow: hidden;
          transition: height 0.34s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .track-detail[data-open="true"] { height: var(--sheet-h); }
        .track-detail-inner {
          height: var(--sheet-h);
          transform: translateY(100%);
          transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .track-detail[data-open="true"] .track-detail-inner { transform: translateY(0); }

        @media (min-width: ${DESKTOP_MIN}px) {
          .track-detail { --sheet-h: clamp(300px, 42vh, 460px); }
        }

        @keyframes markerDrop {
          0%   { opacity: 0; transform: scale(0) translateY(-10px); }
          60%  { opacity: 1; transform: scale(1.25) translateY(0); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
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

            {/* Vehicle list backdrop — mobile only */}
            {listOpen && !isDesktop && (
              <div
                className="fixed inset-0"
                style={{ background: 'rgba(0,0,0,0.5)', zIndex: 999 }}
                onClick={() => setListOpen(false)}
              />
            )}

            {/* ── Left list ── */}
            <div className="track-panel" data-open={listOpen ? 'true' : 'false'}>
              <div className="track-panel-inner">
                {/* Mobile-only header with close button */}
                <div
                  className="flex lg:hidden items-center justify-between px-3 py-2"
                  style={{ borderBottom: '1px solid var(--c-border2)', backgroundColor: 'var(--c-card)', paddingTop: '52px' }}
                >
                  <span className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>
                    Vehicles ({filtered.length})
                  </span>
                  <button
                    onClick={() => setListOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text3)', padding: 4, display: 'flex' }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
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
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
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
                          ref={el => {
                            if (el) rowRefs.current.set(v.id, el)
                            else rowRefs.current.delete(v.id)
                          }}
                          style={{
                            borderBottom: '1px solid var(--c-border)',
                            backgroundColor: sel ? 'var(--c-hover)' : 'transparent',
                            transition: 'background 0.15s',
                            animation: 'fadeInUp 0.35s ease both',
                            animationDelay: `${Math.min(idx * 35, 400)}ms`,
                          }}
                        >
                          <div
                            onClick={() => handleRowClick(v)}
                            style={{ padding: '11px 14px', cursor: 'pointer' }}
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
                              <svg
                                width="12" height="12" viewBox="0 0 24 24" fill="none"
                                stroke="var(--c-text3)" strokeWidth="2.6" strokeLinecap="round"
                                style={{
                                  flexShrink: 0,
                                  transform: sel ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.25s ease',
                                }}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--c-text2)', paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {v.master?.fleetNo && <span>Fleet: {v.master.fleetNo}</span>}
                              <span>Driver: {v.master?.driver?.name || 'Unassigned'}</span>
                              <span>Speed: {v.speed != null ? `${v.speed} km/h` : 'N/A'}</span>
                              <span>Last update: {fmt(v.lastTs)}</span>
                            </div>
                          </div>

                          <VehicleListCard
                            v={v}
                            open={sel}
                            onReplay={vv => selectVehicle(vv, { startReplay: true })}
                            onCenter={flyTo}
                          />
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ── Right column: map on top, detail sheet beneath ── */}
            <div className="track-split">

              <div className="track-map">
                <button
                  className="track-toggle"
                  data-hidden={toggleHidden ? 'true' : 'false'}
                  onClick={() => setListOpen(o => !o)}
                  title={listOpen ? 'Hide vehicle list' : 'Show vehicle list'}
                >
                  {listOpen ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  )}
                  {listOpen ? 'Hide list' : `Vehicles (${filtered.length})`}
                </button>

                {/* Status banner — live connection errors only. Non-blocking:
                    the map stays interactive underneath. */}
                {statusMessage && (
                  <div style={{
                    position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 890, backgroundColor: '#ef4444', color: '#fff',
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
                  // Leaflet's zoom buttons default to the top-left corner,
                  // which is exactly where the list toggle sits. Moved rather
                  // than shuffling the toggle, since the toggle belongs beside
                  // the list it opens.
                  zoomControl={false}
                >
                  <ZoomControl position="topright" />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <MapFlyTo target={flyTarget} />
                  {/* The sheet sliding up and the list collapsing both change
                      the map box; Leaflet renders grey tiles until told. */}
                  <MapAutoSize />

                  {mapped.map(v => (
                    <CarMarker
                      key={v.id}
                      position={[v.lat, v.lng]}
                      color={statusColor(v.status)}
                      heading={v.heading}
                      autoOpenKey={focusId === v.id ? flyTarget?.n ?? null : null}
                      eventHandlers={{
                        click:       () => selectVehicle(v),
                        popupopen:   () => setOpenPopupId(v.id),
                        popupclose:  () => setOpenPopupId(id => (id === v.id ? null : id)),
                      }}
                    >
                      <VehiclePopup
                        v={v}
                        name={vehicleName(v)}
                        open={openPopupId === v.id}
                        onReplay={vv => selectVehicle(vv, { startReplay: true })}
                      />
                    </CarMarker>
                  ))}

                  {replaySegments.map(seg => (
                    <Polyline
                      key={seg.key}
                      positions={seg.positions}
                      pathOptions={seg.pathOptions}
                    />
                  ))}

                  {replayPoint && <ReplayFollow point={replayPoint} />}

                  {replayPoint && (
                    <CarMarker
                      position={[replayPoint.lat, replayPoint.lng]}
                      color={statusColor(replayPoint.status)}
                      heading={replayPoint.heading}
                      zIndexOffset={1000}
                    >
                      <ReplayInfoCard point={replayPoint} fields={replayFields} />
                    </CarMarker>
                  )}
                </MapContainer>

                {replayActive && (
                  <div className="track-replay-dock">
                    <ReplayPanel
                      replay={replay}
                      vehicleName={vehicleName(vehicles.find(v => v.id === replayVehicleId))}
                    />
                  </div>
                )}
              </div>

              {/* Detail sheet — hidden entirely until a vehicle is selected. */}
              <div className="track-detail" data-open={sheetOpen ? 'true' : 'false'}>
                <div className="track-detail-inner">
                  <VehicleDetailPanel vehicle={sheetVehicle} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
