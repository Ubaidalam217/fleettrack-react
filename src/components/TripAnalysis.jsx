import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import EstimatedBadge from './EstimatedBadge'

const TRIPS = [
  { label: 'Completed',   value: 714, pct: '80%', color: '#10b981' },
  { label: 'In Progress', value: 127, pct: '14%', color: '#5ba354' },
  { label: 'Cancelled',   value: 51,  pct: '6%',  color: '#ef4444' },
]

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

export default function TripAnalysis({ isDark }) {
  const borderCol = isDark ? '#1e2740' : '#ffffff'

  return (
    <div className="ft-card">
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h3 className="ft-card-title">Trip Analysis</h3>
          <EstimatedBadge />
        </div>
        <p className="ft-card-sub">This month&rsquo;s breakdown</p>
        <p className="ft-card-note">* Trip completion data not available from Flespi telemetry. Real trip tracking available with backend integration (Phase 2).</p>
      </div>

      {/* Donut */}
      <div className="flex items-center justify-center mb-4">
        <div style={{ position: 'relative', width: 130, height: 130 }}>
          <PieChart width={130} height={130}>
            <Pie
              data={TRIPS.map(t => ({ name: t.label, value: t.value }))}
              cx={65} cy={65}
              innerRadius={44} outerRadius={60}
              startAngle={90} endAngle={-270}
              dataKey="value"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {TRIPS.map((t, i) => (
                <Cell key={i} fill={t.color} stroke={borderCol} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip isDark={isDark} />} />
          </PieChart>
          {/* Center label */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div className="text-xl font-bold leading-none" style={{ color: 'var(--c-text1)' }}>892</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text3)' }}>Total Trips</div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-2.5 ft-push">
        {TRIPS.map(t => (
          <div key={t.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2" style={{ color: 'var(--c-text2)' }}>
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: t.color }}></span>
              {t.label}
            </span>
            <span className="font-bold" style={{ color: 'var(--c-text1)' }}>
              {t.value} <span className="font-normal text-[10px]" style={{ color: 'var(--c-text3)' }}>({t.pct})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
