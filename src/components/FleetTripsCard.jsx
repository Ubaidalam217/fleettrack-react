import { useNavigate } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, ReferenceDot, ResponsiveContainer, Tooltip } from 'recharts'

/**
 * Kilometres the fleet drove this month, day by day — the Daywise Distance
 * report's numbers (hooks/useDashboardStats.js), so this card and that report
 * always agree. The bar compares the month so far with last month's total.
 */

function activityLevel(fleetData) {
  if (!fleetData?.total) return null
  const ratio = fleetData.active / fleetData.total
  if (ratio >= 0.6)  return { text: 'High',   dot: '#22c55e' }
  if (ratio >= 0.25) return { text: 'Medium', dot: '#f59e0b' }
  return { text: 'Low', dot: '#94a3b8' }
}

/** A round axis top just above the busiest day. */
function niceMax(v) {
  if (!(v > 0)) return 100
  // Even multiples of the step, so the half-way tick is a round number too.
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil((v * 1.1) / (2 * step)) * 2 * step
}

function TipBox({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div style={{ background: 'rgba(10,31,74,0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 9px', fontSize: 10.5, color: '#fff' }}>
      Day {p.day}: <strong>{Math.round(p.km).toLocaleString()} km</strong>
    </div>
  )
}

export default function FleetTripsCard({ fleetData, stats }) {
  const navigate = useNavigate()
  const month = stats?.month
  const chart = month ? month.dailyKm.map((km, i) => ({ day: i + 1, km })) : []
  const totalKm = month ? Math.round(month.totalKm) : null
  const lastTotal = stats?.lastMonth ? Math.round(stats.lastMonth.totalKm) : null
  const level = activityLevel(fleetData)
  const lastPoint = chart[chart.length - 1]
  const barPct = totalKm != null && lastTotal ? Math.min(100, Math.round((totalKm / lastTotal) * 100)) : 0
  const yMax = niceMax(Math.max(0, ...chart.map(d => d.km)))
  const dayCount = chart.length
  const ticks = dayCount > 0 ? [...new Set([1, ...[5, 10, 15, 20, 25, 30].filter(d => d <= dayCount), dayCount])] : []
  const change = stats?.distanceChange

  const sub = stats?.loading
    ? 'Loading this month’s distance…'
    : stats?.monthError
      ? 'This month’s distance could not be loaded'
      : 'Kilometres driven this month, from the trackers'
  const note = lastTotal != null
    ? `Last month: ${lastTotal.toLocaleString()} km${change != null ? ` · ${change >= 0 ? '+' : ''}${change}% vs the same days` : ''}`
    : stats?.today ? `Today: ${stats.today.km.toFixed(1)} km in ${stats.today.trips} trip${stats.today.trips === 1 ? '' : 's'}` : ''

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
          {totalKm != null ? totalKm.toLocaleString() : '—'}
          <span style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>km</span>
        </div>
        {level && <span style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(255,255,255,0.14)', color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.2)',
          fontSize: 9.5, fontWeight: 600, borderRadius: 20, padding: '2px 9px',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: level.dot, display: 'inline-block', boxShadow: `0 0 6px ${level.dot}` }} />
          {level.text}
        </span>}
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
      </div>
      <p style={{ fontSize: 10, lineHeight: 1.35, color: 'rgba(255,255,255,0.55)', margin: '0 0 1px' }}>
        {sub}
      </p>
      <p style={{ fontSize: 9, lineHeight: 1.3, color: 'rgba(255,255,255,0.45)', margin: '0 0 4px', minHeight: 12 }}>
        {note}
      </p>

      {/* Smooth blue area chart — takes whatever vertical room is left */}
      <div style={{ flex: '1 1 auto', minHeight: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tripsAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(79,195,247,0.35)" />
                <stop offset="100%" stopColor="rgba(79,195,247,0)" />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              ticks={ticks}
              tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9, fontFamily: 'Inter, system-ui, sans-serif' }}
              axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, yMax]}
              ticks={[0, yMax / 2, yMax]}
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
            <Tooltip content={<TipBox />} cursor={{ stroke: 'rgba(255,255,255,0.25)' }} />
            {lastPoint && <ReferenceDot
              x={lastPoint.day}
              y={lastPoint.km}
              r={4.5}
              fill="#0a1f4a"
              stroke="#ffffff"
              strokeWidth={2}
            />}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* View full report button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          onClick={() => navigate('/reports/daywise-distance')}
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
