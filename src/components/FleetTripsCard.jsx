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
    // Glass, not a solid slab: a white/blue tint over backdrop-blur lets the
    // hero gradient read straight through, so the card nests into the panel
    // instead of sitting on top of it. height:100% + a flex-growing chart so
    // the card fills the hero row rather than dictating its height.
    <div className="ft-glass" style={{
      padding: '13px 15px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* Big number + activity pill */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: '#ffffff', lineHeight: 1, letterSpacing: '-0.02em' }}>
          {totalKm.toLocaleString()}
          <span style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>km</span>
        </div>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(255,255,255,0.14)', color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.2)',
          fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: '2px 9px',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: level.dot, display: 'inline-block', boxShadow: `0 0 6px ${level.dot}` }} />
          {level.text}
        </span>
      </div>

      {/* Thin blue progress bar */}
      <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden', marginBottom: 9 }}>
        <div style={{
          height: '100%', width: `${barPct}%`, borderRadius: 999,
          background: 'linear-gradient(to right, #7dd3fc, #38bdf8)',
          boxShadow: '0 0 10px rgba(56,189,248,0.7)',
          transition: 'width 0.7s ease',
        }} />
      </div>

      {/* Title + subtitle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 2px' }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
          Trips &amp; Distance
        </h3>
        <EstimatedBadge dark />
      </div>
      <p style={{ fontSize: 10, lineHeight: 1.35, color: 'rgba(255,255,255,0.55)', margin: '0 0 1px' }}>
        Estimated kilometers driven, projected from live running/stopped vehicle counts
      </p>
      <p style={{ fontSize: 9, lineHeight: 1.3, color: 'rgba(255,255,255,0.38)', fontStyle: 'italic', margin: '0 0 4px' }}>
        * Precise odometer data requires Flespi plan upgrade (Phase 2)
      </p>

      {/* Smooth blue area chart — takes whatever vertical room is left */}
      <div style={{ flex: '1 1 auto', minHeight: 80 }}>
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
              r={4.5}
              fill="#0a1f4a"
              stroke="#ffffff"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* View full report button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          style={{
            background: 'rgba(255,255,255,0.95)', color: '#0a1f4a',
            border: '1px solid rgba(255,255,255,0.5)', borderRadius: 8,
            fontSize: 11, fontWeight: 600,
            padding: '5px 11px', cursor: 'pointer',
            fontFamily: 'Inter, system-ui, sans-serif',
            boxShadow: '0 4px 14px -6px rgba(3,14,40,0.8)',
            transition: 'background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#ffffff'
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 8px 20px -8px rgba(3,14,40,0.9)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.95)'
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.boxShadow = '0 4px 14px -6px rgba(3,14,40,0.8)'
          }}
        >
          View full report &rsaquo;
        </button>
      </div>

    </div>
  )
}
