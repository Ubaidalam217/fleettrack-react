import { computeAtRisk } from '../utils/fleetAnalytics'

/**
 * Fleet Reliability, from recorded data only: live uptime and the vehicles
 * that went quiet (live feed), reminders that are due (Reminders module), and
 * this month's distance against the same days of last month (Daywise figures).
 * The list under it names the actual vehicles behind those numbers.
 */

const AT_RISK_SEC = 30 * 60

function ago(sec) {
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  if (sec < 86400) return `${Math.round(sec / 3600)} h`
  return `${Math.round(sec / 86400)} days`
}

function findings(vehicles, stats) {
  const nowSec = Date.now() / 1000
  const out = []
  const quiet = vehicles
    .filter(v => v.status === 'Inactive' || v.lastTs == null || nowSec - v.lastTs > AT_RISK_SEC)
    .sort((a, b) => (a.lastTs ?? 0) - (b.lastTs ?? 0))
  for (const v of quiet.slice(0, 2)) {
    out.push(v.lastTs == null
      ? `${v.name} has never reported — check its tracker.`
      : `${v.name} has not reported for ${ago(nowSec - v.lastTs)} — check its power and GPS connection.`)
  }
  if (quiet.length > 2) out.push(`${quiet.length - 2} more vehicle${quiet.length - 2 > 1 ? 's are' : ' is'} not reporting.`)
  for (const r of stats?.maintenance?.overdue?.slice(0, 2) ?? []) {
    out.push(`${r.ruleName} is overdue on ${r.vehicle?.plateNo || r.vehicle?.fleetNo || 'a vehicle'}.`)
  }
  if (!out.length && vehicles.length) out.push('Every vehicle reported in the last 30 minutes and no reminder is overdue.')
  return out.slice(0, 3)
}

export default function MaintenanceScoreCard({ fleetData, loading, stats }) {
  const vehicles = fleetData?.vehicles ?? []
  const uptimePct = stats?.uptime
  const reporting = Number.isFinite(uptimePct) ? Math.round((uptimePct / 100) * vehicles.length) : null
  const atRisk = computeAtRisk(vehicles)
  const change = stats?.distanceChange
  const hasChange = change != null
  const isUp = hasChange && change >= 0
  const due = stats?.maintenance?.rules ? stats.maintenance.dueVehicles : null
  const list = findings(vehicles, stats)

  return (
    <div className="ft-card">
      <div className="ft-card-head">
        <div>
          <h3 className="ft-card-title">Fleet Reliability</h3>
          <p className="ft-card-sub">Uptime &amp; Maintenance</p>
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
        <div className="flex items-center gap-8 mb-3">
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>Uptime</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>
              {Number.isFinite(uptimePct) ? uptimePct + '%' : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>Reporting</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>
              {reporting != null ? `${reporting} / ${vehicles.length}` : '—'}
            </div>
          </div>
          {atRisk > 0 && (
            <div>
              <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>At Risk</div>
              <div className="text-rose-500 text-sm font-semibold">{atRisk} vehicle{atRisk > 1 ? 's' : ''}</div>
            </div>
          )}
          {Number.isFinite(due) && (
            <div>
              <div className="text-[11px] mb-1" style={{ color: 'var(--c-text3)' }}>Service Due</div>
              <div className="text-sm font-semibold" style={{ color: due > 0 ? '#f59e0b' : 'var(--c-text1)' }}>{due} vehicle{due === 1 ? '' : 's'}</div>
            </div>
          )}
        </div>

        {/* Uptime bar: where the fleet sits between 0 and 100 % reporting */}
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-rose-500 via-amber-300 to-emerald-400">
          <div
            className="absolute -top-1 h-3.5 w-[2px] transition-all duration-700"
            style={{ left: `${Number.isFinite(uptimePct) ? uptimePct : 0}%`, background: 'var(--c-text1)' }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--c-text3)' }}>
          {[0, 25, 50, 75, 100].map(n => <span key={n}>{n}%</span>)}
        </div>
      </div>

      {/* Summary text */}
      <div className="ft-inset p-4 mb-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text2)' }}>
          {Number.isFinite(uptimePct) ? (
            <>
              <span className="font-semibold" style={{ color: 'var(--c-text1)' }}>{reporting} of {vehicles.length}</span>
              {' '}vehicles reported in the last 15 minutes
              {uptimePct > 80 ? '.' : uptimePct >= 60 ? ' — some need attention.' : ' — check the vehicles listed below.'}
            </>
          ) : 'Waiting for the live feed…'}
        </p>
      </div>
      </>
      )}

      <div className="my-3" style={{ borderTop: '1px solid var(--c-border)' }} />

      {/* Distance against the same days of last month */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--c-text1)' }}>Distance vs Last Month</span>
        <span className="text-[13px] font-semibold ml-auto" style={{ color: 'var(--c-text1)' }}>
          {stats?.month ? `${Math.round(stats.month.totalKm).toLocaleString()} km` : '—'}
        </span>
        {hasChange ? (
          <span className={`flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${isUp ? 'text-emerald-600 bg-emerald-500/10' : 'text-rose-600 bg-rose-500/10'}`}>
            <svg
              width="11" height="11" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: isUp ? 'none' : 'rotate(180deg)' }}
            >
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
            {Math.abs(change)}%
          </span>
        ) : (
          <span className="text-[10px] italic" style={{ color: 'var(--c-text3)' }}>no last-month figures</span>
        )}
      </div>

      <ul className="space-y-2 mt-1">
        {list.map((b, i) => (
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
