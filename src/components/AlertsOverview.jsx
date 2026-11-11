import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
import { IS_REAL } from '../data/mode'
import { alertOverview } from '../utils/dashboardStats'

const ICON = {
  critical: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  warning: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  resolved: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
    </svg>
  ),
}

// Mock mode (the demo): the browser engine's own severities and read state.
const LOCAL_ROWS = [
  { key: 'critical',    label: 'Critical',    sub: 'Require immediate action', color: '#ef4444', countColor: 'text-red-500',     bg: 'rgba(239,68,68,0.1)'   },
  { key: 'warning',     label: 'Warning',     sub: 'Requires attention',       color: '#f97316', countColor: 'text-orange-500',  bg: 'rgba(249,115,22,0.1)'  },
  { key: 'info',        label: 'Information', sub: 'FYI notifications',        color: 'var(--ft-accent)', countColor: 'text-blue-500',    bg: 'color-mix(in srgb, var(--ft-accent) 10%, transparent)'  },
  { key: 'resolved',    label: 'Resolved',    sub: 'In last 7 days',           color: '#10b981', countColor: 'text-emerald-500', bg: 'rgba(16,185,129,0.1)'  },
]

// Real mode: the server alert engine's events, by the severity each rule was
// given under Settings › Alerts (Low / Medium / High / Critical). "Read" on
// the server is shared by the business group, so it is "acknowledged".
const SERVER_ROWS = [
  { ...LOCAL_ROWS[0], sub: 'Critical rules, last 24 hours' },
  { ...LOCAL_ROWS[1], label: 'High',           sub: 'High rules, last 24 hours' },
  { ...LOCAL_ROWS[2], label: 'Medium / Low',   sub: 'Routine rules, last 24 hours' },
  { ...LOCAL_ROWS[3], label: 'Acknowledged',   sub: 'Read by your team, last 7 days' },
]

function useCountUp(target, duration = 1200) {
  const [count, setCount] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const num = Math.round(target)
    cancelAnimationFrame(rafRef.current)
    // The 24 h window rolls, so a count can fall back to 0.
    if (num === 0) { setCount(0); return }
    const start = performance.now()
    const tick = now => {
      const p    = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setCount(Math.round(ease * num))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return count
}

const LAST_24H = 24 * 60 * 60 * 1000
const LAST_7D  = 7  * 24 * 60 * 60 * 1000

/** Mock mode: the browser engine's stored alerts. */
function localCounts(alerts, now) {
  return [
    alerts.filter(n => n.severity === 'critical' && now - n.timestamp < LAST_24H).length,
    alerts.filter(n => n.severity === 'warning'  && now - n.timestamp < LAST_24H).length,
    alerts.filter(n => n.severity === 'info'     && now - n.timestamp < LAST_24H).length,
    alerts.filter(n => n.read && now - n.timestamp < LAST_7D).length,
  ]
}

/**
 * @param {object} stats  hooks/useDashboardStats.js; `stats.alerts` holds the
 *                        server's events in real mode (undefined while loading,
 *                        null when they could not be read).
 */
export default function AlertsOverview({ stats }) {
  const navigate = useNavigate()
  const { alerts } = useNotifications()
  const now = Date.now()

  const server = IS_REAL ? stats?.alerts : null
  const rows = IS_REAL ? SERVER_ROWS : LOCAL_ROWS
  let raw
  if (!IS_REAL) raw = localCounts(alerts, now)
  else if (server) {
    const o = alertOverview(server.events, now)
    raw = [o.critical, o.high, o.routine, o.acknowledged]
  } else raw = [0, 0, 0, 0]
  const [criticalCount, warningCount, infoCount, resolvedCount] = raw
  // Loading, or the server could not be read: a dash, not a zero.
  const known = !IS_REAL || !!server

  const c0 = useCountUp(criticalCount,  900)
  const c1 = useCountUp(warningCount,  1000)
  const c2 = useCountUp(infoCount,     1100)
  const c3 = useCountUp(resolvedCount, 1300)
  const counts = [c0, c1, c2, c3]

  return (
    <div className="ft-card">
      <div className="ft-card-head">
        <div>
          <h3 className="ft-card-title">Alerts Overview</h3>
          <p className="ft-card-sub">{IS_REAL ? 'Raised by your alert rules' : 'Active system alerts'}</p>
        </div>
        <button onClick={() => navigate('/notifications')} className="ft-link shrink-0">View all</button>
      </div>

      <div className="flex flex-col gap-2.5 flex-1 justify-between">
        {rows.map((a, idx) => (
          <div
            key={a.label}
            className="flex items-center justify-between p-3"
            style={{
              background: 'var(--ft-inset)',
              border: '1px solid var(--ft-inset-border)',
              borderRadius: 'var(--ft-radius-inner)',
              animation: 'fadeInUp 0.45s ease both',
              animationDelay: `${100 + idx * 80}ms`,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: a.bg, color: a.color }}
              >
                {ICON[a.key]}
              </div>
              <div>
                <div className="text-xs font-semibold" style={{ color: 'var(--c-text1)' }}>{a.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>{a.sub}</div>
              </div>
            </div>
            <span className={`text-lg font-bold ${a.countColor}`}>
              {known ? counts[idx] : '—'}
              {known && idx === 3 && server?.truncated ? '+' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
