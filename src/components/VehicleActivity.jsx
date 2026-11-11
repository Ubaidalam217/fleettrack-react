import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { UAE_OFFSET_SEC } from '../utils/daywise'

/**
 * Vehicle Activity (mobile Dashboard): the last seven days' distance and
 * engine hours, from the same Daywise figures as the reports
 * (hooks/useDashboardStats.js) — no fetch of its own. A day from last month
 * shows only when the server has last month's figures.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function lastSevenDays(stats) {
  if (!stats?.month) return null
  const out = []
  const nowUae = new Date(Date.now() + UAE_OFFSET_SEC * 1000)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowUae.getTime() - i * 86400 * 1000)
    const sameMonth = d.getUTCMonth() === nowUae.getUTCMonth()
    const src = sameMonth ? stats.month : stats.lastMonth
    const idx = d.getUTCDate() - 1
    const km = src?.dailyKm?.[idx]
    const sec = src?.dailySec?.[idx]
    out.push({
      day: DAY_NAMES[d.getUTCDay()],
      distance: km == null ? null : Math.round(km),
      engHours: sec == null ? null : Math.round((sec / 3600) * 10) / 10,
    })
  }
  return out
}

// ── Tooltip ────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, isDark }) {
  if (!active || !payload?.length) return null
  const bg   = isDark ? '#162035' : '#ffffff'
  const ttl  = isDark ? '#ffffff' : '#1e293b'
  const body = isDark ? '#9ca3af' : '#64748b'
  const brd  = isDark ? '#253055' : '#e2e8f0'
  return (
    <div style={{ background: bg, border: `1px solid ${brd}`, borderRadius: 8, padding: '10px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: body, margin: '2px 0' }}>
          <span style={{ color: p.stroke }}>●</span> {p.name}: <strong style={{ color: ttl }}>{p.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function VehicleActivity({ isDark, stats }) {
  const chartData = lastSevenDays(stats)

  const grid = isDark ? 'rgba(37,48,85,0.6)' : 'rgba(226,232,240,0.8)'
  const tick  = isDark ? '#9ca3af' : '#64748b'
  const ptBd  = isDark ? '#1e2740' : '#ffffff'

  return (
    <div className="ft-card">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="ft-card-title">Vehicle Activity</h3>
          <p className="ft-card-sub">Last 7 days</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-3 mt-2">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text2)' }}>
          <span className="inline-block h-0.5 w-4 rounded-full bg-blue-500"></span>Distance (km)
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--c-text2)' }}>
          <span className="inline-block h-0.5 w-4 rounded-full bg-purple-500"></span>Eng. Hours
        </span>
      </div>

      <div className="h-[110px] md:h-[140px] xl:h-[155px]">
        {!chartData ? (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--c-text3)' }}>
            {stats?.monthError ? 'Activity could not be loaded' : 'Loading activity data...'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={grid} strokeDasharray="0" />
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 'auto']} width={30} tick={{ fontSize: 9, fill: tick }} />
              <Tooltip content={<CustomTooltip isDark={isDark} />} />
              <Line type="monotone" dataKey="distance" name="Distance (km)" stroke="var(--ft-accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--ft-accent)', stroke: ptBd, strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="engHours" name="Engine Hours"  stroke="#a855f7" strokeWidth={2} dot={{ r: 3, fill: '#a855f7', stroke: ptBd, strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
