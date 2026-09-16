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
    <div className="ft-card">
      <div className="ft-card-head">
        <div>
          <h3 className="ft-card-title">Fleet Reliability</h3>
          <p className="ft-card-sub">Uptime &amp; Maintenance Index</p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      {!loading && (!fleetData || fleetData.total === 0) ? (
        <div className="ft-inset flex-1 flex items-center justify-center py-10 mb-4">
          <span className="text-xs" style={{ color: 'var(--c-text3)' }}>No vehicles reporting</span>
        </div>
      ) : (
      <>
      {/* Metrics row */}
      <div className="ft-inset p-4 mb-4">
        <div className="flex items-center gap-10 mb-3">
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>Uptime</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>
              {loading && !fleetData ? '—' : uptimePct + '%'}
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>Percentile</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>
              {percentile.label.replace('th', '')}
              <span className="text-xs font-normal align-top">th</span>
            </div>
          </div>
          {atRisk > 0 && (
            <div>
              <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>At Risk</div>
              <div className="text-rose-500 text-sm font-semibold">{atRisk} vehicles</div>
            </div>
          )}
        </div>

        {/* Percentile bar */}
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500">
          <div
            className="absolute -top-1 h-3.5 w-[2px] transition-all duration-700"
            style={{ left: percentile.pos, background: 'var(--c-text1)' }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--c-text3)' }}>
          {[20, 40, 60, 80, 100].map(n => <span key={n}>{n}</span>)}
        </div>
      </div>

      {/* Summary text */}
      <div className="ft-inset p-4 mb-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text2)' }}>
          Fleet uptime is{' '}
          <span className="font-semibold" style={{ color: 'var(--c-text1)' }}>
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
      </>
      )}

      <div className="my-3" style={{ borderTop: '1px solid var(--c-border)' }} />

      {/* Change Over Time */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text1)' }}>Change Over Time</span>
        <span className="text-[13px] font-semibold ml-auto" style={{ color: 'var(--c-text1)' }}>
          {hasHistory ? lastMonthScore : '—'}
        </span>
        {rawChange != null ? (
          <span className={`flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${isUp ? 'text-emerald-600 bg-emerald-500/10' : 'text-rose-600 bg-rose-500/10'}`}>
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
          <span className="text-[10px] italic" style={{ color: 'var(--c-text3)' }}>history pending</span>
        )}
      </div>

      <ul className="space-y-2 mt-1">
        {INSIGHTS.map((b, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs leading-snug" style={{ color: 'var(--c-text2)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            {b}
          </li>
        ))}
      </ul>
    </div>
  )
}
