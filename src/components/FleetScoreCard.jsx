import { scoreLabel, scoreColor } from '../utils/healthScore'

/**
 * This month against last month, on recorded figures only
 * (hooks/useDashboardStats.js): the fleet score, the safety score and how much
 * of the fleet was used. Last month comes from the server's daily figures; with
 * none, its bars say so instead of showing a number.
 */
export default function FleetScoreCard({ stats }) {
  const score = stats?.score
  const prev = stats?.scorePrev
  const hasDelta = Number.isFinite(score) && Number.isFinite(prev)
  const delta = hasDelta ? score - prev : 0
  const isUp = delta > 0
  const isFlat = delta === 0

  const deltaCls = !hasDelta || isFlat
    ? 'text-slate-500 bg-slate-500/10'
    : isUp
      ? 'text-emerald-600 bg-emerald-500/10'
      : 'text-rose-600 bg-rose-500/10'

  const deltaArrow = !hasDelta || isFlat ? null : (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
      style={{ transform: isUp ? 'none' : 'rotate(180deg)', flexShrink: 0 }}
    >
      <line x1="12" y1="19" x2="12" y2="5"/>
      <polyline points="5 12 12 5 19 12"/>
    </svg>
  )

  const deltaText = !hasDelta
    ? 'no last-month figures'
    : isFlat ? 'same as last month' : `${Math.abs(delta)} pts vs last month`

  const BARS = [
    { label: 'Fleet Score — this month', value: score, color: Number.isFinite(score) ? scoreColor(score) : 'var(--c-border2)', tag: Number.isFinite(score) ? scoreLabel(score) : null },
    { label: 'Fleet Score — last month', value: prev, color: '#94a3b8', tag: null },
    { label: 'Safety — this / last month', value: stats?.safety, prevValue: stats?.safetyPrev, color: '#38bdf8', tag: null },
    { label: 'Vehicle use — this / last month', value: stats?.utilization, prevValue: stats?.utilizationPrev, color: '#a78bfa', tag: null, unit: '%' },
  ]
  const show = (v, unit = '') => (Number.isFinite(v) ? `${v}${unit}` : '—')

  return (
    <div className="ft-card">
      <div className="ft-card-head" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="ft-card-title">Score Comparison</h3>
          <p className="ft-card-sub">This month against last month</p>
        </div>
        <span className={`flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${deltaCls}`}>
          {deltaArrow}
          {deltaText}
        </span>
      </div>

      <div className="space-y-4">
        {BARS.map(b => (
          <div key={b.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: 'var(--c-text2)' }}>{b.label}</span>
              <div className="flex items-center gap-1.5">
                {b.tag && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ color: b.color, background: `color-mix(in srgb, ${b.color} 12%, transparent)` }}
                  >
                    {b.tag}
                  </span>
                )}
                <span className="text-sm font-bold" style={{ color: 'var(--c-text1)' }}>
                  {stats?.loading ? '…' : show(b.value, b.unit)}
                  {'prevValue' in b && (
                    <span className="text-xs font-normal" style={{ color: 'var(--c-text3)' }}> / {show(b.prevValue, b.unit)}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-progress)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Number.isFinite(b.value) ? b.value : 0}%`, background: b.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="ft-card-note ft-push" style={{ paddingTop: 12 }}>
        Fleet score is the average of the safety score (alerts per 100 km) and vehicle use (days each vehicle drove).
        {stats && !stats.safetyWatched && ' No safety score yet: set an Over Speed or harsh-driving alert under Settings › Alerts.'}
      </p>
    </div>
  )
}
