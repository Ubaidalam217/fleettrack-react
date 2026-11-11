import { PieChart, Pie, Cell, Tooltip } from 'recharts'

/**
 * Trip Analysis: today's trips, cut from today's messages exactly as the Trip
 * reports cut them (hooks/useDashboardStats.js) — finished trips, the ones
 * still on the road, and how the engine-on time split between moving and
 * standing. Under it, the month so far from the Daywise figures.
 */

const hm = sec => {
  const m = Math.round((sec ?? 0) / 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function CustomTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const bg  = isDark ? '#162035' : '#ffffff'
  const ttl = isDark ? '#ffffff' : '#1e293b'
  const bd  = isDark ? '#253055' : '#e2e8f0'
  const bdy = isDark ? '#9ca3af' : '#64748b'
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600 }}>{payload[0].name}: <span style={{ color: bdy }}>{payload[0].value}</span></p>
    </div>
  )
}

export default function TripAnalysis({ isDark, stats }) {
  const borderCol = isDark ? '#1e2740' : '#ffffff'
  const today = stats?.today
  const month = stats?.month
  const total = today?.trips ?? 0
  const pct = n => (total ? `${Math.round((n / total) * 100)}%` : '0%')

  const segments = today
    ? [
        { label: 'Completed',   value: today.completed,  color: '#10b981' },
        { label: 'In Progress', value: today.inProgress, color: 'var(--ft-accent)' },
      ]
    : []

  const rows = [
    ...segments.map(s => ({ ...s, text: <>{s.value} <span className="font-normal text-[10px]" style={{ color: 'var(--c-text3)' }}>({pct(s.value)})</span></> })),
    today && { label: 'Distance today', color: '#38bdf8', text: `${today.km.toFixed(1)} km` },
    today && { label: 'Driving / idling today', color: '#f59e0b', text: `${hm(today.driveSec)} / ${hm(today.idleSec)}` },
    month && { label: 'This month', color: '#a855f7', text: `${Math.round(month.totalKm).toLocaleString()} km · ${hm(month.totalSec)} engine` },
  ].filter(Boolean)

  const empty = stats?.todayError
    ? `Today's trips could not be loaded: ${stats.todayError}`
    : 'Loading today’s trips…'

  return (
    <div className="ft-card">
      <div style={{ marginBottom: 14 }}>
        <h3 className="ft-card-title">Trip Analysis</h3>
        <p className="ft-card-sub">Today&rsquo;s trips, as in the Trip reports</p>
      </div>

      {!today ? (
        <div className="ft-inset flex-1 flex items-center justify-center py-10 mb-4">
          <span className="text-xs" style={{ color: 'var(--c-text3)' }}>{empty}</span>
        </div>
      ) : (
        <div className="flex items-center justify-center mb-4">
          <div style={{ position: 'relative', width: 130, height: 130 }}>
            <PieChart width={130} height={130}>
              <Pie
                data={total ? segments.map(t => ({ name: t.label, value: t.value })) : [{ name: 'No trips', value: 1 }]}
                cx={65} cy={65}
                innerRadius={44} outerRadius={60}
                startAngle={90} endAngle={-270}
                dataKey="value"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {total
                  ? segments.map((t, i) => <Cell key={i} fill={t.color} stroke={borderCol} />)
                  : <Cell fill="var(--c-progress)" stroke={borderCol} />}
              </Pie>
              {total ? <Tooltip content={<CustomTooltip isDark={isDark} />} /> : null}
            </PieChart>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div className="text-xl font-bold leading-none" style={{ color: 'var(--c-text1)' }}>{total}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text3)' }}>Trips Today</div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2.5 ft-push">
        {rows.map(t => (
          <div key={t.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2" style={{ color: 'var(--c-text2)' }}>
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: t.color }}></span>
              {t.label}
            </span>
            <span className="font-bold" style={{ color: 'var(--c-text1)' }}>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
