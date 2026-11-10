import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock, Radio, ExternalLink, Crosshair } from 'lucide-react'
import { fetchSharedLocation } from '../data/locationShares'
import { pointStatus } from '../utils/replay'
import { statusColor, statusLabel } from '../utils/vehicleStatus'

/**
 * Public page of a shared live location — /share/location/:token (client,
 * 2026-11-10). No sign-in: the link's token is the key. The page asks for the
 * vehicle's position every few seconds (the server says how often), draws the
 * way it has gone since the page opened, and stops once the link has expired
 * or been switched off.
 */

const fmtTime = ts => new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
/** At most this many positions kept for the trail. */
const TRAIL_MAX = 500

const carIcon = (heading, color) => L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: `<div style="width:34px;height:34px;transform:rotate(${heading ?? 0}deg)">
    <svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="13" fill="${color}" stroke="#fff" stroke-width="3"/>
    <path d="M17 8 L23 21 L17 18 L11 21 Z" fill="#fff"/></svg></div>`,
})

function ago(sec) {
  if (sec == null) return '—'
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s ago`
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`
  if (sec < 86_400) return `${Math.round(sec / 3600)} h ago`
  return `${Math.round(sec / 86_400)} days ago`
}

function left(ms) {
  if (ms <= 0) return 'expired'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} min left`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${m % 60} min left` : `${Math.floor(h / 24)} days left`
}

/** Keeps the vehicle in view while "Follow" is on. */
function Follow({ position, on, firstFix }) {
  const map = useMap()
  // The page is still laying out when the map mounts; measure again, or the
  // tiles stop short of the edges.
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(id)
  }, [map])
  useEffect(() => {
    if (!position) return
    if (firstFix.current) { map.setView(position, 15, { animate: false }); firstFix.current = false }
    else if (on) map.panTo(position, { animate: true })
  }, [map, position, on, firstFix])
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

export default function SharedLocation() {
  const { token } = useParams()
  const [state, setState] = useState({ phase: 'loading' })
  const [trail, setTrail] = useState([])
  const [follow, setFollow] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const firstFix = useRef(true)

  // Ask again every `refreshSec`; stop for good on an expired or stopped link.
  useEffect(() => {
    let live = true
    let timer = null
    const load = async () => {
      try {
        const data = await fetchSharedLocation(token)
        if (!live) return
        setState({ phase: 'ready', data })
        const p = data.position
        if (p?.lat != null && p?.lng != null) {
          setTrail(t => (t.length && t[t.length - 1][0] === p.lat && t[t.length - 1][1] === p.lng ? t : [...t, [p.lat, p.lng]].slice(-TRAIL_MAX)))
        }
        timer = setTimeout(load, (data.refreshSec ?? 15) * 1000)
      } catch (err) {
        if (!live) return
        if (err?.status === 404 || err?.status === 410) {
          setState({ phase: 'error', status: err.status, message: err.message })
          return
        }
        // A passing error (network, busy): keep what is shown and try again.
        setState(s => (s.phase === 'ready' ? { ...s, stale: true } : { phase: 'error', status: err?.status, message: err?.message, retrying: true }))
        timer = setTimeout(load, 20_000)
      }
    }
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [token])

  // The clock for "x min left" and "updated x s ago".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const data = state.phase === 'ready' ? state.data : null
  const pos = data?.position
  const hasFix = pos?.lat != null && pos?.lng != null
  const status = pos ? pointStatus(pos.ignition, pos.speed ?? 0) : 'NoData'
  const expiresMs = data ? new Date(data.expiresAt).getTime() - now : 0
  const expired = data && expiresMs <= 0

  useEffect(() => {
    document.title = data ? `${data.vehicleName} — Live location · FleetmaxX` : 'Shared live location · FleetmaxX'
  }, [data])

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--c-page)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--c-sb-bg)', color: '#fff', flexWrap: 'wrap' }}>
        <img className="ft-logo-light" src="/logo/fleetmax-logo-sea-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        <img className="ft-logo-dark" src="/logo/fleetmax-logo-aqua-white.png" alt="FleetmaxX" style={{ height: 30, width: 'auto' }} />
        {data && (
          <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Radio size={17} style={{ flexShrink: 0, marginTop: 2, color: expired ? '#fca5a5' : '#4ade80' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{data.vehicleName} <span style={{ fontWeight: 500, opacity: 0.75 }}>· Live location</span></div>
              <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 1 }}>
                Shared until {new Date(data.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {left(expiresMs)}
              </div>
            </div>
          </div>
        )}
      </header>

      {state.phase === 'loading' && <Message title="Finding the vehicle…" text="One moment." />}
      {state.phase === 'error' && (
        state.status === 410
          ? <Message title="This link has expired" text="The person who shared this location set a time limit, and it has passed. Ask them for a new link." />
          : state.status === 404
            ? <Message title="Link not found" text="This location link does not exist or sharing was stopped." />
            : <Message title="Could not load the location" text={state.retrying ? 'Trying again shortly…' : state.message || 'Try again in a moment.'} />
      )}

      {data && (
        <>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <MapContainer center={hasFix ? [pos.lat, pos.lng] : [24.45, 54.37]} zoom={hasFix ? 15 : 9} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#0a7e9c', weight: 4, opacity: 0.7 }} />}
              {hasFix && <Marker position={[pos.lat, pos.lng]} icon={carIcon(pos.heading, statusColor(status))} zIndexOffset={1000} />}
              <Follow position={hasFix ? [pos.lat, pos.lng] : null} on={follow} firstFix={firstFix} />
            </MapContainer>
            <button
              type="button"
              onClick={() => setFollow(f => !f)}
              aria-pressed={follow}
              title={follow ? 'The map follows the vehicle' : 'Follow the vehicle'}
              style={{
                position: 'absolute', right: 12, top: 12, zIndex: 500, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 11px', borderRadius: 9, border: '1px solid var(--c-border)', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: follow ? 'var(--ft-accent)' : 'var(--c-card)', color: follow ? '#fff' : 'var(--c-text1)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              <Crosshair size={14} /> Follow
            </button>
            {expired && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 600, background: 'rgba(5,20,28,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Message title="This link has expired" text="Sharing has ended. Ask for a new link to keep following the vehicle." />
              </div>
            )}
          </div>

          <footer style={{ padding: '9px 14px', borderTop: '1px solid var(--c-border)', background: 'var(--c-card)', display: 'flex', alignItems: 'center', gap: '6px 16px', flexWrap: 'wrap', fontSize: 12, color: 'var(--c-text3)' }}>
            <span style={{ color: statusColor(status), fontWeight: 700 }}>● {statusLabel(status)}</span>
            <span>{pos?.speed != null ? `${Math.round(pos.speed)} km/h` : '—'}</span>
            <span>Last position {pos?.ts ? `${ago(now / 1000 - pos.ts)} (${fmtTime(pos.ts)})` : 'not known yet'}</span>
            {state.stale && <span style={{ color: '#f97316' }}>Connection lost — retrying</span>}
            {hasFix && (
              <a href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer"
                style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: 'var(--ft-accent)', textDecoration: 'none' }}>
                Open in Google Maps <ExternalLink size={12} />
              </a>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
