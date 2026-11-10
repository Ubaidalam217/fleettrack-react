import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, ExternalLink, Route, Loader2 } from 'lucide-react'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { haversineMeters } from '../../utils/distance'
import { spanWindow, violationSpan } from '../../utils/violationSpan'
import { alertTypeLabel } from '../../data/settings'

/**
 * One alert event on FleetmaxX's map, from where the violation began to where
 * it ended (client, 2026-11-10: "upon clicking on any event it will plot the
 * event / violation on the map from start to end").
 *
 * The event carries only the moment it was raised, so the vehicle's track
 * around it is read from the tracker (utils/replay.js) and the violation's
 * span picked out of it (utils/violationSpan.js): the violation in red, a
 * little of the drive before and after in grey, and Start / End pins.
 *
 * event: { deviceId, vehicle, type, ts, value?, message?, severity?, lat?, lng? }
 */

const FIELDS = 'timestamp,position.speed,position.latitude,position.longitude,engine.ignition.status'
/** Grey track shown before the start and after the end. */
const CONTEXT_SEC = 180

const pin = (fill, label) => L.divIcon({
  className: '',
  iconSize: [30, 38],
  iconAnchor: [15, 38],
  html: `<svg width="30" height="38" viewBox="0 0 30 38" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
    <path d="M15 37s-12-10.6-12-21a12 12 0 0 1 24 0c0 10.4-12 21-12 21z" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <text x="15" y="20" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="800" fill="#fff">${label}</text></svg>`,
})
const START_ICON = pin('#16a34a', 'S')
const END_ICON = pin('#dc2626', 'E')
const POINT_ICON = pin('#dc2626', '!')

const pos = m => {
  const lat = m['position.latitude'], lng = m['position.longitude']
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? [lat, lng] : null
}
const fmt = ts => new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
function hms(sec) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    // The dialog may still be settling when the map mounts: measure again first,
    // or the bounds are fitted to the wrong size and the End pin falls outside.
    // Not animated: a fit asked for while the first view is still zooming in is
    // otherwise dropped by Leaflet, and the map stays on the start alone.
    const id = setTimeout(() => {
      map.invalidateSize()
      if (points.length === 1) map.setView(points[0], 16, { animate: false })
      else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17, animate: false })
    }, 60)
    return () => clearTimeout(id)
  }, [map, points])
  return null
}

function Stat({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: 'var(--c-text3)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--c-text1)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

export default function EventTrackModal({ event, onClose }) {
  const [state, setState] = useState({ loading: false, messages: [], error: null })

  useEffect(() => {
    if (!event) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, onClose])

  useEffect(() => {
    if (!event?.deviceId || !event.ts) return
    const controller = new AbortController()
    const [before, after] = spanWindow(event.type)
    const to = Math.min(event.ts + after, Math.floor(Date.now() / 1000))
    setState({ loading: true, messages: [], error: null })
    fetchFleetMessages([event.deviceId], event.ts - before, to, { fields: FIELDS, signal: controller.signal })
      .then(byDevice => {
        const messages = (byDevice.get(event.deviceId)?.messages ?? []).slice().sort((a, b) => a.timestamp - b.timestamp)
        setState({ loading: false, messages, error: null })
      })
      .catch(err => { if (!isAbortError(err)) setState({ loading: false, messages: [], error: err.message || String(err) }) })
    return () => controller.abort()
  }, [event])

  const view = useMemo(() => {
    if (!event) return null
    const span = violationSpan(event, state.messages)
    const inSpan = state.messages.filter(m => m.timestamp >= span.startTs && m.timestamp <= span.endTs)
    const around = state.messages.filter(m => m.timestamp >= span.startTs - CONTEXT_SEC && m.timestamp <= span.endTs + CONTEXT_SEC)
    const red = inSpan.map(pos).filter(Boolean)
    const grey = around.map(pos).filter(Boolean)
    const own = Number.isFinite(event.lat) && Number.isFinite(event.lng) ? [event.lat, event.lng] : null
    let km = 0
    for (let i = 1; i < red.length; i++) km += haversineMeters(red[i - 1][0], red[i - 1][1], red[i][0], red[i][1]) / 1000
    const speeds = inSpan.map(m => m['position.speed']).filter(Number.isFinite)
    return {
      span, red, grey,
      point: red.length ? null : (own ?? grey[0] ?? null),
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      km,
      fit: red.length > 1 ? red : grey.length ? grey : own ? [own] : [],
    }
  }, [event, state.messages])

  if (!event || !view) return null
  const { span, red, grey, point } = view
  const isSpan = span.endTs > span.startTs
  const center = view.fit[0] ?? [24.45, 54.38]
  const g = red[0] ?? point

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Violation on the map"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(960px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'var(--c-card)', border: '1px solid var(--c-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>
            <Route size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)' }}>
              {event.vehicle} · {alertTypeLabel(event.type)}{event.severity ? ` · ${event.severity}` : ''}
            </div>
            {event.message && <div style={{ fontSize: 12.5, color: 'var(--c-text2)', marginTop: 3, wordBreak: 'break-word' }}>{event.message}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <Stat label="Started" value={fmt(span.startTs)} />
          <Stat label="Ended" value={isSpan ? fmt(span.endTs) : '—'} />
          <Stat label="Lasted" value={isSpan ? hms(span.endTs - span.startTs) : 'A moment'} />
          <Stat label="Top speed" value={view.maxSpeed !== null ? `${Math.round(view.maxSpeed)} km/h` : '—'} />
          <Stat label="Distance" value={isSpan ? `${view.km.toFixed(2)} km` : '—'} />
        </div>

        <div style={{ height: 'min(480px, 58vh)', position: 'relative' }}>
          <MapContainer key={`${event.deviceId}-${event.ts}`} center={center} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {grey.length > 1 && <Polyline positions={grey} pathOptions={{ color: '#64748b', weight: 4, opacity: 0.55 }} />}
            {red.length > 1 && <Polyline positions={red} pathOptions={{ color: '#dc2626', weight: 6, opacity: 0.95 }} />}
            {red.length > 1 && <Marker position={red[0]} icon={START_ICON} title="Start" />}
            {red.length > 1 && <Marker position={red[red.length - 1]} icon={END_ICON} title="End" />}
            {red.length <= 1 && (red[0] ?? point) && <Marker position={red[0] ?? point} icon={POINT_ICON} />}
            <FitBounds points={view.fit} />
          </MapContainer>
          {(state.loading || state.error || (!state.loading && !grey.length && !point)) && (
            <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 500, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 9, background: 'var(--c-card)', border: '1px solid var(--c-border)', fontSize: 12.5, color: state.error ? '#ef4444' : 'var(--c-text2)', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
              {state.loading && <Loader2 size={14} className="animate-spin" />}
              {state.loading ? 'Loading the track…' : state.error ? state.error : 'The tracker sent no position around this time.'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--c-text3)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 4, borderRadius: 2, background: '#dc2626' }} />Violation</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 4, borderRadius: 2, background: '#64748b', opacity: 0.6 }} />Before and after</span>
          </span>
          {g && (
            <a href={`https://www.google.com/maps?q=${g[0]},${g[1]}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--c-text2)', textDecoration: 'none' }}>
              Open in Google Maps <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
