import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'

/**
 * The fleet's recorded figures on the original six-axis chart
 * (hooks/useDashboardStats.js). The client prefers this shape (2026-11-11):
 *   Uptime       vehicles that reported in the last 15 minutes
 *   Efficiency   moving share of today's engine-on time (the rest is idling)
 *   Safety       this month's alerts per 100 km, as a 0-100 score
 *   Response     trackers that reported at all in the last 24 hours
 *   Activity     vehicle-days this month on which the vehicle drove
 *   Maintenance  reminders not due or overdue (only with reminder rules set)
 * An axis with nothing recorded sits at 0 and is named under the chart,
 * rather than being given an invented value.
 */
function axesOf(stats) {
  return [
    ['Uptime', stats?.uptime],
    ['Efficiency', stats?.efficiency],
    ['Safety', stats?.safety],
    ['Response', stats?.responded],
    ['Activity', stats?.utilization],
    ['Maintenance', stats?.maintenance?.compliance],
  ].map(([metric, v]) => ({ metric, value: Number.isFinite(v) ? v : 0, missing: !Number.isFinite(v) }))
}

// ClyHealth AgePanel dot style: filled highlight for top value, dark-fill ring for rest
function ClyDot({ cx, cy, payload }) {
  const isHighest = payload && payload.value >= 75
  if (isHighest) {
    return <circle key={payload.metric} cx={cx} cy={cy} r={5} fill="#5eb8ff" />
  }
  return <circle key={payload.metric} cx={cx} cy={cy} r={3} fill="#0b1f44" stroke="#5eb8ff" strokeWidth={2} />
}

export default function FleetPerformanceRadar({ stats, heroMode = false }) {
  const data = axesOf(stats)
  const missing = data.filter(d => d.missing).map(d => d.metric)
  // A radar needs three recorded corners; with fewer the chart says nothing.
  const enough = data.length - missing.length >= 3

  // In the hero the radar gets the same glass treatment as the Trips card on
  // the opposite side, so the two flanks of the gauge read as a matched pair.
  const cardStyle = heroMode
    ? {
        padding: '13px 15px',
        height: '100%',
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
    <div className={heroMode ? 'ft-glass' : undefined} style={cardStyle}>
      <h3 style={{
        fontSize: heroMode ? 13 : 15, fontWeight: 600, color: '#ffffff',
        letterSpacing: '-0.01em',
        margin: '0 0 2px', fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        Fleet Performance
      </h3>
      <p style={{ fontSize: 10, lineHeight: 1.35, color: 'rgba(255,255,255,0.55)', margin: '0 0 6px' }}>
        {enough
          ? 'Multi-axis health across 6 dimensions'
          : stats?.loading ? 'Loading fleet figures…' : 'Not enough recorded data yet'}
      </p>

      {/* In the hero the chart grows to fill the row, so the title lines up
          with the top of the cards either side and the block has no dead
          space under it. Standalone it keeps its fixed height. */}
      <div style={heroMode ? { flex: '1 1 auto', minHeight: 170 } : { height: 220 }}>
        {enough && <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            data={data}
            outerRadius="84%"
            margin={{ top: 18, right: 42, bottom: 12, left: 42 }}
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
        </ResponsiveContainer>}
      </div>
      {enough && missing.length > 0 && (
        <p style={{ fontSize: 9.5, lineHeight: 1.3, color: 'rgba(255,255,255,0.45)', margin: '4px 0 0' }}>
          No data yet: {missing.join(', ')}
        </p>
      )}
    </div>
  )
}
