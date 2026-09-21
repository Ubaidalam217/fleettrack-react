import { useEffect, useRef } from 'react'
import { Tooltip, useMap } from 'react-leaflet'
import { statusColor, statusLabel } from '../../utils/vehicleStatus'
import { useSettledAddress } from '../../hooks/useAddress'
import { shortenAddress } from '../../utils/geocode'
import { headingLabel } from '../../utils/heading'
import { VEHICLE_ICON_PX } from './VehicleMarker'
import { REPLAY_FIELDS } from './replayFields'

// A permanent tooltip rather than a popup: it follows the marker for free as
// the track plays, needs no click to open, and never steals focus.
export const REPLAY_INFO_CSS = `
  .replay-info-tip.leaflet-tooltip {
    background: rgba(17, 24, 39, 0.92);
    border: none;
    border-radius: 9px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    color: #f9fafb;
    padding: 8px 11px;
    font-size: 11.5px;
    line-height: 1.55;
    white-space: normal;
    width: 236px;
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
  .replay-info-tip.leaflet-tooltip-right::before { border-right-color: rgba(17, 24, 39, 0.92); }
  .replay-info-tip.leaflet-tooltip-left::before  { border-left-color:  rgba(17, 24, 39, 0.92); }
  /* The card is free to slide up or down its own height to stay on the map
     (see useEdgeAwarePlacement), which would leave Leaflet's arrow — pinned at
     top:50% — pointing at empty space. --tip-y puts it back on the marker. */
  .replay-info-tip.leaflet-tooltip::before { top: var(--tip-y, 50%); margin-top: -6px; }
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
    // the map lands flush against the top-left rather than inverting.
    let top = a.y - h / 2
    top  = Math.min(Math.max(top,  EDGE_PAD), Math.max(EDGE_PAD, box.height - EDGE_PAD - h))
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

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
      <span style={{ color: 'rgba(249,250,251,0.55)', flexShrink: 0, minWidth: 50, fontSize: 10.5 }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  )
}

/**
 * The card that rides alongside the replay marker.
 *
 * The address is looked up only once the point has stopped moving for a beat —
 * at 10x the point advances ~25 times a second, and geocoding each one would
 * both be unreadable and breach Nominatim's ~1 request/second policy.
 */
export default function ReplayInfoCard({ point, fields }) {
  const wantAddress = !!fields.address
  const address = useSettledAddress(point.lat, point.lng, wantAddress)
  const map     = useMap()
  const tipRef  = useRef(null)

  useEdgeAwarePlacement(tipRef, map, point.lat, point.lng)

  const anyOn = REPLAY_FIELDS.some(f => fields[f.key])
  if (!anyOn) return null

  return (
    // `direction` and `offset` are the pre-placement fallback only; both are
    // overwritten on the instance before the first paint.
    <Tooltip ref={tipRef} permanent direction="right" offset={[MARKER_GAP, 0]} className="replay-info-tip">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.status && (
          <div style={{ color: statusColor(point.status), fontWeight: 700, marginBottom: 1 }}>
            ● {statusLabel(point.status)}
          </div>
        )}
        {fields.speed     && <Line label="Speed">{point.speed ?? 0} km/h</Line>}
        {fields.timestamp && <Line label="Time">{fmtClock(point.ts)}</Line>}
        {fields.heading   && <Line label="Heading">{headingLabel(point.heading)}</Line>}
        {fields.address   && (
          // Full width rather than a label/value row: an address squeezed into
          // the value column wraps to one word per line.
          <div style={{ marginTop: 2 }}>
            <span style={{ color: 'rgba(249,250,251,0.55)', fontSize: 10.5 }}>Address</span>
            <div className="replay-info-addr" style={{ fontWeight: 600 }} title={address ?? undefined}>
              {address
                ? shortenAddress(address)
                : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
            </div>
          </div>
        )}
      </div>
    </Tooltip>
  )
}
