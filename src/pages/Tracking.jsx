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
import VehicleActionMenu from '../components/tracking/VehicleActionMenu'
import EditAssetModal from '../components/tracking/EditAssetModal'
import NearestAssetsModal from '../components/tracking/NearestAssetsModal'
import ConfirmDialog from '../components/tracking/ConfirmDialog'
import ToastStack from '../components/tracking/Toasts'
import { useToasts } from '../hooks/useToasts'
import { useFlespiMQTT } from '../hooks/useFlespiMQTT'
import {
  ALL, FILTERS, statusColor, statusLabel,
  filterLabel, filterColor, countByFilter, matchesFilter,
} from '../utils/vehicleStatus'
import { fetchDeviceTrack, buildSegments } from '../utils/replay'
import { MAX_TRACES, nextTraceColor, appendPoint, createTrace } from '../utils/traces'
import { ACTIONS, DELIVERED, sendDeviceAction, logCommand } from '../services/deviceCommands'

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

// Follow: re-centre on the followed vehicle every time its position changes,
// and drop the follow the moment the user takes the map back.
//
// `dragstart` is the signal for "manually pans" because Leaflet only fires it
// for a real pointer drag — map.setView() below never triggers it, so the
// follow cannot cancel itself. Keyboard panning fires it too. Programmatic
// zoom would muddy `zoomstart`, which is why that one is left alone.
function FollowVehicle({ target, onManualPan }) {
  const map = useMap()

  useEffect(() => {
    if (!target) return
    map.setView([target.lat, target.lng], map.getZoom(), { animate: true, duration: 0.6 })
  }, [target?.lat, target?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!target) return
    map.on('dragstart', onManualPan)
    return () => { map.off('dragstart', onManualPan) }
  }, [map, target, onManualPan])

  return null
}

// Menu glyphs. Inline rather than lucide-react imports to match the rest of
// this page, which draws its own icons.
const MenuIcon = {
  follow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 1.5v2.5M12 20v2.5M1.5 12h2.5M20 12h2.5" />
    </svg>
  ),
  trace: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18c4 0 3-9 7-9s3 6 7 6 4-4 4-4" />
    </svg>
  ),
  replay: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  poll: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5a9 9 0 0114 0" />
      <path d="M8.5 16a4.5 4.5 0 017 0" />
      <circle cx="12" cy="19.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  nearest: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-5.7 7-11a7 7 0 10-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
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
  const { vehicles: liveVehicles, isConnected, error } = useFlespiMQTT()

  // Edit Asset writes to Flespi and gets the saved record back, but the MQTT
  // store is module-level and only reads device metadata once at startup.
  // Rather than reach into the live-data hook, the saved master is layered on
  // top here — the list updates immediately, and a reload picks the same values
  // up from Flespi anyway.
  const [masterOverrides, setMasterOverrides] = useState({})
  const vehicles = useMemo(() => (
    Object.keys(masterOverrides).length === 0
      ? liveVehicles
      : liveVehicles.map(v => (masterOverrides[v.id] ? { ...v, master: masterOverrides[v.id] } : v))
  ), [liveVehicles, masterOverrides])

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts()

  // ── Menu-driven state ──
  // Follow is single-slot by design: two vehicles cannot both hold the centre.
  const [followId, setFollowId] = useState(null)
  // { [vehicleId]: { color, points: [[lat,lng]…], lastTs } }
  const [traces, setTraces]     = useState({})
  const [editVehicleId, setEditVehicleId]       = useState(null)
  const [nearestVehicleId, setNearestVehicleId] = useState(null)
  const [pendingCommand, setPendingCommand]     = useState(null) // { vehicleId, actionKey }
  const [commandBusy, setCommandBusy]           = useState(false)

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

  // ── Trace growth ──
  // Runs on every vehicles change; appendPoint() is what keeps that cheap,
  // rejecting both already-seen messages and fixes that did not move. The
  // identity check on the rebuilt object means a push carrying nothing new for
  // any traced vehicle leaves state untouched and costs no re-render.
  useEffect(() => {
    setTraces(prev => {
      const ids = Object.keys(prev)
      if (ids.length === 0) return prev

      let changed = false
      const next = {}
      for (const id of ids) {
        const v       = liveVehicles.find(x => String(x.id) === id)
        const updated = v ? appendPoint(prev[id], v.lat, v.lng, v.lastTs) : prev[id]
        if (updated !== prev[id]) changed = true
        next[id] = updated
      }
      return changed ? next : prev
    })
  }, [liveVehicles])

  const isFollowing = id => followId === id
  const isTracing   = id => Object.prototype.hasOwnProperty.call(traces, id)

  // Both toggles decide against current state and then set it, rather than
  // deciding inside the updater. Updaters have to stay pure — StrictMode
  // double-invokes them in development, which would fire every toast twice.
  const toggleFollow = useCallback((v) => {
    if (followId === v.id) {
      setFollowId(null)
      pushToast(`Stopped following ${vehicleName(v)}`, { tone: 'info' })
      return
    }
    if (v.lat == null || v.lng == null) {
      pushToast(`${vehicleName(v)} has no position to follow yet`, { tone: 'error' })
      return
    }
    setFollowId(v.id)
    pushToast(`Following ${vehicleName(v)}`, { tone: 'success' })
  }, [followId, pushToast])

  const toggleTrace = useCallback((v) => {
    const key = String(v.id)

    if (traces[key]) {
      setTraces(({ [key]: _removed, ...rest }) => rest)
      pushToast(`Trace off — ${vehicleName(v)}`, { tone: 'info' })
      return
    }
    if (Object.keys(traces).length >= MAX_TRACES) {
      pushToast(
        `Trace limit reached (${MAX_TRACES}). Turn one off before starting another.`,
        { tone: 'error' }
      )
      return
    }
    setTraces(prev => ({ ...prev, [key]: createTrace(nextTraceColor(prev), v) }))
    pushToast(`Tracing ${vehicleName(v)}`, { tone: 'success' })
  }, [traces, pushToast])

  // Deselecting a vehicle drops its trace — the spec ties the trace's life to
  // the selection, and a trace with no visible owner is just clutter.
  useEffect(() => {
    if (focusId != null) return
    setTraces(prev => (Object.keys(prev).length ? {} : prev))
  }, [focusId])

  const runCommand = useCallback(async () => {
    if (!pendingCommand) return
    const { vehicleId, actionKey } = pendingCommand
    const v      = vehicles.find(x => x.id === vehicleId)
    const action = ACTIONS[actionKey]
    const name   = vehicleName(v)

    setCommandBusy(true)
    try {
      const { status } = await sendDeviceAction(vehicleId, actionKey)
      const delivered  = status === DELIVERED

      logCommand({
        deviceId: vehicleId,
        vehicle:  name,
        action:   action.label,
        outcome:  status,
      })

      // Queued is amber, never green: Flespi accepted it, but the vehicle has
      // not seen it and will not until the unit next connects.
      if (delivered) {
        pushToast(`${action.label} delivered — ${name} responded`, { tone: 'success' })
      } else {
        pushToast(`${action.label} sent, device offline (queued) — ${name}`, { tone: 'pending', duration: 6500 })
      }
      setPendingCommand(null)
    } catch (err) {
      logCommand({
        deviceId: vehicleId,
        vehicle:  name,
        action:   action.label,
        outcome:  'failed',
        detail:   err.message,
      })
      pushToast(`${action.label} failed — ${err.message}`, { tone: 'error', duration: 7000 })
      setPendingCommand(null)
    } finally {
      setCommandBusy(false)
    }
  }, [pendingCommand, vehicles, pushToast])

  const handleSaved = useCallback((deviceId, master) => {
    setMasterOverrides(prev => ({ ...prev, [deviceId]: master }))
    setEditVehicleId(null)
    pushToast('Vehicle saved', { tone: 'success' })
  }, [pushToast])

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

  // Follow yields to Replay: while a track is loaded the map is already being
  // driven by ReplayFollow, and two things panning it would fight each other.
  const followed = followId != null ? vehicles.find(v => v.id === followId) : null
  const followTarget = (followed && followed.lat != null && followed.lng != null && !replayShowing)
    ? { lat: followed.lat, lng: followed.lng }
    : null

  // Only ever reached while FollowVehicle is mounted, i.e. while following.
  const handleManualPan = useCallback(() => {
    setFollowId(null)
    pushToast('Follow off — map moved manually', { tone: 'info' })
  }, [pushToast])

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

  // Every entry here does something on click. Immobilise, Force Override,
  // Digital Output, High Update and Find Nearest > Operators are absent rather
  // than greyed out: the probe found either no hardware behind them or no data
  // to show, and a disabled row that never enables is still dead UI.
  const menuItemsFor = (v) => [
    {
      key: 'follow',
      label: 'Follow',
      icon: MenuIcon.follow,
      toggle: true,
      active: isFollowing(v.id),
      onSelect: () => toggleFollow(v),
    },
    {
      key: 'trace',
      label: 'Trace',
      icon: MenuIcon.trace,
      toggle: true,
      active: isTracing(v.id),
      onSelect: () => toggleTrace(v),
    },
    {
      key: 'replay',
      label: 'Replay',
      icon: MenuIcon.replay,
      onSelect: () => selectVehicle(v, { startReplay: true }),
    },
    { type: 'separator' },
    {
      key: 'edit',
      label: 'Edit Asset',
      icon: MenuIcon.edit,
      onSelect: () => setEditVehicleId(v.id),
    },
    {
      key: 'poll',
      label: 'Poll',
      icon: MenuIcon.poll,
      onSelect: () => setPendingCommand({ vehicleId: v.id, actionKey: 'poll' }),
    },
    {
      key: 'nearest',
      label: 'Find Nearest Assets',
      icon: MenuIcon.nearest,
      onSelect: () => setNearestVehicleId(v.id),
    },
  ]

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

  // Resolved from the live list rather than captured at open time, so an
  // in-flight telemetry push cannot leave a modal showing a stale vehicle.
  const editVehicle    = editVehicleId    != null ? vehicles.find(v => v.id === editVehicleId)    ?? null : null
  const nearestVehicle = nearestVehicleId != null ? vehicles.find(v => v.id === nearestVehicleId) ?? null : null
  const commandVehicle = pendingCommand   != null ? vehicles.find(v => v.id === pendingCommand.vehicleId) ?? null : null
  const commandAction  = pendingCommand   != null ? ACTIONS[pendingCommand.actionKey] : null

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
                        borderBottom: activeTab === key ? '2px solid var(--ft-accent)' : '2px solid transparent',
                        color: activeTab === key ? 'var(--ft-accent)' : 'var(--c-text3)',
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

                              <VehicleActionMenu
                                items={menuItemsFor(v)}
                                label={`Actions for ${vehicleName(v)}`}
                              />
                            </div>

                            {/* Active-mode badges. These are the card's
                                indicator that Follow/Trace are running, so they
                                sit in the always-visible row rather than inside
                                the collapsible card. */}
                            {(isFollowing(v.id) || isTracing(v.id)) && (
                              <div style={{ display: 'flex', gap: 5, paddingLeft: 17, marginBottom: 4 }}>
                                {isFollowing(v.id) && (
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3.5,
                                    fontSize: 9, fontWeight: 800, letterSpacing: '0.03em',
                                    padding: '2px 6px', borderRadius: 4,
                                    background: 'color-mix(in srgb, var(--ft-accent) 14%, transparent)', color: 'var(--ft-accent)',
                                  }}>
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                                      <circle cx="12" cy="12" r="4" />
                                      <circle cx="12" cy="12" r="10" />
                                    </svg>
                                    FOLLOWING
                                  </span>
                                )}
                                {isTracing(v.id) && (
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3.5,
                                    fontSize: 9, fontWeight: 800, letterSpacing: '0.03em',
                                    padding: '2px 6px', borderRadius: 4,
                                    background: `${traces[String(v.id)].color}22`,
                                    color: traces[String(v.id)].color,
                                  }}>
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true">
                                      <path d="M3 18c4 0 3-9 7-9s3 6 7 6 4-4 4-4" />
                                    </svg>
                                    TRACING
                                  </span>
                                )}
                              </div>
                            )}
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

                  {/* Live traces. Drawn under the replay track, which is the
                      one the user is actively scrubbing. A single point is not
                      a line, so those are skipped until a second fix lands. */}
                  {Object.entries(traces).map(([id, t]) => (
                    t.points.length > 1 && (
                      <Polyline
                        key={`trace-${id}`}
                        positions={t.points}
                        pathOptions={{ color: t.color, weight: 3.5, opacity: 0.9 }}
                      />
                    )
                  ))}

                  {followTarget && (
                    <FollowVehicle target={followTarget} onManualPan={handleManualPan} />
                  )}

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

      {editVehicle && (
        <EditAssetModal
          vehicle={editVehicle}
          onClose={() => setEditVehicleId(null)}
          onSaved={handleSaved}
          onError={msg => pushToast(msg, { tone: 'error', duration: 7000 })}
        />
      )}

      {nearestVehicle && (
        <NearestAssetsModal
          origin={nearestVehicle}
          vehicles={vehicles}
          onClose={() => setNearestVehicleId(null)}
          onSelect={selectVehicle}
        />
      )}

      {pendingCommand && commandAction && (
        <ConfirmDialog
          title={`${commandAction.label} ${vehicleName(commandVehicle)}?`}
          body={commandAction.detail}
          note="Sent to the device over Flespi. If the unit is offline the command is queued until it next connects — you will be told which happened."
          confirmLabel={`Send ${commandAction.label}`}
          busy={commandBusy}
          onConfirm={runCommand}
          onClose={() => !commandBusy && setPendingCommand(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
