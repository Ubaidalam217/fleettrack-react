import { useState, useEffect, useRef } from 'react'
import { computeHealthScore } from '../utils/healthScore'
import { computeUptime } from '../utils/fleetAnalytics'

// Geometry - thick semicircle dome, both ends at the bottom, opening downward
const CX = 300   // center x of the 600-wide viewBox
const CY = 330   // center y - both arc endpoints sit at this height
const R  = 140   // arc radius
const ARC_W = 24 // arc stroke width

// Badge rings - two large dotted rings around the arc
const RING_IN  = 230
const RING_OUT = 285

// y = CY - r*sin(deg): deg 180 is the left end, deg 0 the right end, deg 90 the dome peak
function polar(r, deg) {
  const rad = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) }
}

// Track - left end to right end, sweep=1 always winds through the top of the dome
const TRACK_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`

// Inner ring: fine dots every 2 degrees; outer ring: dense bezel ticks every 1.5 degrees
const RING_DOT_DEGS = []
for (let d = 180; d >= 0; d -= 2) RING_DOT_DEGS.push(d)
const BEZEL_TICK_DEGS = []
for (let d = 180; d >= 0; d -= 1.5) BEZEL_TICK_DEGS.push(d)

// Pure SVG icons centered at (0,0), drawn in a +/-7 coordinate space
function BadgeSvg({ type, color }) {
  const sc = { fill: 'none', stroke: color, strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (type === 'shield')
    return <path d="M0-6.5 5.5-3.5v4.5C5.5 4 3 6.5 0 7.5c-3-1-5.5-3.5-5.5-7V-3.5z" {...sc} />
  if (type === 'pulse')
    return <path d="M-7 0h2.5l2 5.5 3.5-11 2 5.5h7" {...sc} />
  if (type === 'wrench')
    return <path d="M6.5-4.5a4.5 4.5 0 01-6 5.5l-4.5 4.5a1.8 1.8 0 01-2.5-2.5L-2 -1.5a4.5 4.5 0 015.5-6l-2.5 2.5.5 2.5 2.5.5z" {...sc} />
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

// Fleet metric badges on the two concentric rings - uniform light blue,
// left/right pairs are exact mirrors: 130/50 on the outer ring, 158/22 on the inner
const BADGE_BLUE = '#7dd3fc'

// Vehicle Uptime comes straight from live telemetry (% of fleet that sent
// data in the last 15 min). Scheduled maintenance, fuel burn, safety events
// and trip completion have no Flespi data source on this plan, so they're
// flagged with a unit-suffix asterisk (see disclaimer under the gauge)
// instead of being presented as live numbers.
function buildFleetItems(fleetData) {
  const vehicles = fleetData?.vehicles ?? []
  const hasLive  = vehicles.length > 0
  const uptime   = hasLive ? String(computeUptime(vehicles)) : '-'

  return [
    { label: 'Maintenance Due', value: '2',    unit: 'veh*', icon: 'wrench', deg:  90, r: RING_OUT },
    { label: 'Vehicle Uptime',  value: uptime, unit: '%',    icon: 'pulse',  deg: 130, r: RING_OUT },
    { label: 'Fuel Efficiency', value: '17.3', unit: 'km/L*', icon: 'fuel',   deg:  50, r: RING_OUT },
    { label: 'Safety Score',    value: '96.5', unit: '%*',   icon: 'shield', deg: 158, r: RING_IN  },
    { label: 'Trips On-time',   value: '83',   unit: '%*',   icon: 'rocket', deg:  22, r: RING_IN  },
  ]
}

export default function FleetHealthGauge({ isDark, fleetData, loading, heroMode = false }) {
  const score = (loading && !fleetData) ? 0 : computeHealthScore(fleetData)
  const fleetItems = buildFleetItems(fleetData)

  // Animate dome fill on score change - 1200ms ease-in-out
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

  // Fill grows from the left end (180) toward the right end (0) as score rises
  const valueDeg = 180 - (animScore / 100) * 180
  const fillEnd  = polar(R, valueDeg)
  const fillPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${fillEnd.x.toFixed(2)} ${fillEnd.y.toFixed(2)}`

  // Pin/teardrop marker standing on the arc at the fill tip, perpendicular
  // to the arc: head on the arc line, thin stem pointing inward toward center
  const vRad   = (valueDeg * Math.PI) / 180
  const tan    = { x: Math.sin(vRad), y: Math.cos(vRad) }  // tangent, for the teardrop base
  const pinHead = polar(R, valueDeg)        // head sits on the arc line
  const pinEnd  = polar(R - 18, valueDeg)   // stem end, inward along the radial
  const dropTip = polar(R - 12, valueDeg)   // teardrop point merging into the stem
  const dropL   = { x: pinHead.x + tan.x * 4, y: pinHead.y + tan.y * 4 }
  const dropR   = { x: pinHead.x - tan.x * 4, y: pinHead.y - tan.y * 4 }

  const cardStyle = heroMode
    ? { background: 'transparent', padding: 0 }
    : {
        background: 'var(--c-card)',
        border: '1px solid var(--c-border2)',
        borderRadius: 16,
        padding: '16px 20px 0',
      }

  return (
    <div style={cardStyle}>

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

      <svg
        viewBox="0 0 600 400"
        width="100%"
        overflow="visible"
        style={{ maxWidth: 680, display: 'block' }}
      >
        <defs>
          <linearGradient id="healthGradient" gradientUnits="userSpaceOnUse" x1={CX - R} y1={CY} x2={CX + R} y2={CY}>
            <stop offset="0%" stopColor="#6ec6ff" />
            <stop offset="100%" stopColor="#1e88e5" />
          </linearGradient>
          <radialGradient id="innerDisc" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(120,170,255,0.28)" />
            <stop offset="100%" stopColor="rgba(80,130,230,0.10)" />
          </radialGradient>
          <radialGradient id="powerGlow" cx="50%" cy="80%" r="60%">
            <stop offset="0%" stopColor="rgba(60,100,255,0.10)" />
            <stop offset="100%" stopColor="rgba(60,100,255,0)" />
          </radialGradient>
          <filter id="pointerGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background glow */}
        <circle cx={CX} cy={CY} r="300" fill="url(#powerGlow)" />

        {/* Inner ring - fine traceable dots */}
        {RING_DOT_DEGS.map((d, i) => {
          const a = polar(RING_IN, d)
          return <circle key={i} cx={a.x.toFixed(1)} cy={a.y.toFixed(1)} r="0.8" fill="rgba(255,255,255,0.25)" />
        })}

        {/* Outer bezel ring - dense fine ticks like a watch dial */}
        {BEZEL_TICK_DEGS.map((d, i) => {
          const t1 = polar(RING_OUT - 3, d)
          const t2 = polar(RING_OUT + 3, d)
          return <line key={i} x1={t1.x.toFixed(1)} y1={t1.y.toFixed(1)} x2={t2.x.toFixed(1)} y2={t2.y.toFixed(1)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
        })}

        {/* Lit disc inside the dome - behind the score text, above the background */}
        <circle cx={CX} cy={CY} r={R - 20} fill="url(#innerDisc)" />

        {/* Track + fill - thick dome arc */}
        <path d={TRACK_PATH} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={ARC_W} strokeLinecap="round" />
        {animScore > 0 && (
          <path d={fillPath} fill="none" stroke="url(#healthGradient)" strokeWidth={ARC_W} strokeLinecap="round" />
        )}

        {/* Pin marker at the fill tip: white teardrop head on the arc, stem pointing inward */}
        {animScore > 0 && (
          <g filter="url(#pointerGlow)">
            <line
              x1={pinHead.x.toFixed(1)} y1={pinHead.y.toFixed(1)}
              x2={pinEnd.x.toFixed(1)}  y2={pinEnd.y.toFixed(1)}
              stroke="#ffffff" strokeWidth="2" strokeLinecap="round"
            />
            <polygon
              points={`${dropL.x.toFixed(1)},${dropL.y.toFixed(1)} ${dropR.x.toFixed(1)},${dropR.y.toFixed(1)} ${dropTip.x.toFixed(1)},${dropTip.y.toFixed(1)}`}
              fill="#ffffff"
            />
            <circle cx={pinHead.x.toFixed(1)} cy={pinHead.y.toFixed(1)} r="5" fill="#ffffff" />
          </g>
        )}

        {/* Center text - large clean number centered in the dome opening, like the demo */}
        <text x={CX} y={CY - 55} textAnchor="middle" fontSize="70" fontWeight="400" fill="#ffffff" fontFamily="Inter, system-ui, sans-serif">
          {animScore}<tspan fontSize="22" fontWeight="400" dy="-28">th</tspan>
        </text>
        <text x={CX} y={CY - 15} textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.75)" fontFamily="Inter, system-ui, sans-serif">
          Percentile
        </text>
        <text x={CX} y={CY + 40} textAnchor="middle" fontSize="15" fontWeight="600" fill="#ffffff" fontFamily="Inter, system-ui, sans-serif">
          Your fleet performance
        </text>

        {/* Badges: connector dot exactly on the ring at the badge angle, plain light
            blue icon just outside the dot, value + label below - demo style */}
        {fleetItems.map((item, i) => {
          const p    = polar(item.r, item.deg)        // dot on the ring curve
          const icon = polar(item.r + 20, item.deg)   // icon slightly outside the ring
          return (
            <g key={i}>
              <circle cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3" fill="#9fd8ff" opacity="0.9" />
              <g transform={`translate(${icon.x.toFixed(1)},${icon.y.toFixed(1)}) scale(1.29)`}>
                <BadgeSvg type={item.icon} color={BADGE_BLUE} />
              </g>
              <text
                x={p.x.toFixed(1)}
                y={(p.y + 16).toFixed(1)}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="14"
                fontWeight="bold"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {item.value}<tspan fill="rgba(255,255,255,0.55)" fontSize="9"> {item.unit}</tspan>
              </text>
              <text
                x={p.x.toFixed(1)}
                y={(p.y + 28).toFixed(1)}
                textAnchor="middle"
                fill="rgba(255,255,255,0.55)"
                fontSize="9"
                letterSpacing="1.2"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {item.label.toUpperCase()}
              </text>
            </g>
          )
        })}

      </svg>

      <p style={{
        fontSize: 9, textAlign: 'center', margin: heroMode ? '2px 0 0' : '4px 0 10px',
        color: heroMode ? 'rgba(255,255,255,0.4)' : 'var(--c-text3)', fontStyle: 'italic',
      }}>
        * Estimated: fuel, safety and trip telemetry require Phase 2 backend integration
      </p>

    </div>
  )
}
