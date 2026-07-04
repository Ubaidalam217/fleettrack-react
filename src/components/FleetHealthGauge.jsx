import { useState, useEffect, useRef } from 'react'
import { computeHealthScore, scoreLabel } from '../utils/healthScore'

// ── Geometry — large speedometer dome, both ends at the viewBox bottom ──
const CX = 300   // composition center x (horizontal midpoint of 600-wide viewBox)
const CY = 370   // composition center y — arc endpoints sit exactly at this height
const R  = 280   // arc radius — left end (CX-R, CY), right end (CX+R, CY)

// y = CY - r*sin(deg): deg 180 is the left end, deg 0 the right end, deg 90 the dome peak
function polar(r, deg) {
  const rad = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) }
}

// Track — M (CX-R,CY) A R R 0 0 1 (CX+R,CY): sweep=1 from the left point to the right
// point always winds through the top, the exact unambiguous SVG arc the spec calls for.
const TRACK_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

const RING_OUTER = []
for (let d = 180; d >= 0; d -= 5) RING_OUTER.push(d)

const RING_DOTS = []
for (let d = 180; d >= 0; d -= 10) RING_DOTS.push(d)

const RING_INNER = []
for (let d = 180; d >= 0; d -= 3) RING_INNER.push(d)

// ── Pure SVG icons centered at (0,0), ~14px target size ──────────
// All paths are drawn in a ±7 coordinate space
function BadgeSvg({ type, color }) {
  const sc = { fill: 'none', stroke: color, strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (type === 'shield')
    return <path d="M0-6.5 5.5-3.5v4.5C5.5 4 3 6.5 0 7.5c-3-1-5.5-3.5-5.5-7V-3.5z" {...sc} />
  if (type === 'pulse')
    return <path d="M-7 0h2.5l2 5.5 3.5-11 2 5.5h7" {...sc} />
  if (type === 'snowflake')
    return (
      <>
        <line x1="0" y1="-7" x2="0" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        <line x1="-6" y1="-3.5" x2="6" y2="3.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        <line x1="-6" y1="3.5" x2="6" y2="-3.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </>
    )
  if (type === 'fuel')
    return <path d="M0-7c4 5 6 7 6 9.5A6 6 0 01-6 2.5C-6 0-4-2 0-7z" {...sc} />
  // rocket (default)
  return (
    <>
      <path d="M0-7c2.5 2 3.5 5.5 3 9l-1 2.5h-4l-1-2.5c-.5-3.5.5-7 3-9z" {...sc} />
      <path d="M-3 2l-2.5 3.5M3 2l2.5 3.5M-1.3 4h2.6l.6 3.5h-3.8z" {...sc} />
    </>
  )
}

// ── Fleet metrics — badges spread across the dome's 180° sweep ────
const FLEET_ITEMS = [
  { label: 'Maintenance Due', value: '2',    unit: 'veh', icon: 'snowflake', color: '#60c0ff', deg:  90, r: 180 },
  { label: 'Vehicle Uptime',  value: '94.2', unit: '%',   icon: 'pulse',     color: '#60ffa0', deg: 135, r: 180 },
  { label: 'Fuel Efficiency', value: '17.3', unit: 'km/L',icon: 'fuel',      color: '#60c0ff', deg:  45, r: 180 },
  { label: 'Safety Score',    value: '96.5', unit: '%',   icon: 'shield',    color: '#a060ff', deg: 155, r: 180 },
  { label: 'Trips On-time',   value: '83',   unit: '%',   icon: 'rocket',    color: '#ff9060', deg:  25, r: 180 },
]

export default function FleetHealthGauge({ isDark, fleetData, loading, heroMode = false }) {
  const score = (loading && !fleetData) ? 0 : computeHealthScore(fleetData)

  // ── Animate dome fill on score change — 1200ms ease-in-out ─────
  const [animScore, setAnimScore] = useState(0)
  const rafRef = useRef(null)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (score === 0) { setAnimScore(0); return }
    const start = performance.now()
    const prev  = animScore
    const tick  = now => {
      const p    = Math.min((now - start) / 1200, 1)
      const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      setAnimScore(Math.round(prev + (score - prev) * ease))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [score]) // eslint-disable-line react-hooks/exhaustive-deps

  // fillEndAngle: 180 (empty, left) shrinking toward 0 (full, right) as score rises
  const valueDeg  = 180 - (animScore / 100) * 180
  const fillEnd   = polar(R, valueDeg)
  // Swept angle is score/100*180, which never exceeds 180 — always the minor arc.
  const fillPath  = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${fillEnd.x.toFixed(2)} ${fillEnd.y.toFixed(2)}`

  // Pointer arrow riding the fill edge of the dome
  const POINTER_TIP_R    = 272
  const POINTER_BASE_R   = 252
  const POINTER_BASE_DEG = 4
  const tip = polar(POINTER_TIP_R, valueDeg)
  const bL  = polar(POINTER_BASE_R, valueDeg + POINTER_BASE_DEG)
  const bR  = polar(POINTER_BASE_R, valueDeg - POINTER_BASE_DEG)

  // Status pill
  const pillText  = score >= 75 ? 'GOOD' : score >= 50 ? 'FAIR' : 'POOR'
  const pillBg    = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'

  const cardStyle = heroMode
    ? {
        background: 'transparent',
        padding: 0,
      }
    : {
        background: 'var(--c-card)',
        border: '1px solid var(--c-border2)',
        borderRadius: 16,
        padding: '16px 20px 0',
      }

  return (
    <div style={cardStyle}>

      {/* Card header — hidden in heroMode (top badge floats above SVG in hero gradient) */}
      {!heroMode && (
        <div style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text1)', margin: 0 }}>
            Fleet Health Score
          </h3>
          <p style={{ fontSize: 12, color: 'var(--c-text3)', margin: '2px 0 0' }}>
            Overall fleet condition assessment
          </p>
        </div>
      )}

      {/* SVG gauge — large speedometer dome with badges on concentric outer rings */}
        <svg
          viewBox="0 0 600 380"
          width="100%"
          overflow="visible"
          style={{ maxWidth: 680, display: 'block' }}
        >
          <defs>
            <linearGradient id="healthGradient" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="580" y2="0">
              <stop offset="0%" stopColor="#00c6ff" />
              <stop offset="100%" stopColor="#5b5bff" />
            </linearGradient>
            <radialGradient id="powerGlow" cx="50%" cy="97%" r="60%">
              <stop offset="0%" stopColor="rgba(60,100,255,0.10)" />
              <stop offset="100%" stopColor="rgba(60,100,255,0)" />
            </radialGradient>
            <pattern id="scanlines" width="1" height="8" patternUnits="userSpaceOnUse">
              <rect width="1" height="2" fill="rgba(255,255,255,0.02)" />
            </pattern>
            <filter id="pointerGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background accents — radial glow + faint HUD scan lines */}
          <circle cx={CX} cy={CY} r="300" fill="url(#powerGlow)" />
          <rect x="0" y="0" width="600" height="380" fill="url(#scanlines)" />

          {/* Outer ring — fine ticks, every 5°, upper dome sweep only */}
          {RING_OUTER.map((d, i) => {
            const p1 = polar(302, d)
            const p2 = polar(310, d)
            return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
          })}

          {/* Mid ring — dot ring, every 10° */}
          {RING_DOTS.map((d, i) => {
            const p = polar(298, d)
            return <circle key={i} cx={p.x} cy={p.y} r="2" fill="rgba(255,255,255,0.4)" />
          })}

          {/* Inner ring — fine ticks, every 3° */}
          {RING_INNER.map((d, i) => {
            const p1 = polar(286, d)
            const p2 = polar(290, d)
            return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          })}

          {/* Track + fill */}
          <path d={TRACK_PATH} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="16" strokeLinecap="round" />
          {animScore > 0 && (
            <path d={fillPath} fill="none" stroke="url(#healthGradient)" strokeWidth="16" strokeLinecap="round" />
          )}

          {/* Pointer arrow */}
          {animScore > 0 && (
            <polygon
              filter="url(#pointerGlow)"
              points={`${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${bL.x.toFixed(1)},${bL.y.toFixed(1)} ${bR.x.toFixed(1)},${bR.y.toFixed(1)}`}
              fill="#ffffff"
            />
          )}

          {/* Status pill */}
          <rect x={CX - 32} y={230 - 13} width="64" height="26" rx="13" fill={pillBg} />
          <text
            x={CX} y="230"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#ffffff"
            fontSize="11"
            fontWeight="700"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {pillText}
          </text>

          {/* Center text — cradled inside the dome */}
          <text x={CX} y="295" textAnchor="middle" fontSize="72" fontWeight="800" fill="#ffffff" fontFamily="Inter, system-ui, sans-serif">
            {animScore}<tspan fontSize="26" dy="-32">th</tspan>
          </text>
          <text x={CX} y="332" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.7)" fontFamily="Inter, system-ui, sans-serif">
            Percentile
          </text>
          <text x={CX} y="352" textAnchor="middle" fontSize="13" fontWeight="500" fill="#ffffff" fontFamily="Inter, system-ui, sans-serif">
            Your fleet performance
          </text>

          {/* 5 badges — spread on concentric outer rings, no filled backgrounds */}
          {FLEET_ITEMS.map((item, i) => {
            const p    = polar(item.r, item.deg)
            const dot  = polar(310, item.deg)
            return (
              <g key={i}>
                {/* Connector dot on the outer tick ring */}
                <circle cx={dot.x} cy={dot.y} r="3" fill={item.color} />
                <g transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}>
                  <g transform="translate(0,-16) scale(1.14)">
                    <BadgeSvg type={item.icon} color={item.color} />
                  </g>
                  <text
                    y="14"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="15"
                    fontWeight="bold"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {item.value}<tspan fill="rgba(255,255,255,0.5)" fontSize="10"> {item.unit}</tspan>
                  </text>
                  <text
                    y="28"
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.5)"
                    fontSize="9"
                    letterSpacing="1.5"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {item.label.toUpperCase()}
                  </text>
                </g>
              </g>
            )
          })}

        </svg>

    </div>
  )
}
