/**
 * The Fuel report's level graph as an image (JPEG), for the downloaded PDF and Excel
 * (utils/geoZoneExport.js `figures`). Drawn on a canvas in the paper's own
 * colours — the downloads are always the white Movement paper, whatever the
 * screen theme. One series (litres, or raw when not calibrated), a recessive
 * grid, fills ▲ and drains ▼ labelled, never colour alone.
 */

const INK = '#111827'
const MUTED = '#4b5563'
const GRID = '#d1d5db'
const LINE = '#0a7e9c'
const FILL = '#15803d'
const DRAIN = '#b91c1c'

function ticks(min, max, n = 4) {
  if (!(max > min)) return [min]
  const raw = (max - min) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

const pad = n => String(n).padStart(2, '0')
const UAE = 4 * 3600_000

/** Round UAE hours or midnights, about 7 across the chart. */
export function timeTicks(from, to, want = 7) {
  const steps = [3600_000, 2 * 3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000, 86400_000, 2 * 86400_000, 5 * 86400_000, 7 * 86400_000]
  const step = steps.find(st => (to - from) / st <= want) ?? steps[steps.length - 1]
  const out = []
  for (let t = Math.ceil((from + UAE) / step) * step - UAE; t <= to; t += step) out.push(t)
  return out
}
/** UAE time labels: "20 Nov" or "14:00". */
function timeLabel(ms, spanMs) {
  const d = new Date(ms + 4 * 3600_000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return spanMs > 2 * 86400_000 ? `${d.getUTCDate()} ${months[d.getUTCMonth()]}` : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * @param {{ series: {ts:number, v:number}[], events?: object[], unit: 'L'|'raw', from: number, to: number }} p
 * @returns {string|null} a JPEG data URL, or null with nothing to draw
 */
export function renderFuelChartPng({ series, events = [], unit, from, to, width = 1600, height = 420 }) {
  if (typeof document === 'undefined' || !series?.length) return null
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, width, height)

  const P = { l: 96, r: 24, t: 52, b: 52 }
  const vs = series.map(p => p.v)
  let y0 = Math.min(0, ...vs)
  let y1 = Math.max(...vs)
  if (y1 === y0) y1 = y0 + 1
  const yt = ticks(y0, y1 + (y1 - y0) * 0.05)
  if (yt.length > 1 && yt[yt.length - 1] < y1) yt.push(+(yt[yt.length - 1] + (yt[1] - yt[0])).toFixed(10))
  y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1])
  const x0 = from ?? series[0].ts, x1 = Math.max(x0 + 1, to ?? series[series.length - 1].ts)
  const sx = t => P.l + ((t - x0) / (x1 - x0)) * (width - P.l - P.r)
  const sy = v => height - P.b - ((v - y0) / (y1 - y0)) * (height - P.t - P.b)

  g.font = '22px Helvetica, Arial, sans-serif'
  g.textBaseline = 'middle'
  g.lineWidth = 2
  for (const v of yt) {
    g.strokeStyle = GRID
    g.beginPath(); g.moveTo(P.l, sy(v)); g.lineTo(width - P.r, sy(v)); g.stroke()
    g.fillStyle = MUTED
    g.textAlign = 'right'
    g.fillText(unit === 'L' ? `${v} L` : String(v), P.l - 12, sy(v))
  }
  g.textAlign = 'center'
  g.textBaseline = 'top'
  for (const t of timeTicks(x0, x1)) {
    if (t < x0 || t > x1) continue
    g.fillText(timeLabel(t, x1 - x0), sx(t), height - P.b + 12)
  }

  g.strokeStyle = LINE
  g.lineWidth = 4
  g.lineJoin = 'round'
  g.beginPath()
  series.forEach((p, i) => (i ? g.lineTo(sx(p.ts), sy(p.v)) : g.moveTo(sx(p.ts), sy(p.v))))
  g.stroke()

  g.font = 'bold 20px Helvetica, Arial, sans-serif'
  for (const e of events) {
    const x = sx(e.endTs), y = sy(e.after)
    const up = e.kind === 'fill'
    g.fillStyle = up ? FILL : DRAIN
    g.strokeStyle = '#ffffff'
    g.lineWidth = 3
    g.beginPath()
    if (up) { g.moveTo(x - 11, y + 9); g.lineTo(x + 11, y + 9); g.lineTo(x, y - 11) } else { g.moveTo(x - 11, y - 9); g.lineTo(x + 11, y - 9); g.lineTo(x, y + 11) }
    g.closePath(); g.fill(); g.stroke()
    g.fillStyle = INK
    g.textBaseline = up ? 'bottom' : 'top'
    g.fillText(`${up ? 'Fill' : 'Drain'} ${up ? '+' : '-'}${e.litres} L`, x, up ? y - 14 : y + 14)
  }
  // JPEG: a white chart compresses to a few dozen KB, where a PNG in jsPDF is megabytes.
  return c.toDataURL('image/jpeg', 0.9)
}
