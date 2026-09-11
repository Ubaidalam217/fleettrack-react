import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import EstimatedBadge from './EstimatedBadge'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const data = DAYS.map((day, i) => ({ day, fuel: [130,145,125,155,165,90,85][i] }))

function CustomTooltip({ active, payload, label, isDark }) {
  if (!active || !payload?.length) return null
  const bg  = isDark ? '#162035' : '#ffffff'
  const ttl = isDark ? '#ffffff' : '#1e293b'
  const bd  = isDark ? '#253055' : '#e2e8f0'
  const bdy = isDark ? '#9ca3af' : '#64748b'
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600, marginBottom: 2 }}>{label}</p>
      <p style={{ color: bdy }}>{payload[0].value} L</p>
    </div>
  )
}

export default function FuelEnergy({ isDark }) {
  const tick = isDark ? '#9ca3af' : '#64748b'
  const grid = isDark ? 'rgba(37,48,85,0.6)' : 'rgba(226,232,240,0.8)'

  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Fuel &amp; Energy</h3>
        <EstimatedBadge />
      </div>
      <p className="text-xs mb-1" style={{ color: 'var(--c-text3)' }}>Consumption last 7 days</p>
      <p className="text-[10px] mb-3 italic" style={{ color: 'var(--c-text2)' }}>* Fuel data estimated from vehicle activity. Direct sensor integration available with premium telemetry.</p>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-lg p-3 text-center" style={{ background: 'var(--c-card2)', border: '1px solid var(--c-border2)' }}>
          <div className="text-base font-bold" style={{ color: 'var(--c-text1)' }}>895 L</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text3)' }}>Total Consumed</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: 'var(--c-card2)', border: '1px solid var(--c-border2)' }}>
          <div className="text-base font-bold text-emerald-500">4.5 L/h</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--c-text3)' }}>Avg per hour</div>
        </div>
      </div>

      <div className="h-[80px] md:h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: tick }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip isDark={isDark} />} cursor={{ fill: isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.04)' }} />
            <Bar dataKey="fuel" radius={[4,4,0,0]} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill="rgba(59,130,246,0.7)" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
