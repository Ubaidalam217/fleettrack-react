import { AreaChart, Area, XAxis, YAxis, ReferenceDot, ResponsiveContainer } from 'recharts'
import EstimatedBadge from './EstimatedBadge'

// 30-day sample distance curve (km per day) - used as chart shape and as
// fallback when live Flespi data is unavailable
const SAMPLE_DAYS = [
  190, 205, 215, 200, 185, 175, 190, 220, 250, 240,
  225, 235, 260, 300, 340, 380, 420, 440, 430, 400,
  370, 350, 355, 375, 400, 420, 440, 460, 480, 510,
]
const SAMPLE_DATA = SAMPLE_DAYS.map((km, i) => ({ day: i + 1, km }))
const SAMPLE_TOTAL = 12450

function activityLevel(fleetData) {
  if (!fleetData?.total) return { text: 'Medium', dot: '#f59e0b' }
  const ratio = fleetData.active / fleetData.total
  if (ratio >= 0.6)  return { text: 'High',   dot: '#22c55e' }
  if (ratio >= 0.25) return { text: 'Medium', dot: '#f59e0b' }
  return { text: 'Low', dot: '#94a3b8' }
}

export default function FleetTripsCard({ fleetData }) {
  // Real distance from Flespi (daily estimate, extrapolated to the 30-day window);
  // falls back to sample data when the feed is unavailable
  const dailyKm = fleetData?.totalDistance
  const totalKm = dailyKm ? Math.round(dailyKm * 30) : SAMPLE_TOTAL
  const level   = activityLevel(fleetData)
  const lastPoint = SAMPLE_DATA[SAMPLE_DATA.length - 1]
  const barPct  = Math.min(100, Math.round((totalKm / 15000) * 100))

  return (
    <div style={{
      background: 'rgba(10,25,60,0.6)',
      borderRadius: 16,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* Big number + activity pill */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>
          {totalKm.toLocaleString()}
          <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>km</span>
        </div>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(255,255,255,0.92)', color: '#0a1f4a',
          fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '3px 10px',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: level.dot, display: 'inline-block' }} />
          {level.text}
        </span>
      </div>

      {/* Thin blue progress bar */}
      <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          height: '100%', width: `${barPct}%`, borderRadius: 999,
          background: 'linear-gradient(to right, #4fc3f7, #2196f3)',
          transition: 'width 0.7s ease',
        }} />
      </div>

      {/* Title + subtitle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 4px' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', margin: 0 }}>
          Trips &amp; Distance
        </h3>
        <EstimatedBadge dark />
      </div>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: '0 0 2px' }}>
        Estimated kilometers driven, projected from live running/stopped vehicle counts
      </p>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', margin: '0 0 10px' }}>
        * Precise odometer data requires Flespi plan upgrade (Phase 2)
      </p>

      {/* Smooth blue area chart */}
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={SAMPLE_DATA} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tripsAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(79,195,247,0.35)" />
                <stop offset="100%" stopColor="rgba(79,195,247,0)" />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              ticks={[5, 10, 15, 20, 25, 30]}
              tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 600]}
              ticks={[0, 200, 400, 600]}
              tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Area
              type="monotone"
              dataKey="km"
              stroke="#4fc3f7"
              strokeWidth={2}
              fill="url(#tripsAreaFill)"
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={lastPoint.day}
              y={lastPoint.km}
              r={5}
              fill="#0a1f4a"
              stroke="#ffffff"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* View full report button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          style={{
            background: '#ffffff', color: '#0a1f4a',
            border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 600,
            padding: '7px 14px', cursor: 'pointer',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#e8f1ff'}
          onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
        >
          View full report &rsaquo;
        </button>
      </div>

    </div>
  )
}
