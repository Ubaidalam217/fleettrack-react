import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock, Route } from 'lucide-react'
import { fetchSharedReplay } from '../data/replayShares'
import { buildSegments, pointStatus } from '../utils/replay'
import { statusColor, statusLabel } from '../utils/vehicleStatus'

/**
 * Public page of a shared replay — /share/replay/:token (client, 2026-11-09).
 * No sign-in: the link's token is the key, and the server refuses it once it
 * has expired or been switched off.
 */

const SPEEDS = [1, 5, 10, 25, 50]
const TICK_MS = 200

const fmt = ts => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const dot = (color, size = 14) => L.divIcon({
  className: '',
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
})

const carIcon = (heading, color) => L.divIcon({
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  html: `<div style="width:30px;height:30px;transform:rotate(${heading ?? 0}deg)">
    <svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="11" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <path d="M15 7 L20 18 L15 15.5 L10 18 Z" fill="#fff"/></svg></div>`,
})

function FitRoute({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [30, 30] })
  }, [map, points])
  return null
}

function Message({ title, text }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center', background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '28px 24px' }}>
        <Clock size={30} style={{ color: 'var(--c-text3)' }} />
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text1)', marginTop: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--c-text3)', marginTop: 6, lineHeight: 1.6 }}>{text}</div>
      </div>
    </div>
  )
}

export default function SharedReplay() {
  const { token } = useParams()

  const [state, setState] = useState({ phase: 'loading' })
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const timer = useRef(null)

  useEffect(() => {
    let live = true
    fetchSharedReplay(token)
      .then(data => { if (live) setState({ phase: 'ready', data }) })
      .catch(err => { if (live) setState({ phase: 'error', status: err?.status, message: err?.message }) })
    return () => { live = false }
  }, [token])

  const data = state.phase === 'ready' ? state.data : null
  const points = useMemo(() => (data?.points ?? []).map(([ts, lat, lng, spd, heading, ign]) => {
    const ignition = ign == null ? null : ign === 1
    return { ts, lat, lng, speed: spd ?? 0, heading, ignition, status: pointStatus(ignition, spd ?? 0) }
  }), [data])
  const segments = useMemo(() => buildSegments(points).map(s => ({ ...s, pathOptions: { color: s.color, weight: 4, opacity: 0.85 } })), [points])

  useEffect(() => {
    document.title = data ? `${data.vehicleName} — Replay · FleetmaxX` : 'Shared replay · FleetmaxX'
  }, [data])

  // Playback: `speed` points per tick, stopping at the end.
  useEffect(() => {
    clearInterval(timer.current)
    if (!playing || !points.length) return
    timer.current = setInterval(() => {
      setIndex(i => {
        const next = Math.min(points.length - 1, i + speed)
        if (next === points.length - 1) setPlaying(false)
        return next
      })
    }, TICK_MS)
    return () => clearInterval(timer.current)
  }, [playing, speed, points.length])

  const current = points[index] ?? null
  const togglePlay = () => {
    if (!playing && index >= points.length - 1) setIndex(0)
    setPlaying(p => !p)
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--c-page)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: 'var(--c-sb-bg)', color: '#fff', flexWrap: 'wrap',
      }}>
        <img className="ft-logo-light" src="/logo/fleetmax-logo-sea-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        <img className="ft-logo-dark" src="/logo/fleetmax-logo-aqua-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        {data && (
          <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Route size={17} style={{ flexShrink: 0, marginTop: 2, color: 'var(--c-sb-active-text)' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{data.vehicleName} <span style={{ fontWeight: 500, opacity: 0.75 }}>· Replay</span></div>
              <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 1 }}>
                {fmt(data.fromTs)} – {fmt(data.toTs)}
                {' · link valid until '}{new Date(data.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
          </div>
        )}
      </header>

      {state.phase === 'loading' && <Message title="Loading the replay…" text="One moment." />}
      {state.phase === 'error' && (
        state.status === 410
          ? <Message title="This link has expired" text="The person who shared this replay set a time limit, and it has passed. Ask them for a new link." />
          : state.status === 404
            ? <Message title="Link not found" text="This replay link does not exist or was switched off." />
            : <Message title="Could not load the replay" text={state.message || 'Try again in a moment.'} />
      )}

      {data && (
        <>
          <div style={{ flex: 1, minHeight: 0 }}>
            <MapContainer center={[points[0]?.lat ?? 24.45, points[0]?.lng ?? 54.37]} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitRoute points={points} />
              {segments.map(s => <Polyline key={s.key} positions={s.positions} pathOptions={s.pathOptions} />)}
              {points.length > 0 && <Marker position={[points[0].lat, points[0].lng]} icon={dot('#10b981')} title="Start" />}
              {points.length > 1 && <Marker position={[points[points.length - 1].lat, points[points.length - 1].lng]} icon={dot('#ef4444')} title="End" />}
              {current && <Marker position={[current.lat, current.lng]} icon={carIcon(current.heading, statusColor(current.status))} zIndexOffset={1000} />}
            </MapContainer>
          </div>

          <footer style={{ padding: '9px 14px', borderTop: '1px solid var(--c-border)', background: 'var(--c-card)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'var(--ft-accent)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                {playing
                  ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" /></svg>
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20" /></svg>}
              </button>
              <input
                type="range" min={0} max={Math.max(0, points.length - 1)} value={index}
                onChange={e => { setPlaying(false); setIndex(Number(e.target.value)) }}
                style={{ flex: 1, minWidth: 60, accentColor: 'var(--ft-accent)' }}
                aria-label="Position in the replay"
              />
              <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--c-border)', flexShrink: 0 }}>
                {SPEEDS.map(s => (
                  <button key={s} type="button" onClick={() => setSpeed(s)} style={{
                    padding: '4px 7px', border: 0, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                    background: speed === s ? 'var(--ft-accent)' : 'var(--c-input)', color: speed === s ? '#fff' : 'var(--c-text3)',
                  }}>{s}x</button>
                ))}
              </div>
            </div>
            {current && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 14px', fontSize: 11.5, color: 'var(--c-text3)' }}>
                <span style={{ color: statusColor(current.status), fontWeight: 700 }}>● {statusLabel(current.status)}</span>
                <span>{current.speed} km/h</span>
                <span>{fmt(current.ts)}</span>
                <span>{index + 1}/{points.length}</span>
              </div>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
