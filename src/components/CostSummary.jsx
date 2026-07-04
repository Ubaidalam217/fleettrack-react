import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun']
const data = MONTHS.map((m, i) => ({ month: m, cost: [8200,7800,9100,8500,9800,9420][i] }))

const COSTS = [
  { label: 'Fuel',         color: '#3b82f6', amt: '$4,710', pct: '50%' },
  { label: 'Maintenance',  color: '#a855f7', amt: '$2,355', pct: '25%' },
  { label: 'Tolls',        color: '#f97316', amt: '$1,413', pct: '15%' },
  { label: 'Driver Wages', color: '#ec4899', amt: '$1,890', pct: '8%'  },
  { label: 'Other',        color: '#9ca3af', amt: '$942',   pct: '10%' },
]

function CustomTooltip({ active, payload, label, isDark }) {
  if (!active || !payload?.length) return null
  const bg  = isDark ? '#162035' : '#ffffff'
  const ttl = isDark ? '#ffffff' : '#1e293b'
  const bd  = isDark ? '#253055' : '#e2e8f0'
  const bdy = isDark ? '#9ca3af' : '#64748b'
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600, marginBottom: 2 }}>{label}</p>
      <p style={{ color: bdy }}>${payload[0].value.toLocaleString()}</p>
    </div>
  )
}

export default function CostSummary({ isDark }) {
  const tick  = isDark ? '#9ca3af' : '#64748b'
  const grid  = isDark ? 'rgba(37,48,85,0.6)' : 'rgba(226,232,240,0.8)'
  const ptBd  = isDark ? '#1e2740' : '#ffffff'

  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <div className="flex items-start justify-between mb-0.5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Cost Summary</h3>
        <span className="text-sm font-bold" style={{ color: 'var(--c-text1)' }}>$9,420</span>
      </div>
      <p className="text-xs mb-1" style={{ color: 'var(--c-text3)' }}>Monthly expenditure</p>
      <p className="text-[10px] mb-3 italic" style={{ color: 'var(--c-text2)' }}>* Estimated based on industry averages. Real cost tracking available with backend integration (Phase 2).</p>

      <div className="h-[65px] md:h-[85px] mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip isDark={isDark} />} />
            <Area
              type="monotone"
              dataKey="cost"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#costGrad)"
              dot={{ r: 3, fill: '#3b82f6', stroke: ptBd, strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2.5">
        {COSTS.map(c => (
          <div key={c.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--c-text2)' }}>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }}></span>
              {c.label}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-semibold" style={{ color: 'var(--c-text1)' }}>{c.amt}</span>
              <span style={{ color: 'var(--c-text3)' }}>{c.pct}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
