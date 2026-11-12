import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Skeleton from './Skeleton'

/**
 * Cost Summary: what Settings › Master › Expense holds for the last six months,
 * in AED — per month, and per expense type. A Fix expense (insurance,
 * financing…) is spread over its period (utils/dashboardStats.js
 * expenseFigures). With nothing entered, the card says where to enter it.
 */

const COLORS = ['var(--ft-accent)', '#a855f7', '#f97316', '#ec4899', '#9ca3af']

const aed = n => `AED ${Math.round(n || 0).toLocaleString('en-US')}`
const short = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)))

function CustomTooltip({ active, payload, label, isDark }) {
  if (!active || !payload?.length) return null
  const bg  = isDark ? '#162035' : '#ffffff'
  const ttl = isDark ? '#ffffff' : '#1e293b'
  const bd  = isDark ? '#253055' : '#e2e8f0'
  const bdy = isDark ? '#9ca3af' : '#64748b'
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ color: ttl, fontWeight: 600, marginBottom: 2 }}>{label}</p>
      <p style={{ color: bdy }}>{aed(payload[0].value)}</p>
    </div>
  )
}

export default function CostSummary({ isDark, stats }) {
  const tick  = isDark ? '#9ca3af' : '#64748b'
  const grid  = isDark ? 'rgba(37,48,85,0.6)' : 'rgba(226,232,240,0.8)'
  const ptBd  = isDark ? '#1e2740' : '#ffffff'
  const ex = stats?.expenses
  const hasData = !!ex && ex.total > 0

  // The four biggest types, the rest as "Other".
  const top = hasData ? ex.byType.slice(0, 4) : []
  const rest = hasData ? ex.byType.slice(4).reduce((s, t) => s + t.amount, 0) : 0
  const legend = [...top, ...(rest > 0 ? [{ type: 'Other types', amount: rest }] : [])]
    .map((t, i) => ({ ...t, color: COLORS[i % COLORS.length], pct: `${Math.round((t.amount / ex.total) * 100)}%` }))

  let empty = null
  if (!stats?.isReal) empty = 'Expenses are kept on the server, which this demo does not use.'
  else if (stats?.expensesError) empty = `Expenses could not be loaded: ${stats.expensesError}`
  else if (!ex) empty = 'Loading expenses…'
  else if (!hasData) empty = 'No expenses in the last six months. Add fuel, maintenance and other costs under Settings › Master › Expense.'

  return (
    <div className="ft-card">
      <div className="ft-card-head" style={{ marginBottom: 14 }}>
        <div>
          <h3 className="ft-card-title">Cost Summary</h3>
          <p className="ft-card-sub">Expenses entered, last 6 months</p>
        </div>
        {hasData && (
          <div className="text-right shrink-0">
            <div className="text-sm font-bold" style={{ color: 'var(--c-text1)' }}>{aed(ex.thisMonth)}</div>
            <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>this month</div>
          </div>
        )}
      </div>

      {empty ? (
        <div className="ft-inset flex-1 flex items-center justify-center py-10 px-4 text-center">
          {stats?.isReal && !stats?.expensesError && !ex
            ? <Skeleton lines={4} label={empty} />
            : <span className="text-xs" style={{ color: 'var(--c-text3)', lineHeight: 1.6 }}>{empty}</span>}
        </div>
      ) : (
        <>
          <div className="h-[65px] md:h-[85px] mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ex.months} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ft-accent)" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="var(--ft-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={short} tick={{ fontSize: 9, fill: tick }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip isDark={isDark} />} />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="var(--ft-accent)"
                  strokeWidth={2}
                  fill="url(#costGrad)"
                  dot={{ r: 3, fill: 'var(--ft-accent)', stroke: ptBd, strokeWidth: 1.5 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2.5 ft-push">
            {legend.map(c => (
              <div key={c.type} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--c-text2)' }}>
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }}></span>
                  {c.type}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: 'var(--c-text1)' }}>{aed(c.amount)}</span>
                  <span style={{ color: 'var(--c-text3)' }}>{c.pct}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
