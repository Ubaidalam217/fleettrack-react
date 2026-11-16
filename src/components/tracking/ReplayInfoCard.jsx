import { useEffect, useRef } from 'react'
import { Tooltip, useMap } from 'react-leaflet'
import { EyeOff, Maximize2, Minimize2, Move, Phone, Pin, PinOff } from 'lucide-react'
import { replayStateOf } from '../../utils/replayTimeline'
import { togglePinned, nextCorner } from '../../utils/replayCard'
import { useSettledAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'
import { headingLabel } from '../../utils/heading'
import { VEHICLE_ICON_PX } from './VehicleMarker'
import { REPLAY_FIELDS } from './replayFields'

// Following the car it is a permanent tooltip: it moves with the marker for
// free as the track plays and never steals focus. Pinned to a corner it is a
// plain card over the map (ReplayDockedCard). Both wear the teal-to-coral
// vehicle card (index.css --ft-card-*), as the live marker's popup does.
export const REPLAY_INFO_CSS = `
  .replay-info-tip.leaflet-tooltip, .rp-card-dock {
    background: var(--ft-card-bg);
    border: none;
    border-radius: 9px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    color: var(--ft-card-text);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.22);
    padding: 8px 11px;
    font-size: 11.5px;
    line-height: 1.55;
    white-space: normal;
    width: 236px;
  }
  .replay-info-tip.leaflet-tooltip[data-compact="true"], .rp-card-dock[data-compact="true"] {
    width: auto; white-space: nowrap; padding: 5px 8px 5px 10px;
  }
  /* The address is the only field that can run long. Two lines is enough to
     place the vehicle; without the clamp a full Nominatim display_name turns
     the card into a column tall enough to cover the map. */
  .replay-info-addr {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .replay-info-tip.leaflet-tooltip-right::before { border-right-color: var(--ft-card-tip-mid); }
  .replay-info-tip.leaflet-tooltip-left::before  { border-left-color:  var(--ft-card-tip-mid); }
  /* The card is free to slide up or down its own height to stay on the map
     (see useEdgeAwarePlacement), which would leave Leaflet's arrow — pinned at
     top:50% — pointing at empty space. --tip-y puts it back on the marker. */
  .replay-info-tip.leaflet-tooltip::before { top: var(--tip-y, 50%); margin-top: -6px; }

  /* Pinned to a corner of the map, clear of the list toggle, the zoom and
     layer buttons, and the player bar (bottom left sits on the bar's box). */
  .rp-card-dock { position: absolute; z-index: 905; }
  .rp-card-dock[data-corner="tl"] { top: 56px; left: 12px; }
  .rp-card-dock[data-corner="tr"] { top: 12px; right: 150px; }
  .rp-card-dock[data-corner="bl"] { bottom: calc(100% + 10px); left: 0; }
  @container (max-width: 560px) {
    .rp-card-dock[data-corner="tr"] { top: 56px; right: auto; left: 12px; }
  }

  .rp-card-head { display: flex; align-items: center; gap: 8px; }
  .rp-card-tools { display: flex; gap: 3px; margin-left: auto; flex-shrink: 0; }
  .rp-card-tools button {
    display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px;
    background: rgba(255, 255, 255, 0.14); color: var(--ft-card-text); cursor: pointer;
  }
  .rp-card-tools button:hover { background: rgba(255, 255, 255, 0.26); }
  .rp-card-tools button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  /* Leaflet paints every link in its container blue (.leaflet-container a),
     which on the gradient read as a faint grey-blue (client, 2026-11-16). The
     number is the card's white, underlined, with a phone icon. */
  .leaflet-container .rp-card-tel, .rp-card-tel {
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--ft-card-text); font-weight: 700;
    text-decoration: underline; text-decoration-color: rgba(255, 255, 255, 0.7); text-underline-offset: 2px;
  }
  .leaflet-container .rp-card-tel:hover, .rp-card-tel:hover { color: #fff; text-decoration-color: #fff; }
  .rp-card-tel:focus-visible { outline: 2px solid #fff; outline-offset: 1px; border-radius: 3px; }
`

// Clearance from the map's edges. The card is never allowed closer than this.
const EDGE_PAD = 8
// Clearance between the marker and the card, measured from the marker's centre.
const MARKER_GAP = VEHICLE_ICON_PX / 2 + 6

/**
 * Keeps the replay card inside the map, on every tick.
 *
 * Leaflet places a tooltip once per move using a fixed `direction`, with no
 * notion of the map's edges — so a vehicle driving into the right-hand side of
 * the viewport takes its card off the map with it. This re-derives the card's
 * position from the live geometry instead:
 *
 *   1. prefer right of the marker; flip to the left if the card would cross
 *      the right edge and there is room on the other side,
 *   2. clamp vertically, which is what handles the top and bottom edges — a
 *      right/left tooltip is centred on the marker, so half of it hangs above
 *      a vehicle near the top of the map,
 *   3. clamp horizontally last, so a card with room on neither side is pinned
 *      inside the box rather than allowed to hang out of the narrower gap.
 *
 * Steps 2 and 3 are why the corners work: the flip alone leaves a card at the
 * top-right overhanging the top, and the clamps are unconditional.
 *
 * Everything is computed in container pixels and handed back to Leaflet as the
 * tooltip's `offset`, which `_setPosition` adds in the same pixel space.
 */
function useEdgeAwarePlacement(tipRef, map, lat, lng) {
  const placeRef = useRef(() => {})

  const place = () => {
    const tip = tipRef.current
    const el  = tip?.getElement?.()
    if (!el || !map || !Number.isFinite(lat) || !Number.isFinite(lng)) return

    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!w || !h) return

    const box = map.getContainer().getBoundingClientRect()
    const a   = map.latLngToContainerPoint([lat, lng])

    let dir  = 'right'
    let left = a.x + MARKER_GAP
    if (left + w > box.width - EDGE_PAD && a.x - MARKER_GAP - w >= EDGE_PAD) {
      dir  = 'left'
      left = a.x - MARKER_GAP - w
    }

    // Both clamps use Math.max on the upper bound so that a card larger than
    // the map lands flush against the top-left rather than inverting. The
    // player bar covers the map's bottom edge, so the card stays above it.
    const bar = map.getContainer().parentElement?.querySelector('.track-replay-bar')
    const bottomPad = bar ? bar.offsetHeight + 12 + EDGE_PAD : EDGE_PAD
    let top = a.y - h / 2
    top  = Math.min(Math.max(top,  EDGE_PAD), Math.max(EDGE_PAD, box.height - bottomPad - h))
    left = Math.min(Math.max(left, EDGE_PAD), Math.max(EDGE_PAD, box.width  - EDGE_PAD - w))

    // Leaflet anchors a 'right' tooltip by its left edge and a 'left' one by
    // its right edge; both are vertically centred. Invert that to get the
    // offset which lands the card's box where we want it.
    tip.options.direction = dir
    tip.options.offset = [
      dir === 'right' ? left - a.x : left + w - a.x,
      top + h / 2 - a.y,
    ]
    tip.update()

    // Keep the arrow on the marker after a vertical clamp, but never let it
    // slide off the card's own rounded corners.
    el.style.setProperty('--tip-y', `${Math.min(Math.max(a.y - top, 10), h - 10)}px`)
  }

  // No dependency array: the card is re-rendered on every replay tick, and the
  // placement depends on the rendered size, which the address landing changes.
  useEffect(() => {
    placeRef.current = place
    place()
    // A second pass after paint catches the tick where the content grew: the
    // sync call above measured the card before the browser had laid it out.
    const raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  })

  // Panning or resizing the map moves the marker without re-rendering this
  // component, so a paused replay would otherwise keep a stale placement.
  useEffect(() => {
    if (!map) return
    const run = () => placeRef.current()
    map.on('move zoom resize', run)
    return () => { map.off('move zoom resize', run) }
  }, [map])
}

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--ft-card-label)', flexShrink: 0, minWidth: 50, fontSize: 10.5 }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  )
}

/** Pin / move / compact / hide, on the card itself. */
function CardTools({ prefs, onPrefs, docked }) {
  // Leaflet would otherwise start a map drag, or zoom on a double click.
  const stop = e => e.stopPropagation()
  return (
    <span className="rp-card-tools" onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop}>
      {docked && (
        <button type="button" onClick={() => onPrefs(nextCorner(prefs))} title="Move to another corner" aria-label="Move the card to another corner">
          <Move size={11} />
        </button>
      )}
      <button
        type="button"
        onClick={() => onPrefs(togglePinned(prefs))}
        title={docked ? 'Follow the vehicle again' : 'Pin to a corner of the map'}
        aria-label={docked ? 'Let the card follow the vehicle' : 'Pin the card to a corner of the map'}
      >
        {docked ? <PinOff size={11} /> : <Pin size={11} />}
      </button>
      <button
        type="button"
        onClick={() => onPrefs({ ...prefs, compact: !prefs.compact })}
        title={prefs.compact ? 'Show the chosen fields' : 'One line only'}
        aria-label={prefs.compact ? 'Expand the card' : 'Make the card compact'}
      >
        {prefs.compact ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
      </button>
      <button
        type="button"
        onClick={() => onPrefs({ ...prefs, show: false })}
        title="Hide the card (bring it back from the player bar)"
        aria-label="Hide the vehicle card"
      >
        <EyeOff size={11} />
      </button>
    </span>
  )
}

/**
 * What the card says. The state is the replay's own (driving / idle /
 * stopped, in the timeline's colours), not the vehicle's live status.
 */
function CardBody({ point, fields, prefs, onPrefs, docked, driver }) {
  const wantAddress = !!fields.address && !prefs.compact
  const address = useSettledAddress(point.lat, point.lng, wantAddress)
  const state = replayStateOf(point)
  const stateLine = (
    <span style={{ fontWeight: 700 }}>
      <span style={{ color: state.color, textShadow: 'none' }}>●</span> {state.label}
    </span>
  )

  if (prefs.compact) {
    return (
      <div className="rp-card-head">
        {stateLine}
        <span style={{ fontWeight: 600 }}>· {Math.round(point.speed ?? 0)} km/h · {fmtTime(point.ts)}</span>
        {onPrefs && <CardTools prefs={prefs} onPrefs={onPrefs} docked={docked} />}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="rp-card-head" style={{ marginBottom: 1 }}>
        {fields.status ? stateLine : <span />}
        {onPrefs && <CardTools prefs={prefs} onPrefs={onPrefs} docked={docked} />}
      </div>
      {fields.speed     && <Line label="Speed">{point.speed ?? 0} km/h</Line>}
      {fields.timestamp && <Line label="Time">{fmtClock(point.ts)}</Line>}
      {fields.driver    && <Line label="Driver">{driver?.name ?? '—'}</Line>}
      {fields.mobile    && driver?.mobile && (
        <Line label="Mobile">
          <a href={`tel:${driver.mobile.replace(/[^\d+]/g, '')}`} className="rp-card-tel" title={`Call ${driver.name}`}>
            <Phone size={11} aria-hidden="true" />
            {driver.mobile}
          </a>
        </Line>
      )}
      {fields.heading   && <Line label="Heading">{headingLabel(point.heading)}</Line>}
      {fields.address   && (
        // Full width rather than a label/value row: an address squeezed into
        // the value column wraps to one word per line.
        <div style={{ marginTop: 2 }}>
          <span style={{ color: 'var(--ft-card-label)', fontSize: 10.5 }}>Address</span>
          <div className="replay-info-addr" style={{ fontWeight: 600 }} title={address ?? undefined}>
            {address
              ? shortenAddress(address)
              : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
          </div>
        </div>
      )}
    </div>
  )
}

const anyField = fields => REPLAY_FIELDS.some(f => fields[f.key])

/**
 * The card that rides alongside the replay marker (prefs.dock 'follow').
 *
 * The address is looked up only once the point has stopped moving for a beat —
 * at 10x the point advances ~25 times a second, and geocoding each one would
 * both be unreadable and breach Nominatim's ~1 request/second policy.
 */
export default function ReplayInfoCard({ point, fields, prefs, onPrefs, driver }) {
  const map     = useMap()
  const tipRef  = useRef(null)

  useEdgeAwarePlacement(tipRef, map, point.lat, point.lng)

  // The compact look is a class on Leaflet's own element, which React does not render.
  useEffect(() => {
    tipRef.current?.getElement?.()?.setAttribute('data-compact', prefs.compact ? 'true' : 'false')
  })

  if (!prefs.compact && !anyField(fields)) return null

  return (
    // `direction` and `offset` are the pre-placement fallback only; both are
    // overwritten on the instance before the first paint. Interactive, so the
    // pin / hide buttons on it can be clicked.
    <Tooltip
      ref={tipRef} permanent interactive direction="right" offset={[MARKER_GAP, 0]}
      className="replay-info-tip"
    >
      <CardBody point={point} fields={fields} prefs={prefs} onPrefs={onPrefs} docked={false} driver={driver} />
    </Tooltip>
  )
}

/** The same card pinned to a corner of the map (prefs.dock 'tl' | 'tr' | 'bl'). */
export function ReplayDockedCard({ point, fields, prefs, onPrefs, driver }) {
  if (!prefs.compact && !anyField(fields)) return null
  return (
    <div className="rp-card-dock" data-corner={prefs.dock} data-compact={prefs.compact ? 'true' : 'false'} role="status" aria-label="Replay vehicle card">
      <CardBody point={point} fields={fields} prefs={prefs} onPrefs={onPrefs} docked driver={driver} />
    </div>
  )
}
