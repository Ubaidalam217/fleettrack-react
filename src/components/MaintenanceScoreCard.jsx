import { computeHealthScore } from '../utils/healthScore'
import { computeUptime, computeAtRisk, computePercentile } from '../utils/fleetAnalytics'
import { getLastMonthScore } from '../utils/historyStore'

const INSIGHTS = [
  'Vehicles with no data signal may require GPS inspection or reconnection.',
  'High idle rates suggest potential fuel wastage and unnecessary engine wear.',
  'Regular preventive maintenance reduces unexpected downtime by up to 40%.',
]

export default function MaintenanceScoreCard({ fleetData, loading }) {
  const score    = computeHealthScore(fleetData)
  const vehicles = fleetData?.vehicles ?? []

  // Derive uptime and at-risk from the vehicles array so both metrics use
  // consistent definitions: a vehicle is "up" if it sent telemetry within
  // the last 15 min; "at risk" if it has been silent 30+ min or is Inactive.
  const uptimePct  = vehicles.length > 0
    ? computeUptime(vehicles)
    : (fleetData?.total > 0
        ? Math.round(((fleetData.total - (fleetData.noData ?? 0) - (fleetData.inactive ?? 0)) / fleetData.total) * 100)
        : 75)

  const atRisk     = vehicles.length > 0
    ? computeAtRisk(vehicles)
    : (fleetData ? (fleetData.noData ?? 0) + (fleetData.inactive ?? 0) : 0)

  const percentile = computePercentile(score)

  // Change Over Time: compare current health score against last month's persisted score
  const lastMonthScore = getLastMonthScore()
  const hasHistory     = lastMonthScore != null
  const rawChange      = hasHistory && lastMonthScore > 0
    ? (((score - lastMonthScore) / lastMonthScore) * 100).toFixed(1)
    : null
  const isUp = rawChange != null ? parseFloat(rawChange) >= 0 : true

  return (
    <div className="bg-[#f4f5f7] rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-slate-900 font-semibold text-[15px]">Fleet Reliability</h3>
        <span className="text-slate-400 text-xs flex-1">Uptime &amp; Maintenance Index</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      {/* Metrics row */}
      <div className="bg-white rounded-xl p-4 mb-4">
        <div className="flex items-center gap-10 mb-3">
          <div>
            <div className="text-slate-400 text-[11px] mb-1">Uptime</div>
            <div className="text-slate-900 text-sm font-semibold">
              {loading && !fleetData ? '—' : uptimePct + '%'}
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px] mb-1">Percentile</div>
            <div className="text-slate-900 text-sm font-semibold">
              {percentile.label.replace('th', '')}
              <span className="text-xs font-normal align-top">th</span>
            </div>
          </div>
          {atRisk > 0 && (
            <div>
              <div className="text-slate-400 text-[11px] mb-1">At Risk</div>
              <div className="text-rose-500 text-sm font-semibold">{atRisk} vehicles</div>
            </div>
          )}
        </div>

        {/* Percentile bar */}
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500">
          <div
            className="absolute -top-1 h-3.5 w-[2px] bg-slate-800 transition-all duration-700"
            style={{ left: percentile.pos }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          {[20, 40, 60, 80, 100].map(n => <span key={n}>{n}</span>)}
        </div>
      </div>

      {/* Summary text */}
      <div className="bg-white rounded-xl p-4 mb-4">
        <p className="text-slate-500 text-xs leading-relaxed">
          Fleet uptime is{' '}
          <span className="font-semibold text-slate-700">
            {loading && !fleetData ? '...' : uptimePct + '%'}
          </span>
          {' '}
          {uptimePct > 80
            ? '— excellent reliability across the fleet.'
            : uptimePct >= 60
              ? '— good but some vehicles need attention.'
              : '— below target. Investigate flagged vehicles.'}
        </p>
      </div>

      <div className="border-t border-slate-200 my-3" />

      {/* Change Over Time */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-900 text-sm font-semibold">Change Over Time</span>
        <span className="text-slate-900 text-sm font-semibold">
          {hasHistory ? lastMonthScore : '—'}
        </span>
        {rawChange != null ? (
          <span className={`flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${isUp ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
            <svg
              width="11" height="11" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: isUp ? 'none' : 'rotate(180deg)' }}
            >
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
            {Math.abs(rawChange)}%
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 italic">history pending</span>
        )}
      </div>

      <ul className="space-y-2 mt-1">
        {INSIGHTS.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5 text-slate-500 text-xs leading-snug">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            {b}
          </li>
        ))}
      </ul>
    </div>
  )
}
