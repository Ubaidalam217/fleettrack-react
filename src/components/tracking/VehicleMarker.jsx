import { useEffect, useRef } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'
import { vehicleArt, vehicleSvg } from './vehicleIcons'

// Outer box. The ring is drawn on it, so it has to clear the artwork.
export const VEHICLE_ICON_PX = 44
// The vehicle itself, inside the ring.
const ART_PX = 40

// Include once, wherever these markers are rendered. The rotation lives on
// `.veh-rot` and not on the icon root because Leaflet owns the root node's
// transform for positioning and overwrites anything we put there — and not on
// `.veh-ring` either, because the ring is a compass-independent status
// indicator and spinning it would drag its drop shadow around with it.
export const VEHICLE_MARKER_CSS = `
  .veh-marker { background: none; border: none; }

  /* Status ring. The artwork is a real photograph of a real (coloured)
     vehicle, so status cannot be carried by tinting it the way the drawn
     silhouettes were — the ring and its glow carry it instead. */
  .veh-ring {
    width: ${VEHICLE_ICON_PX}px;
    height: ${VEHICLE_ICON_PX}px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--veh-st);
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 50% 50%,
      color-mix(in srgb, var(--veh-st) 30%, transparent) 0%,
      color-mix(in srgb, var(--veh-st) 12%, transparent) 62%,
      transparent 100%);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--veh-st) 20%, transparent),
      0 3px 8px rgba(0,0,0,0.38);
  }

  .veh-rot {
    width: ${ART_PX}px;
    height: ${ART_PX}px;
    transform-origin: 50% 50%;
    transition: transform 0.45s ease;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
    will-change: transform;
  }

  /* contain, not cover: the art is already trimmed and square, and cover would
     crop a long vehicle's nose off the moment the box is not exactly square. */
  .veh-img {
    display: block;
    object-fit: contain;
    -webkit-user-drag: none;
    user-select: none;
  }
`

// Keyed on type + colour — at most five shapes times five statuses for the
// whole fleet, forever. Heading is deliberately *not* part of the key: a new
// L.divIcon identity makes react-leaflet call setIcon(), which swaps the
// marker's DOM node out, and a node that was just replaced cannot transition
// anything. Mutating the surviving node's transform instead is what makes the
// rotation smooth.
const iconCache = new Map()

function vehicleIcon(type, color) {
  const key    = `${type || ''}|${color}`
  const cached = iconCache.get(key)
  if (cached) return cached

  const art = vehicleArt(type)
  // Both branches produce a `.veh-rot` box of identical size, so a fleet that
  // mixes photographed and drawn types still lines up.
  const inner = art
    ? `<img class="veh-rot veh-img" src="${art}" alt="" draggable="false">`
    : `<div class="veh-rot">${vehicleSvg(type, color)}</div>`

  const icon = L.divIcon({
    className: 'veh-marker',
    html: `<div class="veh-ring" style="--veh-st:${color}">${inner}</div>`,
    iconSize:    [VEHICLE_ICON_PX, VEHICLE_ICON_PX],
    iconAnchor:  [VEHICLE_ICON_PX / 2, VEHICLE_ICON_PX / 2],
    popupAnchor: [0, -VEHICLE_ICON_PX / 2],
    // Zero, deliberately: ReplayInfoCard computes the tooltip's offset itself
    // so it can flip and clamp against the map edges, and a non-zero anchor
    // here would be a second, invisible term in that arithmetic.
    tooltipAnchor: [0, 0],
  })
  iconCache.set(key, icon)
  return icon
}

/**
 * A vehicle marker that points where the vehicle is pointing.
 *
 * `type` is the Edit Asset vehicle type (car/truck/bus/bike/machine); anything
 * else draws the car.
 *
 * `heading` is a compass course in degrees (Flespi's position.direction);
 * null/undefined/NaN all fall back to 0.
 *
 * `autoOpenKey` opens this marker's popup whenever the value changes to
 * something non-null — Tracking passes the fly-to counter, so selecting a
 * vehicle in the list pops its marker open, and re-selecting it pops it again.
 */
export default function VehicleMarker({
  position, color, type, heading, autoOpenKey = null, eventHandlers, zIndexOffset, children,
}) {
  const markerRef = useRef(null)
  // The *displayed* angle, which is allowed to run outside 0-360 so the vehicle
  // can keep turning the short way round instead of unwinding.
  const angleRef  = useRef(null)
  // Which node that angle was last written to. A status change swaps the icon,
  // and the replacement node starts at 0deg with no memory of the rotation.
  const nodeRef   = useRef(null)

  useEffect(() => {
    const el = markerRef.current?.getElement()?.querySelector('.veh-rot')
    if (!el) return

    const target = Number.isFinite(heading) ? heading : 0
    const prev   = angleRef.current
    // A node we have never written to has to be snapped, not animated:
    // transitioning it would spin the vehicle up from north on first paint and
    // again every time its status colour changes.
    const fresh  = prev == null || nodeRef.current !== el

    let next
    if (prev == null) {
      next = target
    } else {
      // Shortest way round: normalise the difference into (-180, 180] and add
      // it, so 350deg -> 10deg turns 20deg right instead of 340deg left.
      const delta = ((target - (prev % 360)) + 540) % 360 - 180
      next = prev + delta
    }
    angleRef.current = next
    nodeRef.current  = el

    if (fresh) {
      el.style.transition = 'none'
      el.style.transform  = `rotate(${next}deg)`
      void el.offsetWidth // flush the change before the transition comes back
      el.style.transition = ''
    } else {
      el.style.transform = `rotate(${next}deg)`
    }
  // `type` and `color` are in here because swapping either replaces the icon's
  // DOM node, and the replacement is born without the rotation we applied.
  }, [heading, type, color])

  useEffect(() => {
    if (autoOpenKey == null) return
    markerRef.current?.openPopup()
  }, [autoOpenKey])

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={vehicleIcon(type, color)}
      eventHandlers={eventHandlers}
      zIndexOffset={zIndexOffset}
    >
      {children}
    </Marker>
  )
}
