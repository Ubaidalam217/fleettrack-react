import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, Pane, Polyline, Popup, Tooltip, useMap } from 'react-leaflet'
import { overLimitRuns, indexAtTime } from '../../utils/replayTimeline'
import { INSTANT_TYPES, SPEED_TYPES, showsSpeed } from '../../utils/replayEvents'
import { fmtHms } from '../../utils/replayTrips'
import { useAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'

// Popup and START/END label look. Themed with the app's tokens so the card
// follows light and dark.
export const REPLAY_LAYERS_CSS = `
  .replay-ev-popup .leaflet-popup-content-wrapper {
    background: var(--c-card); color: var(--c-text1); border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.28);
  }
  .replay-ev-popup .leaflet-popup-tip { background: var(--c-card); }
  .replay-ev-popup .leaflet-popup-content { margin: 11px 14px 10px; font-size: 12px; line-height: 1.5; min-width: 210px; }
  .replay-ev-popup a.leaflet-popup-close-button { color: var(--c-text3); }
  .rep-pop-h { font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 6px; margin: 0 14px 4px 0; }
  .rep-pop-r { display: flex; justify-content: space-between; gap: 14px; }
  .rep-pop-r > span:first-child { color: var(--c-text3); flex-shrink: 0; }
  .rep-pop-r > b { text-align: right; min-width: 0; overflow-wrap: anywhere; }
  .rep-pop-note { margin-top: 4px; font-size: 10.5px; color: var(--c-text3); }
  .rep-pop-go {
    margin-top: 7px; padding: 0; border: none; background: none; cursor: pointer;
    font-size: 11.5px; font-weight: 700; color: var(--ft-accent);
  }
  .rep-pop-go:hover { text-decoration: underline; }
  .rep-pop-go:focus-visible { outline: 2px solid var(--ft-accent); outline-offset: 2px; border-radius: 4px; }
  .replay-se-tip.leaflet-tooltip {
    background: var(--c-card); color: var(--c-text1); border: 1px solid var(--c-border2);
    border-radius: 7px; padding: 3px 8px; font-size: 11px; font-weight: 700;
    box-shadow: 0 3px 10px rgba(0,0,0,0.18);
  }
  .replay-se-tip.leaflet-tooltip-bottom::before { border-bottom-color: var(--c-card); }
  .replay-se-tip.leaflet-tooltip-top::before { border-top-color: var(--c-card); }
`

// Path styles are constants (or memoised on the theme): a fresh object per
// render would make react-leaflet call setStyle() on every playback tick.
const OVER = { color: '#e53935', weight: 5.5, opacity: 0.9, lineCap: 'round', interactive: false }
const START = { color: '#fff', weight: 3, fillColor: '#2e7d32', fillOpacity: 1 }
const END = { color: '#fff', weight: 3, fillColor: '#c62828', fillOpacity: 1 }

/**
 * The theme's accent as a colour Leaflet's SVG can take — it writes `stroke`
 * as an attribute, where a var() does not resolve.
 */
function readAccent() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ft-accent').trim()
    if (v) return v
  } catch { /* no DOM */ }
  return '#0a8fb0'
}

const pad = n => String(n).padStart(2, '0')
function clockS(ts, withDate) {
  const d = new Date(ts * 1000)
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return withDate ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hms}` : hms
}
function clockHm(ts) {
  const d = new Date(ts * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Row({ k, children }) {
  return <div className="rep-pop-r"><span>{k}</span><b>{children}</b></div>
}

/** An event dot's card: what, when, for how long, how fast, who and where. */
function EventPopup({ e, open, driver, limitKmh, multiDay, onPlay }) {
  // Only looked up once the card is open: react-leaflet mounts popup bodies eagerly.
  const address = useAddress(e.lat, e.lng, open)
  const instant = INSTANT_TYPES.has(e.type)
  const speedRow = showsSpeed(e.type) && e.speed != null
  const limit = SPEED_TYPES.has(e.type) ? (e.limit ?? limitKmh) : null
  return (
    <div>
      <div className="rep-pop-h">
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.color, display: 'inline-block' }} aria-hidden="true" />
        {e.label}
      </div>
      <Row k="Time">
        {instant || e.toTs <= e.fromTs
          ? clockS(e.fromTs, multiDay)
          : `${clockS(e.fromTs, multiDay)} → ${clockS(e.toTs, multiDay && Math.floor(e.toTs / 86400) !== Math.floor(e.fromTs / 86400))}`}
      </Row>
      {!instant && e.durationSec != null && <Row k="Duration">{fmtHms(e.durationSec)}</Row>}
      {speedRow && <Row k={instant ? 'Speed' : 'Max speed'}>{Math.round(e.speed)} km/h</Row>}
      {limit != null && <Row k="Limit">{Math.round(limit)} km/h</Row>}
      {e.detail && <Row k="Change">{e.detail}</Row>}
      {e.title && e.title !== e.label && <Row k="Rule">{e.title}</Row>}
      <Row k="Driver">{driver ?? '—'}</Row>
      <Row k="Location">{address ? shortenAddress(address, 3) : open ? '…' : '—'}</Row>
      {e.source === 'track' && <div className="rep-pop-note">Read off the track — no alert rule raised it.</div>}
      <button className="rep-pop-go" onClick={() => onPlay(e)}>▶ Play from here</button>
    </div>
  )
}

/** The event dots — memoised, so a playback tick does not touch them. */
const EventDots = memo(function EventDots({ events, activeEventId, onActiveEvent, onPlayFrom, eventDriver, limitKmh, multiDay, layerRefs }) {
  const map = useMap()
  const [openId, setOpenId] = useState(null)
  return events.map(e => {
    const active = activeEventId === e.id
    return (
      <CircleMarker
        key={e.id}
        ref={layer => {
          if (layer) layerRefs.current.set(e.id, layer)
          else layerRefs.current.delete(e.id)
        }}
        center={[e.lat, e.lng]}
        radius={active ? 10 : 8}
        pathOptions={{ color: active ? '#0f2a3a' : '#fff', weight: 2.5, fillColor: e.color, fillOpacity: 1 }}
        eventHandlers={{
          click: () => onActiveEvent(e.id),
          popupopen: () => { setOpenId(e.id); onActiveEvent(e.id) },
          popupclose: () => {
            setOpenId(id => (id === e.id ? null : id))
            onActiveEvent(id => (id === e.id ? null : id))
          },
        }}
      >
        <Popup className="replay-ev-popup" autoPan={false} maxWidth={280}>
          <EventPopup
            e={e}
            open={openId === e.id}
            driver={openId === e.id ? eventDriver(e) : null}
            limitKmh={limitKmh}
            multiDay={multiDay}
            onPlay={ev => { map.closePopup(); onPlayFrom(ev) }}
          />
        </Popup>
      </CircleMarker>
    )
  })
})

/**
 * The replay on the map (approved replay "Option C"): the route already
 * driven solid with a soft glow, what is still to come light and dashed,
 * every stretch above the highlight speed in red, START and END with their
 * times, and a dot per event — click one for its card and "Play from here".
 *
 * `focus` ({id, n}) is a request from the panel or the timeline to show an
 * event: zoom to it and open its card; `n` makes asking twice work.
 */
export default function ReplayMapLayers({
  points, index, highlightKmh, events, activeEventId, focus, multiDay,
  onActiveEvent, onPlayFrom, eventDriver,
}) {
  const map = useMap()
  const layerRefs = useRef(new Map())

  // Re-read when the theme flips (light Sea Blue / dark Midnight Aqua): App
  // toggles the root's class after this renders, so watch for it.
  const [accent, setAccent] = useState(() => readAccent())
  useEffect(() => {
    const update = () => setAccent(readAccent())
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => mo.disconnect()
  }, [])
  const route = useMemo(() => ({
    remaining: { color: accent, weight: 4, opacity: 0.45, dashArray: '6 7', lineCap: 'round', interactive: false },
    glow: { color: accent, weight: 12, opacity: 0.18, lineCap: 'round', interactive: false },
    covered: { color: accent, weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false },
  }), [accent])

  const positions = useMemo(() => points.map(p => [p.lat, p.lng]), [points])
  const covered = useMemo(() => positions.slice(0, index + 1), [positions, index])
  const remaining = useMemo(() => positions.slice(index), [positions, index])
  const over = useMemo(
    () => overLimitRuns(points, highlightKmh).map(r => ({ key: r.fromIdx, positions: positions.slice(r.fromIdx, r.toIdx + 1) })),
    [points, positions, highlightKmh]
  )

  // Only the events of what is playing: a picked trip shows its own.
  const t0 = points[0]?.ts
  const t1 = points[points.length - 1]?.ts
  const onMap = useMemo(
    () => (events ?? []).filter(e => e.fromTs >= t0 && e.fromTs <= t1 && Number.isFinite(e.lat) && Number.isFinite(e.lng)),
    [events, t0, t1]
  )

  // The picked event's stretch of road, in its colour.
  const active = onMap.find(e => e.id === activeEventId) ?? null
  const activeSpan = useMemo(() => {
    if (!active || !(active.toTs > active.fromTs)) return null
    const a = indexAtTime(points, active.fromTs)
    const b = indexAtTime(points, active.toTs)
    return b > a ? positions.slice(a, b + 1) : null
  }, [active, points, positions])
  const spanStyle = useMemo(
    () => (active ? { color: active.color, weight: 7, opacity: 0.95, lineCap: 'round', interactive: false } : null),
    [active]
  )

  useEffect(() => {
    if (!focus) return
    const e = onMap.find(x => x.id === focus.id)
    if (!e) return
    // Already on screen at city level or closer: leave the view alone (the card fits
    // itself — PopupFit in Tracking.jsx). Otherwise go there.
    const onScreen = map.getZoom() >= 11 && map.getBounds().pad(-0.1).contains([e.lat, e.lng])
    if (!onScreen) map.setView([e.lat, e.lng], Math.max(map.getZoom(), 15), { animate: false })
    layerRefs.current.get(e.id)?.openPopup()
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <>
      <Polyline positions={remaining} pathOptions={route.remaining} />
      <Polyline positions={covered} pathOptions={route.glow} />
      <Polyline positions={covered} pathOptions={route.covered} />
      {over.map(r => <Polyline key={`over-${highlightKmh}-${r.key}`} positions={r.positions} pathOptions={OVER} />)}
      {activeSpan && <Polyline positions={activeSpan} pathOptions={spanStyle} />}

      {/* Its own pane above the route, so a red stretch drawn later never covers a dot. */}
      <Pane name="replay-events" style={{ zIndex: 450 }}>
        {first && (
          <CircleMarker center={[first.lat, first.lng]} radius={9} pathOptions={START} interactive={false}>
            <Tooltip permanent direction="bottom" offset={[0, 8]} className="replay-se-tip">START {clockHm(first.ts)}</Tooltip>
          </CircleMarker>
        )}
        {last && points.length > 1 && (
          <CircleMarker center={[last.lat, last.lng]} radius={9} pathOptions={END} interactive={false}>
            <Tooltip permanent direction="top" offset={[0, -8]} className="replay-se-tip">END {clockHm(last.ts)}</Tooltip>
          </CircleMarker>
        )}
        <EventDots
          events={onMap}
          activeEventId={activeEventId}
          onActiveEvent={onActiveEvent}
          onPlayFrom={onPlayFrom}
          eventDriver={eventDriver}
          limitKmh={highlightKmh}
          multiDay={multiDay}
          layerRefs={layerRefs}
        />
      </Pane>
    </>
  )
}
