/**
 * One colour per date for the Distance Driven graphs, as in the client's Ctrack
 * sample (2026-11-13): six hues — teal blue, red, green, amber, orange, dark
 * red — repeating, each round of six a lighter tint than the last, so the
 * first dates are strong and the later ones paler. Shared by the screen
 * graphs (DistanceDrivenCharts.jsx) and the PDF (ctrackExport.js).
 */
const HUES = [
  [52, 152, 186],  // teal blue
  [214, 39, 64],   // red
  [76, 163, 76],   // green
  [214, 155, 0],   // amber
  [226, 98, 32],   // orange
  [176, 56, 56],   // dark red
]
/** How far each round of six is mixed towards white. */
const TINTS = [0, 0.1, 0.24, 0.38, 0.52, 0.64, 0.74]

/** [r, g, b] of the i-th date. */
export function dateBarColor(i) {
  const [r, g, b] = HUES[i % HUES.length]
  const t = TINTS[Math.min(TINTS.length - 1, Math.floor(i / HUES.length))]
  const mix = v => Math.round(v + (255 - v) * t)
  return [mix(r), mix(g), mix(b)]
}

/** Label every k-th date: every other one, sparser once the dates crowd (screen and PDF alike). */
export function dateLabelEvery(n) {
  return n <= 40 ? 2 : 2 * Math.ceil(n / 40)
}

/** The same colour as a CSS hex string. */
export function dateBarHex(i) {
  return `#${dateBarColor(i).map(v => v.toString(16).padStart(2, '0')).join('')}`
}
