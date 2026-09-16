/**
 * The five fleet badge icons, carried over from the old FleetHealthGauge's
 * inline <BadgeSvg>. The path data is unchanged — it was drawn centred on
 * (0,0) in a +/-7 space, so each icon keeps that origin and declares a
 * viewBox around it instead of being translated into a 0-24 box.
 *
 * Stroke is `currentColor` so FleetGauge.css owns the colour.
 */

const BOX = '-8 -8 16 16'
const SC = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function WrenchIcon() {
  return (
    <svg viewBox={BOX}>
      <path d="M6.5-4.5a4.5 4.5 0 01-6 5.5l-4.5 4.5a1.8 1.8 0 01-2.5-2.5L-2 -1.5a4.5 4.5 0 015.5-6l-2.5 2.5.5 2.5 2.5.5z" {...SC} />
    </svg>
  )
}

export function PulseIcon() {
  return (
    <svg viewBox={BOX}>
      <path d="M-7 0h2.5l2 5.5 3.5-11 2 5.5h7" {...SC} />
    </svg>
  )
}

export function DropIcon() {
  return (
    <svg viewBox={BOX}>
      <path d="M0-7c4 5 6 7 6 9.5A6 6 0 01-6 2.5C-6 0-4-2 0-7z" {...SC} />
    </svg>
  )
}

export function ShieldIcon() {
  return (
    <svg viewBox={BOX}>
      <path d="M0-6.5 5.5-3.5v4.5C5.5 4 3 6.5 0 7.5c-3-1-5.5-3.5-5.5-7V-3.5z" {...SC} />
    </svg>
  )
}

export function RocketIcon() {
  return (
    <svg viewBox={BOX}>
      <path d="M0-7c2.5 2 3.5 5.5 3 9l-1 2.5h-4l-1-2.5c-.5-3.5.5-7 3-9z" {...SC} />
      <path d="M-3 2l-2.5 3.5M3 2l2.5 3.5M-1.3 4h2.6l.6 3.5h-3.8z" {...SC} />
    </svg>
  )
}
