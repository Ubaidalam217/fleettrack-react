import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, ExternalLink, Route, Loader2 } from 'lucide-react'
import { fetchFleetMessages, isAbortError } from '../../utils/replay'
import { haversineMeters } from '../../utils/distance'
import { spanWindow } from '../../utils/violationSpan'
import { eventSpan, messageAt, maxSpeedBetween, PEAK_SPEED_TYPES } from '../../utils/violationEpisodes'
import { isOneTimeViolation } from '../../utils/oilGasViolations'
import { alertTypeLabel } from '../../data/settings'

/**
 * One alert event on FleetmaxX's map: the violation itself, from where it
 * began to where it ended, not the trip around it (client, 2026-11-10 and
 * 2026-11-13: "Violation Location report not plot the full trip on map").
 *
 * The span is the report's own (From / To), else the end the engine stored,
 * else read from the vehicle's track by the reports' rule
 * (utils/violationEpisodes.js eventSpan), so the dialog's duration is the
 * report's Duration. The violation is drawn in red with Start / End pins and
 * only a short grey lead-in and lead-out.
 *
 * One-time events — SOS, harsh braking / acceleration (utils/oilGasViolations.js)
 * — are one point with their time and speed: no route, no duration.
 *
 * event: { deviceId, vehicle, type, ts, name?, span?: { startTs, endTs, speed? },
 *   endedAt?, durationSec?, peakValue?, value?, message?, severity?, lat?, lng? }
 */

const FIELDS = 'timestamp,position.speed,position.latitude,position.longitude,engine.ignition.status'
/** Grey track shown before the start and after the end. */
const CONTEXT_SEC = 30
/** How far past a known span the track is read; also the farthest a lone lead-in / out reading may be. */
const PAD_SEC = 120

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
const fmtTime = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const sameDay = (a, b) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString()
const kmh = v => (Number.isFinite(v) ? `${Math.round(v)} km/h` : '— km/h')
/** "00:05:37", as the reports' Duration column. */
function hms(sec) {
  const s = Math.max(0, Math.round(sec))
  const two = n => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
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

/** The grey lead-in (side 'in') or lead-out ('out') of a span: CONTEXT_SEC of track, else the one reading next to it. */
function lead(messages, startTs, endTs, side) {
  const near = side === 'in'
    ? messages.filter(m => m.timestamp < startTs && m.timestamp >= startTs - CONTEXT_SEC)
    : messages.filter(m => m.timestamp > endTs && m.timestamp <= endTs + CONTEXT_SEC)
  if (near.length) return near
  const next = side === 'in' ? messages.filter(m => m.timestamp < startTs).at(-1) : messages.find(m => m.timestamp > endTs)
  return next && Math.abs((side === 'in' ? startTs : endTs) - next.timestamp) <= PAD_SEC ? [next] : []
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
    // A span already known (the report's, or the engine's stored end) is read
    // from start to end; a one-time event only around its moment; anything
    // else over the window its span is looked for in.
    const known = eventSpan(event)
    let from, to
    if (isOneTimeViolation(event.type)) [from, to] = [(known?.startTs ?? event.ts) - PAD_SEC, (known?.startTs ?? event.ts) + PAD_SEC]
    else if (known?.known) [from, to] = [known.startTs - PAD_SEC, known.endTs + PAD_SEC]
    else {
      const [before, after] = spanWindow(event.type)
      ;[from, to] = [event.ts - before, event.ts + after]
    }
    to = Math.min(to, Math.floor(Date.now() / 1000))
    setState({ loading: true, messages: [], error: null })
    fetchFleetMessages([event.deviceId], from, to, { fields: FIELDS, signal: controller.signal })
      .then(byDevice => {
        const messages = (byDevice.get(event.deviceId)?.messages ?? []).slice().sort((a, b) => a.timestamp - b.timestamp)
        setState({ loading: false, messages, error: null })
      })
      .catch(err => { if (!isAbortError(err)) setState({ loading: false, messages: [], error: err.message || String(err) }) })
    return () => controller.abort()
  }, [event])

  const view = useMemo(() => {
    if (!event) return null
    const messages = state.messages
    const span = eventSpan(event, messages) ?? { startTs: event.ts, endTs: event.ts, speed: null }
    const own = Number.isFinite(event.lat) && Number.isFinite(event.lng) ? [event.lat, event.lng] : null

    if (isOneTimeViolation(event.type)) {
      // Where and how fast at that moment: the report's From, its speed.
      const m = messageAt(messages, span.startTs)
      const at = own ?? (m ? pos(m) : null)
      const speed = span.speed ?? (Number.isFinite(m?.['position.speed']) ? m['position.speed'] : null)
      return { oneTime: true, startTs: span.startTs, endTs: span.startTs, red: [], leadIn: [], leadOut: [], point: at, speed, km: 0, fit: at ? [at] : [] }
    }

    const { startTs, endTs } = span
    const red = messages.filter(m => m.timestamp >= startTs && m.timestamp <= endTs).map(pos).filter(Boolean)
    const leadIn = red.length ? [...lead(messages, startTs, endTs, 'in').map(pos).filter(Boolean), red[0]] : []
    const leadOut = red.length ? [red[red.length - 1], ...lead(messages, startTs, endTs, 'out').map(pos).filter(Boolean)] : []
    let km = 0
    for (let i = 1; i < red.length; i++) km += haversineMeters(red[i - 1][0], red[i - 1][1], red[i][0], red[i][1]) / 1000
    // The over-speed types' Speed column is the episode's worst; the others' the worst on the track.
    const speed = PEAK_SPEED_TYPES.has(event.type) && span.speed !== null
      ? span.speed
      : maxSpeedBetween(messages, startTs, endTs) ?? span.speed
    return {
      oneTime: false, startTs, endTs, red, leadIn, leadOut,
      point: red.length > 1 ? null : (red[0] ?? own ?? null),
      speed, km,
      fit: red.length > 1 ? [...leadIn, ...red, ...leadOut] : red.length ? [red[0]] : own ? [own] : [],
    }
  }, [event, state.messages])

  if (!event || !view) return null
  const { red, leadIn, leadOut, point, oneTime, startTs, endTs } = view
  const center = view.fit[0] ?? [24.45, 54.38]
  const g = red[0] ?? point
  // "Event · From → To · Duration · Max speed"; a one-time event, or one with
  // no span found (a status alert, say): "Event · Time · Speed".
  const instant = oneTime || endTs <= startTs
  const name = event.name || alertTypeLabel(event.type)
  const headline = instant
    ? [name, fmt(startTs), kmh(view.speed)]
    : [name, `${fmt(startTs)} → ${sameDay(startTs, endTs) ? fmtTime(endTs) : fmt(endTs)}`, hms(endTs - startTs), `Max ${kmh(view.speed)}`]
  const subline = [event.vehicle, oneTime ? 'One-time event' : red.length > 1 ? `${view.km.toFixed(2)} km` : null, event.severity].filter(Boolean)

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
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-text1)', wordBreak: 'break-word' }}>
              {headline.join(' · ')}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text2)', marginTop: 3 }}>{subline.join(' · ')}</div>
            {event.message && <div style={{ fontSize: 12, color: 'var(--c-text3)', marginTop: 2, wordBreak: 'break-word' }}>{event.message}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" title="Close (Esc)"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ height: 'min(480px, 62vh)', position: 'relative' }}>
          <MapContainer key={`${event.deviceId}-${event.ts}`} center={center} zoom={15} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {red.length > 1 && leadIn.length > 1 && <Polyline positions={leadIn} pathOptions={{ color: '#64748b', weight: 4, opacity: 0.55, dashArray: '6 6' }} />}
            {red.length > 1 && leadOut.length > 1 && <Polyline positions={leadOut} pathOptions={{ color: '#64748b', weight: 4, opacity: 0.55, dashArray: '6 6' }} />}
            {red.length > 1 && <Polyline positions={red} pathOptions={{ color: '#dc2626', weight: 6, opacity: 0.95 }} />}
            {red.length > 1 && <Marker position={red[0]} icon={START_ICON} title={`Start · ${fmt(startTs)}`} />}
            {red.length > 1 && <Marker position={red[red.length - 1]} icon={END_ICON} title={`End · ${fmt(endTs)}`} />}
            {point && <Marker position={point} icon={POINT_ICON} title={`${fmt(startTs)} · ${kmh(view.speed)}`} />}
            <FitBounds points={view.fit} />
          </MapContainer>
          {(state.loading || state.error || (!state.loading && red.length < 2 && !point)) && (
            <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 500, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 9, background: 'var(--c-card)', border: '1px solid var(--c-border)', fontSize: 12.5, color: state.error ? '#ef4444' : 'var(--c-text2)', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}>
              {state.loading && <Loader2 size={14} className="animate-spin" />}
              {state.loading ? 'Loading the track…' : state.error ? state.error : 'The tracker sent no position around this time.'}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
          {instant ? (
            <span style={{ fontSize: 12, color: 'var(--c-text3)' }}>{oneTime ? 'A one-time event: where' : 'Where'} it happened, its time and speed.</span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--c-text3)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 4, borderRadius: 2, background: '#dc2626' }} />Violation, start to end</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 0, borderTop: '3px dashed #64748b', opacity: 0.7 }} />Just before and after</span>
            </span>
          )}
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
