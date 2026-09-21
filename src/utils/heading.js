// Compass course formatting, shared by the marker popup and the replay info
// card so the two never drift apart on rounding or on the cardinal labels.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** `212` -> `"212° SW"`. Anything non-finite renders as an em dash. */
export function headingLabel(deg) {
  if (!Number.isFinite(deg)) return '—'
  return `${Math.round(deg)}° ${COMPASS[Math.round(deg / 45) % 8]}`
}
