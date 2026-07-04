import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import { computeFleetMetrics } from '../utils/fleetMetrics'

const AXES = ['Uptime', 'Efficiency', 'Safety', 'Response', 'Activity', 'Maintenance']

// ClyHealth AgePanel dot style: filled highlight for top value, dark-fill ring for rest
function ClyDot({ cx, cy, payload }) {
  const isHighest = payload && payload.value >= 75
  if (isHighest) {
    return <circle key={payload.metric} cx={cx} cy={cy} r={5} fill="#5eb8ff" />
  }
  return <circle key={payload.metric} cx={cx} cy={cy} r={3} fill="#0b1f44" stroke="#5eb8ff" strokeWidth={2} />
}

export default function FleetPerformanceRadar({ fleetData, heroMode = false }) {
  const metrics = computeFleetMetrics(fleetData)
  const data = AXES.map(metric => ({
    metric,
    value: metrics[metric.toLowerCase()] ?? 60,
  }))

  const cardStyle = heroMode
    ? {
        background: 'transparent',
        borderRadius: 20,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        background: 'linear-gradient(135deg, rgba(10,31,74,0.95) 0%, rgba(14,42,94,0.95) 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20,
        padding: '24px 28px',
        minHeight: 400,
      }

  return (
    <div style={cardStyle}>
      <h3 style={{
        fontSize: 15, fontWeight: 700, color: '#ffffff',
        margin: '0 0 4px', fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        Fleet Performance
      </h3>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', margin: '0 0 8px' }}>
        Multi-axis health across 6 dimensions
      </p>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={data}
            outerRadius="80%"
            margin={{ top: 30, right: 60, bottom: 30, left: 60 }}
          >
            {/* No gradient or glow — ClyHealth uses a plain flat fill */}
            <PolarGrid
              stroke="rgba(255,255,255,0.18)"
              gridType="polygon"
            />

            <PolarAngleAxis
              dataKey="metric"
              tick={{
                fill: 'rgba(255,255,255,0.55)',
                fontSize: 11,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
              tickLine={false}
            />

            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tickCount={5}
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={false}
              tickLine={false}
            />

            <Radar
              dataKey="value"
              stroke="#5eb8ff"
              strokeWidth={2}
              fill="#5eb8ff"
              fillOpacity={0.15}
              dot={<ClyDot />}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
