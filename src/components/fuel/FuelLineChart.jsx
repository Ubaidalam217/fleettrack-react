import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * One series as a line (fuel: litres over time, or a calibration's litres
 * over voltage). Plain SVG, theme tokens only, so it reads in light and dark:
 * the line is the accent, the grid and axes are recessive, text wears text
 * tokens. One series needs no legend; the caller's title names it.
 *
 * Hover (or touch) shows a crosshair and the nearest reading. `markers` are
 * events on the line (a fill, a drain): each a ring of its own shape and a
 * short label, never colour alone.
 *
 * points   [{ x:number, y:number|null }]  (null y = a gap, the line breaks)
 * markers  [{ x, y, kind:'fill'|'drain', label }]
 */

const PAD = { l: 52, r: 14, t: 12, b: 30 }

function niceTicks(min, max, count = 5) {
  if (!(max > min)) { const v = Number.isFinite(min) ? min : 0; return [v] }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

const MARK = {
  fill:  { color: '#16a34a', label: 'Fill' },
  drain: { color: '#dc2626', label: 'Drain' },
}

export default function FuelLineChart({
  points, markers = [], height = 220, xFormat = v => String(v), yFormat = v => String(v), tipX = xFormat, tipY = yFormat,
  xTicks: xTicksIn, yMin: yMinIn, ariaLabel, showDots = false,
}) {
  const svgRef = useRef(null)
  const boxRef = useRef(null)
  const [hover, setHover] = useState(null)
  // Drawn at the box's own width, so the text stays its real size on any screen.
  const [W, setW] = useState(760)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = height

  const geo = useMemo(() => {
    const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    if (!valid.length) return null
    const xs = valid.map(p => p.x), ys = valid.map(p => p.y)
    let x0 = Math.min(...xs), x1 = Math.max(...xs)
    if (x1 === x0) { x0 -= 1; x1 += 1 }
    let y0 = yMinIn ?? Math.min(0, ...ys), y1 = Math.max(...ys)
    if (y1 === y0) y1 = y0 + 1
    const yt = niceTicks(y0, y1 + (y1 - y0) * 0.05, 4)
    // A gridline above the highest reading, so the top of the line is labelled.
    if (yt.length > 1 && yt[yt.length - 1] < y1) yt.push(+(yt[yt.length - 1] + (yt[1] - yt[0])).toFixed(10))
    y1 = Math.max(y1, yt[yt.length - 1])
    y0 = Math.min(y0, yt[0])
    const sx = x => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
    const sy = y => H - PAD.b - ((y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b)
    let d = ''
    let pen = false
    for (const p of points) {
      if (!Number.isFinite(p.y) || !Number.isFinite(p.x)) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`
      pen = true
    }
    const xt = (typeof xTicksIn === 'function' ? xTicksIn(x0, x1, W) : xTicksIn) ?? niceTicks(x0, x1, Math.max(2, Math.floor(W / 140)))
    return { valid, sx, sy, d, yt, xt: xt.filter(v => v >= x0 && v <= x1), x0, x1 }
  }, [points, H, W, xTicksIn, yMinIn])

  if (!geo) return <div ref={boxRef} style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--c-text3)' }}>No readings to draw</div>

  const onMove = e => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const cx = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) * (W / rect.width)
    let best = null
    for (const p of geo.valid) {
      const dx = Math.abs(geo.sx(p.x) - cx)
      if (!best || dx < best.dx) best = { dx, p }
    }
    setHover(best?.p ?? null)
  }

  const hx = hover ? geo.sx(hover.x) : 0
  const hy = hover ? geo.sy(hover.y) : 0
  const tipLeft = hover ? Math.min(Math.max(hx / W * 100, 12), 88) : 0

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}
        style={{ display: 'block', touchAction: 'pan-y', overflow: 'visible' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove}>
        {geo.yt.map(v => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(v)} y2={geo.sy(v)} stroke="var(--c-border)" strokeWidth="1" />
            <text x={PAD.l - 8} y={geo.sy(v) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--c-text3)">{yFormat(v)}</text>
          </g>
        ))}
        {geo.xt.map(v => (
          <text key={`x${v}`} x={geo.sx(v)} y={H - 10} textAnchor="middle" fontSize="10.5" fill="var(--c-text3)">{xFormat(v)}</text>
        ))}
        <path d={geo.d} fill="none" stroke="var(--ft-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {showDots && geo.valid.map((p, i) => (
          <circle key={i} cx={geo.sx(p.x)} cy={geo.sy(p.y)} r="4" fill="var(--ft-accent)" stroke="var(--c-card)" strokeWidth="2" />
        ))}
        {markers.map((m, i) => {
          if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return null
          const c = MARK[m.kind]?.color ?? 'var(--c-text2)'
          const x = geo.sx(m.x), y = geo.sy(m.y)
          return (
            <g key={`m${i}`}>
              {m.kind === 'drain'
                ? <path d={`M${x - 6},${y - 5} L${x + 6},${y - 5} L${x},${y + 6} Z`} fill={c} stroke="var(--c-card)" strokeWidth="2" />
                : <path d={`M${x - 6},${y + 5} L${x + 6},${y + 5} L${x},${y - 6} Z`} fill={c} stroke="var(--c-card)" strokeWidth="2" />}
              {m.label && <text x={x} y={m.kind === 'drain' ? y + 18 : y - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--c-text2)">{m.label}</text>}
            </g>
          )
        })}
        {hover && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="var(--c-text3)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hx} cy={hy} r="5" fill="var(--ft-accent)" stroke="var(--c-card)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div role="status" style={{
          position: 'absolute', top: 2, left: `${tipLeft}%`, transform: 'translateX(-50%)', pointerEvents: 'none',
          background: 'var(--c-card)', border: '1px solid var(--c-border2)', borderRadius: 8, padding: '5px 9px',
          boxShadow: '0 6px 18px rgba(0,0,0,.18)', fontSize: 11.5, whiteSpace: 'nowrap', color: 'var(--c-text1)',
        }}>
          <div style={{ fontWeight: 800 }}>{tipY(hover.y, hover)}</div>
          <div style={{ color: 'var(--c-text3)' }}>{tipX(hover.x, hover)}</div>
        </div>
      )}
    </div>
  )
}

export { MARK as FUEL_MARKS }
