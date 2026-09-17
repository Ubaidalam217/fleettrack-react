import { useNotifications } from '../hooks/useNotifications'
import { computeAtRisk } from '../utils/fleetAnalytics'

const LAST_HOUR = 60 * 60 * 1000
const LAST_24H  = 24 * 60 * 60 * 1000

// Visual style palette keyed by insight type
const STYLES = {
  critical: {
    bg: 'rgba(239,68,68,0.15)',    heroBg: 'rgba(248,113,113,0.15)',
    border: 'rgba(239,68,68,0.2)', heroBorder: 'rgba(248,113,113,0.25)',
    titleColor: '#dc2626',         heroTitleColor: '#f87171',
  },
  warning: {
    bg: 'rgba(245,158,11,0.15)',   heroBg: 'rgba(251,191,36,0.15)',
    border: 'rgba(245,158,11,0.2)', heroBorder: 'rgba(251,191,36,0.25)',
    titleColor: '#d97706',          heroTitleColor: '#fbbf24',
  },
  success: {
    bg: 'rgba(34,197,94,0.12)',    heroBg: 'rgba(74,222,128,0.15)',
    border: 'rgba(34,197,94,0.2)', heroBorder: 'rgba(74,222,128,0.25)',
    titleColor: '#16a34a',         heroTitleColor: '#4ade80',
  },
  info: {
    bg: 'rgba(91,163,84,0.15)',    heroBg: 'rgba(96,165,250,0.15)',
    border: 'rgba(91,163,84,0.2)', heroBorder: 'rgba(96,165,250,0.25)',
    titleColor: 'var(--ft-accent)',  heroTitleColor: '#8fd087',
  },
}

const ICONS = {
  critical: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="#ef4444">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 11a1 1 0 01-1-1V8a1 1 0 012 0v4a1 1 0 01-1 1zm1 4a1 1 0 11-2 0 1 1 0 012 0z"/>
    </svg>
  ),
  warning: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  success: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" stroke="#5ba354" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

// Priority: 0 = critical, 1 = warning, 2 = info/success
function buildInsights(alerts, fleetData) {
  const now      = Date.now()
  const vehicles = fleetData?.vehicles ?? []
  const atRisk   = computeAtRisk(vehicles)

  const pool = []

  // ── Critical: overspeed events in the last 24 hours ───────────────────────
  const overspeedAlerts = alerts.filter(n => n.ruleId === 'overspeed' && now - n.timestamp < LAST_24H)
  if (overspeedAlerts.length > 0) {
    const first = overspeedAlerts[0]
    const count = overspeedAlerts.length
    pool.push({
      priority: 0,
      type: 'critical',
      title: 'Overspeed Alert',
      desc: `${count} overspeed event${count > 1 ? 's' : ''} in the last 24 hours. Most recent: ${first.vehicleName}.`,
    })
  }

  // ── Warning: vehicles at risk (offline or unresponsive) ───────────────────
  if (atRisk > 0) {
    pool.push({
      priority: 1,
      type: 'warning',
      title: 'Vehicles At Risk',
      desc: `${atRisk} vehicle${atRisk > 1 ? 's are' : ' is'} offline or unreachable. Check GPS connectivity and schedule preventive maintenance.`,
    })
  }

  // ── Warning: high idle detected in the last hour ──────────────────────────
  // Only shown when NOT already crowded by critical + at-risk warnings
  const idleAlerts = alerts.filter(n => n.ruleId === 'high_idle' && now - n.timestamp < LAST_HOUR)
  if (idleAlerts.length > 0) {
    const first = idleAlerts[0]
    const count = idleAlerts.length
    pool.push({
      priority: 1,
      type: 'warning',
      title: 'High Idle Time Detected',
      desc: `${first.vehicleName} engine running without movement (${count} event${count > 1 ? 's' : ''} in last hour). Estimated fuel waste.`,
    })
  }

  // Sort by priority so critical surfaces first
  pool.sort((a, b) => a.priority - b.priority)

  // ── All clear: shown only when nothing is wrong ────────────────────────────
  if (pool.length === 0) {
    pool.push({
      priority: 2,
      type: 'success',
      title: 'All Systems Normal',
      desc: 'No overspeed, idle, or connectivity alerts. Fleet is operating within normal parameters.',
    })
  }

  // ── Route Optimization (static placeholder, always fills the last slot) ───
  const ROUTE_OPT = {
    priority: 2,
    type: 'info',
    title: 'Route Optimization',
    desc: 'Alternate route saves 23 km for TRK-028 today.',
  }
  if (pool.length < 3) pool.push(ROUTE_OPT)

  return pool.slice(0, 3)
}

export default function AIInsights({ heroMode = false, fleetData }) {
  const { alerts } = useNotifications()
  const insights   = buildInsights(alerts, fleetData)

  const actionable = insights.filter(i => i.type === 'critical' || i.type === 'warning').length

  const badgeColor = actionable > 0
    ? {
        color:      heroMode ? '#fca5a5'              : '#dc2626',
        background: heroMode ? 'rgba(252,165,165,0.15)' : 'rgba(239,68,68,0.1)',
        border:     heroMode ? '1px solid rgba(252,165,165,0.25)' : '1px solid rgba(239,68,68,0.2)',
      }
    : {
        color:      heroMode ? '#8fd087'              : 'var(--ft-accent)',
        background: heroMode ? 'rgba(147,197,253,0.15)' : 'rgba(91,163,84,0.1)',
        border:     heroMode ? '1px solid rgba(147,197,253,0.25)' : '1px solid rgba(91,163,84,0.2)',
      }

  return (
    <div className={heroMode ? 'ft-glass' : 'ft-card'} style={heroMode ? { padding: 18 } : undefined}>
      <div className="ft-card-head">
        <div>
          <h3
            className="ft-card-title"
            style={heroMode ? { color: '#ffffff' } : undefined}
          >
            AI Insights
          </h3>
          <p
            className="ft-card-sub"
            style={heroMode ? { color: 'rgba(255,255,255,0.6)' } : undefined}
          >
            Smart recommendations
          </p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0" style={badgeColor}>
          {actionable > 0 ? `${actionable} alert${actionable > 1 ? 's' : ''}` : 'all clear'}
        </span>
      </div>

      <div className="flex flex-col gap-3 flex-1">
        {insights.map((ins, idx) => {
          const s = STYLES[ins.type]
          return (
            <div
              key={idx}
              className="p-3 flex items-center"
              style={{
                background: heroMode ? s.heroBg : 'var(--ft-inset)',
                border: `1px solid ${heroMode ? s.heroBorder : s.border}`,
                borderRadius: 'var(--ft-radius-inner)',
                /* Share the card height evenly so the list fills the row
                   rather than stacking at the top. */
                flex: '1 1 0',
              }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: heroMode ? s.heroBg : s.bg }}
                >
                  {ICONS[ins.type]}
                </div>
                <div>
                  <div
                    className="text-xs font-semibold mb-0.5"
                    style={{ color: heroMode ? s.heroTitleColor : s.titleColor }}
                  >
                    {ins.title}
                  </div>
                  <div
                    className="text-[10px] leading-relaxed"
                    style={{ color: heroMode ? 'rgba(255,255,255,0.62)' : 'var(--c-text3)' }}
                  >
                    {ins.desc}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
