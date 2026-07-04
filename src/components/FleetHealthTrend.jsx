import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceDot, ResponsiveContainer,
} from 'recharts'
import { computeHealthScore, scoreLabel } from '../utils/healthScore'

const MONTHS  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
// Jan-May are fixed historical reference points; Jun is always the live score
const HISTORY = [65, 68, 71, 69, 72]

function buildData(currentScore) {
  return MONTHS.map((month, i) => ({
    month,
    score: i < HISTORY.length ? HISTORY[i] : (currentScore || 72),
  }))
}

export default function FleetHealthTrend({ fleetData, heroMode = false }) {
  const score      = computeHealthScore(fleetData)
  const data       = buildData(score)
  const lastPoint  = data[data.length - 1]
  const trendLabel = scoreLabel(score)

  const isDark = heroMode

  const cardStyle = isDark
    ? {
        background: 'transparent',
        borderRadius: 20,
        padding: '20px 20px 12px',
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        background: 'var(--c-card)',
        border: '1px solid var(--c-border2)',
        borderRadius: 16,
        padding: '20px 20px 12px',
      }

  const title1  = isDark ? '#ffffff'                 : 'var(--c-text1)'
  const title2  = isDark ? 'rgba(255,255,255,0.45)' : 'var(--c-text3)'
  const axisClr = isDark ? 'rgba(255,255,255,0.5)'  : 'var(--c-text3)'
  const dotFill = isDark ? '#0b1f44'                 : '#ffffff'

  return (
    <div style={cardStyle}>

      {/* Title row (ClyHealth TelomerePanel order: title first) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h3 style={{
          fontSize: 15, fontWeight: 700, color: title1,
          margin: 0, fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          Vehicle Activity
        </h3>
        <span style={{ fontSize: 11, color: title2, fontFamily: 'Inter, system-ui, sans-serif' }}>
          6-month performance
        </span>
      </div>

      {/* Metric value + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 4 }}>
        <span style={{ color: title1, fontSize: 22, fontWeight: 600, lineHeight: 1, fontFamily: 'Inter, system-ui, sans-serif' }}>
          {score}
        </span>
        <span style={{ color: title2, fontSize: 13, marginBottom: 2, fontFamily: 'Inter, system-ui, sans-serif' }}>
          / 100
        </span>
        <span style={{
          marginLeft: 'auto',
          display: 'flex', alignItems: 'center', gap: 4,
          color: '#fbbf24', fontSize: 12, fontWeight: 500,
          background: 'rgba(251,191,36,0.1)',
          padding: '2px 8px', borderRadius: 20,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', display: 'inline-block', flexShrink: 0 }} />
          {trendLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.15)', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%', width: `${score}%`, borderRadius: 999,
          background: 'linear-gradient(to right, #38bdf8, #bae6fd)',
          transition: 'width 0.7s ease',
        }} />
      </div>

      <p style={{ fontSize: 11, color: title2, margin: '0 0 8px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        Fleet activity across the last 6 months
      </p>

      {/* Line chart (ClyHealth TelomerePanel style — no fill area) */}
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid
              strokeDasharray="2 3"
              stroke="rgba(255,255,255,0.15)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{ fill: axisClr, fontSize: 10, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 100]}
              tickCount={5}
              tick={{ fill: axisClr, fontSize: 10, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={false}
              tickLine={false}
              width={35}
            />

            <Line
              type="monotone"
              dataKey="score"
              stroke="#7dd3fc"
              strokeWidth={2}
              dot={{ r: 3, fill: dotFill, stroke: '#7dd3fc', strokeWidth: 1.5 }}
              activeDot={{ r: 5, fill: '#7dd3fc', stroke: isDark ? '#fff' : 'var(--c-card)', strokeWidth: 1.5 }}
              isAnimationActive={false}
            />

            {/* Highlighted dot for the current (Jun) data point */}
            <ReferenceDot
              x={lastPoint.month}
              y={lastPoint.score}
              r={5}
              fill="#3da9fc"
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

    </div>
  )
}
