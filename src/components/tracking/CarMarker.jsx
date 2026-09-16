import { useEffect, useRef } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'

// Top-down car, hand-authored so there's no icon dependency and nothing to
// fetch at runtime. Drawn pointing north (0deg) inside a 32x32 box, centred on
// the vehicle's coordinate.
//
// Element order matters: the tyres are painted first so the body covers their
// inner half and only the tread peeks out past the sills, which is what makes
// the silhouette read as a car rather than a capsule at 32px.
function carSvg(color) {
  return `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
  <g fill="#243040">
    <rect x="4.6" y="6.4" width="3.0" height="5.0" rx="1.2"/>
    <rect x="24.4" y="6.4" width="3.0" height="5.0" rx="1.2"/>
    <rect x="4.6" y="19.6" width="3.0" height="5.6" rx="1.2"/>
    <rect x="24.4" y="19.6" width="3.0" height="5.6" rx="1.2"/>
  </g>
  <g stroke="#fff" stroke-width="1.4" stroke-linejoin="round">
    <path d="M6.4 10.3 L3.2 9.5 L2.85 11.4 L6.4 11.9 Z" fill="${color}"/>
    <path d="M25.6 10.3 L28.8 9.5 L29.15 11.4 L25.6 11.9 Z" fill="${color}"/>
    <path d="M16 2.2 C12.6 2.2 10.4 3.3 9.6 5.7 L8.4 9.7 C7.0 10.3 6.2 11.3 6.2 12.7 L6.2 25.3 C6.2 28.2 8.6 29.8 16 29.8 C23.4 29.8 25.8 28.2 25.8 25.3 L25.8 12.7 C25.8 11.3 25.0 10.3 23.6 9.7 L22.4 5.7 C21.6 3.3 19.4 2.2 16 2.2 Z" fill="${color}"/>
  </g>
  <path d="M8.9 10.9 C11.1 10.4 13.4 10.2 16 10.2 C18.6 10.2 20.9 10.4 23.1 10.9 L22.0 14.0 L10.0 14.0 Z" fill="rgba(255,255,255,0.94)"/>
  <rect x="9.8" y="14.3" width="12.4" height="8.0" rx="1.4" fill="rgba(0,0,0,0.24)"/>
  <path d="M10.0 22.6 L22.0 22.6 L23.1 25.7 C20.9 26.2 18.6 26.4 16 26.4 C13.4 26.4 11.1 26.2 8.9 25.7 Z" fill="rgba(255,255,255,0.66)"/>
</svg>`
}

// Include once, wherever these markers are rendered. The rotation lives on
// `.car-rot` and not on the icon root because Leaflet owns the root node's
// transform for positioning and overwrites anything we put there.
export const CAR_MARKER_CSS = `
  .car-marker { background: none; border: none; }
  .car-rot {
    width: 32px;
    height: 32px;
    transform-origin: 50% 50%;
    transition: transform 0.45s ease;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
    will-change: transform;
  }
`

// Keyed on colour alone — five icons for the whole fleet, forever. Heading is
// deliberately *not* part of the key: a new L.divIcon identity makes
// react-leaflet call setIcon(), which swaps the marker's DOM node out, and a
// node that was just replaced cannot transition anything. Mutating the
// surviving node's transform instead is what makes the rotation smooth.
const iconCache = new Map()

function carIcon(color) {
  const cached = iconCache.get(color)
  if (cached) return cached

  const icon = L.divIcon({
    className: 'car-marker',
    html: `<div class="car-rot">${carSvg(color)}</div>`,
    iconSize:    [32, 32],
    iconAnchor:  [16, 16],
    popupAnchor: [0, -15],
    // Offset clear of the car so the replay info card doesn't sit on top of it.
    tooltipAnchor: [19, 0],
  })
  iconCache.set(color, icon)
  return icon
}

/**
 * A vehicle marker that points where the vehicle is pointing.
 *
 * `heading` is a compass course in degrees (Flespi's position.direction);
 * null/undefined/NaN all fall back to 0.
 *
 * `autoOpenKey` opens this marker's popup whenever the value changes to
 * something non-null — Tracking passes the fly-to counter, so selecting a
 * vehicle in the list pops its marker open, and re-selecting it pops it again.
 */
export default function CarMarker({
  position, color, heading, autoOpenKey = null, eventHandlers, zIndexOffset, children,
}) {
  const markerRef = useRef(null)
  // The *displayed* angle, which is allowed to run outside 0-360 so the car can
  // keep turning the short way round instead of unwinding.
  const angleRef  = useRef(null)

  useEffect(() => {
    const el = markerRef.current?.getElement()?.querySelector('.car-rot')
    if (!el) return

    const target = Number.isFinite(heading) ? heading : 0
    const prev   = angleRef.current

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

    if (prev == null) {
      // First paint: snap to the real heading instead of animating up from 0.
      el.style.transition = 'none'
      el.style.transform  = `rotate(${next}deg)`
      void el.offsetWidth // flush the change before the transition comes back
      el.style.transition = ''
    } else {
      el.style.transform = `rotate(${next}deg)`
    }
  }, [heading])

  useEffect(() => {
    if (autoOpenKey == null) return
    markerRef.current?.openPopup()
  }, [autoOpenKey])

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={carIcon(color)}
      eventHandlers={eventHandlers}
      zIndexOffset={zIndexOffset}
    >
      {children}
    </Marker>
  )
}
