import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './FleetGauge.css'

/* ------------------------------------------------------------------
   Geometry.

   The viewBox is cropped tight around the drawing on all four sides: it
   starts just above the outer tick ring (which spans y=46 and x=30..470)
   and ends just below the centre readout, so the artwork fills its hero
   column instead of sitting inside a margin of dead space. VIEW_W :
   VIEW_H is mirrored by `aspect-ratio` in FleetGauge.css — keep in sync.
------------------------------------------------------------------- */
const VIEW_X = 14
const VIEW_Y = 42
const VIEW_W = 472
const VIEW_H = 235

const CX = 250
const CY = 270

const R_OUTER_TICKS = 220 // sparse dotted ring
const R_NODE_ARC = 155 // thin middle arc carrying the metric dots
const R_INNER_TICKS = 130 // dense tick ring
const R_GLOW = 116 // white radial wash behind the track
const R_TRACK = 104 // background track + blue progress arc
const R_LABEL = 178.6667 // where the metric label blocks sit

/** Degrees of arc kept clear at each end before the first/last metric. */
const LABEL_INSET = 20.4

const SWEEP_MS = 1200

/**
 * Needle triangle, pointing straight up from the hub at (CX, CY).
 * Its base sits at radius 85 — comfortably clear of the widest line of the
 * centre readout ("Your fleet performance", ~57 units half-width) — so at
 * percentile 0, where the needle lies flat along the baseline, it stops
 * short of the text instead of striking through it.
 */
const NEEDLE_POINTS = '247.5,185 252.5,186 250,156'

/* ---------------------------- helpers ---------------------------- */

/** Polar -> cartesian, 0deg = right, 90deg = straight up. */
function polar(radius, degrees) {
  const rad = (degrees * Math.PI) / 180
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) }
}

/** Left-to-right 180deg arc at the given radius. */
function semicircle(radius) {
  return `M ${CX - radius} ${CY} A ${radius} ${radius} 0 0 1 ${CX + radius} ${CY}`
}

/** SVG user units -> percentage of the container, for the HTML overlay layer. */
function toPercent({ x, y }) {
  return {
    left: `${((x - VIEW_X) / VIEW_W) * 100}%`,
    top: `${((y - VIEW_Y) / VIEW_H) * 100}%`,
  }
}

function clampPercentile(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function ordinalSuffix(value) {
  const n = Math.abs(Math.round(value))
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Eases `target` in over `duration` using requestAnimationFrame.
 *
 * Starts at 0, so the first real score sweeps up from the left stop. Every
 * later change eases from the value currently on screen, not from 0 — a
 * routine data refresh nudges the needle rather than replaying the intro,
 * and a change landing mid-sweep is picked up without snapping.
 */
function useSweep(target, duration) {
  const reduced = prefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const currentRef = useRef(reduced ? target : 0)
  const frameRef = useRef(0)

  useEffect(() => {
    if (reduced || duration <= 0) {
      currentRef.current = target
      setValue(target)
      return undefined
    }

    const from = currentRef.current
    const delta = target - from
    if (delta === 0) return undefined

    let startTs = null
    const step = (ts) => {
      if (startTs === null) startTs = ts
      const t = Math.min(1, (ts - startTs) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      const next = from + delta * eased
      currentRef.current = next
      setValue(next)
      if (t < 1) frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration, reduced])

  return value
}

/* --------------------------- component --------------------------- */

/**
 * @param percentile  0-100 composite score driving the arc + needle.
 * @param title       Caption under the percentile readout.
 * @param metrics     [{ label, value, unit, icon, estimated }] laid out
 *                    left-to-right along the arc. `estimated` appends the
 *                    "*" marker explained by `footnote`.
 * @param footnote    Small italic line under the gauge. Omit to hide it.
 */
export default function FleetGauge({
  percentile = 0,
  title = 'Your fleet performance',
  metrics = [],
  footnote = '',
  className = '',
  animate = true,
}) {
  // Unique per instance so two gauges on one page don't share a gradient id.
  const gradientId = `fg-glow-${useId().replace(/[:]/g, '')}`

  const target = clampPercentile(percentile)
  const value = useSweep(target, animate ? SWEEP_MS : 0)

  // Static arc paths — recomputed only if the geometry constants change.
  const paths = useMemo(
    () => ({
      outerTicks: semicircle(R_OUTER_TICKS),
      nodeArc: semicircle(R_NODE_ARC),
      innerTicks: semicircle(R_INNER_TICKS),
      track: semicircle(R_TRACK),
      glow: `M ${CX - R_GLOW} ${CY} A ${R_GLOW} ${R_GLOW} 0 0 1 ${CX + R_GLOW} ${CY} L ${CX} ${CY} Z`,
    }),
    [],
  )

  // Spread the metrics evenly along the middle arc. An explicit `angle` on an
  // item wins, so an individual marker can be pinned to an exact spot.
  const markers = useMemo(() => {
    const count = metrics.length
    const span = 180 - LABEL_INSET * 2

    return metrics.map((metric, index) => {
      const fallback =
        count <= 1 ? 90 : 180 - LABEL_INSET - (span * index) / (count - 1)
      const angle = Number.isFinite(metric.angle) ? metric.angle : fallback

      return {
        ...metric,
        angle,
        dot: polar(R_NODE_ARC, angle),
        pos: toPercent(polar(R_LABEL, angle)),
      }
    })
  }, [metrics])

  // 180deg of sweep maps to 100 percentile points; 0 = hard left, 100 = hard right.
  const needleAngle = (value - 50) * 1.8
  const displayed = Math.round(value)

  return (
    <div className={`fg-root ${className}`.trim()}>
      <div className="fg-gauge">
        {/* ---- Arcs, ticks and the blue progress track ---- */}
        <svg
          className="fg-layer"
          viewBox={`${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient
              id={gradientId}
              cx={CX}
              cy={CY}
              r="120"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Base center white glow */}
          <g className="fg-center-glow">
            <path d={paths.glow} fill={`url(#${gradientId})`} />
          </g>

          {/* 1. Outer dotted tick arc */}
          <path className="fg-outer-ticks" d={paths.outerTicks} />

          {/* 2. Node arc line + one dot per metric */}
          <g className="fg-node-arc-group">
            <path className="fg-node-arc-line" d={paths.nodeArc} />
            {markers.map((marker, index) => (
              <circle
                key={`${marker.label ?? 'node'}-${index}`}
                className="fg-node-dot"
                cx={marker.dot.x}
                cy={marker.dot.y}
                r="2.5"
              />
            ))}
          </g>

          {/* 3. Inner dense ticks arc */}
          <path className="fg-inner-ticks" d={paths.innerTicks} />

          {/* 4. Gauge track + blue progress arc */}
          <g className="fg-track-group">
            <path className="fg-track" d={paths.track} />
            <path
              className="fg-progress"
              d={paths.track}
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - value}
            />
          </g>

          {/* 5. Needle — always rendered, including while loading, where it
              rests at the 0 stop on the left of the baseline. */}
          <g transform={`rotate(${needleAngle} ${CX} ${CY})`}>
            <polygon className="fg-needle" points={NEEDLE_POINTS} />
          </g>
        </svg>

        {/* ---- Metric labels (HTML overlay) ---- */}
        <div className="fg-nodes">
          {markers.map((marker, index) => (
            <div
              key={`${marker.label ?? 'metric'}-${index}`}
              className="fg-metric"
              style={{ left: marker.pos.left, top: marker.pos.top }}
            >
              {marker.icon ? <div className="fg-icon-glow">{marker.icon}</div> : null}
              <div className="fg-metric-val">
                {marker.value}
                {marker.unit ? (
                  <span>
                    {' '}
                    {marker.unit}
                    {marker.estimated ? '*' : ''}
                  </span>
                ) : null}
              </div>
              <div className="fg-metric-lbl">{marker.label}</div>
            </div>
          ))}
        </div>

        {/* ---- Center readout ---- */}
        <div className="fg-center-info">
          <div className="fg-percentile-val">
            {displayed}
            <sup>{ordinalSuffix(displayed)}</sup>
          </div>
          <div className="fg-percentile-lbl">Percentile</div>
          <div className="fg-title">{title}</div>
        </div>

        {footnote ? <p className="fg-footnote">{footnote}</p> : null}
      </div>
    </div>
  )
}
