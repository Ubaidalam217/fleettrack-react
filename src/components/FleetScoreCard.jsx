import { useState, useEffect } from 'react'
import { computeHealthScore, scoreLabel, scoreColor } from '../utils/healthScore'
import { saveMonthlyScore, getLastMonthScore, ensureLastMonthSeed } from '../utils/historyStore'

const INDUSTRY_AVG = 68

export default function FleetScoreCard({ fleetData, loading }) {
  const score = computeHealthScore(fleetData)
  const label = scoreLabel(score)
  const col   = scoreColor(score)

  // Initialize from localStorage immediately so the UI shows real data on first
  // render without waiting for an effect.
  const [lastMonthScore, setLastMonthScore] = useState(() => getLastMonthScore())

  useEffect(() => {
    if (!fleetData) return
    ensureLastMonthSeed(score)
    saveMonthlyScore(score)
    setLastMonthScore(getLastMonthScore())
  }, [score, fleetData])

  // Fallback only used before history is seeded (milliseconds on first load)
  const lastMonth = lastMonthScore ?? Math.max(30, score - 6)
  const delta     = score - lastMonth
  const isUp      = delta > 0
  const isFlat    = delta === 0

  const deltaCls = isFlat
    ? 'text-slate-500 bg-slate-100'
    : isUp
      ? 'text-emerald-600 bg-emerald-50'
      : 'text-rose-600 bg-rose-50'

  const deltaArrow = isFlat ? null : (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
      style={{ transform: isUp ? 'none' : 'rotate(180deg)', flexShrink: 0 }}
    >
      <line x1="12" y1="19" x2="12" y2="5"/>
      <polyline points="5 12 12 5 19 12"/>
    </svg>
  )

  const deltaText = isFlat
    ? '= same as last month'
    : `${Math.abs(delta)} pts vs last month`

  const BARS = [
    { label: 'Current Score',    value: score,       color: col,       tag: label       },
    { label: 'Industry Average', value: INDUSTRY_AVG, color: '#64748b', tag: 'Benchmark' },
    { label: 'Last Month',       value: lastMonth,   color: '#94a3b8', tag: null        },
  ]

  return (
    <div className="bg-[#f4f5f7] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-slate-900 font-semibold text-[15px]">Score Comparison</h3>
        <span className={`flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${deltaCls}`}>
          {deltaArrow}
          {deltaText}
        </span>
      </div>
      <p className="text-slate-400 text-xs mb-4">Current fleet vs benchmark and prior period</p>

      <div className="space-y-4">
        {BARS.map(b => (
          <div key={b.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-600 text-xs">{b.label}</span>
              <div className="flex items-center gap-1.5">
                {b.tag && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ color: b.color, background: b.color + '18' }}
                  >
                    {b.tag}
                  </span>
                )}
                <span className="text-slate-900 text-sm font-bold">
                  {loading && !fleetData && b.label === 'Current Score' ? '—' : b.value}
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: b.value + '%', background: b.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-slate-400 text-[10px] mt-3">* Industry benchmark for UAE fleet operations</p>
    </div>
  )
}
