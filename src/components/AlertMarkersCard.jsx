import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
import { IS_REAL } from '../data/mode'
import { useAlerts, alertTypeLabel } from '../data/settings'
import { alertCategories } from '../utils/dashboardStats'
import Skeleton from './Skeleton'

// Mock mode (the demo): the browser engine's fixed rules.
const ALERT_TYPES = [
  { key: 'overspeed',        label: 'Overspeed Events',  sub: '> 80 km/h threshold'  },
  { key: 'gps_lost',         label: 'GPS Signal Loss',   sub: 'No data > 15 min'     },
  { key: 'off_hours_engine', label: 'Off-Hours Engine',  sub: 'Outside 6am-10pm'     },
  { key: 'high_idle',        label: 'High Idle Time',    sub: 'Stationary > 20 min'  },
  { key: 'long_stop',        label: 'Extended Stops',    sub: 'Halted > 4 hrs'       },
  { key: 'fuel_consumption', label: 'Fuel Consumption',  sub: 'Monitoring coming soon'},
]

const LAST_24H = 24 * 60 * 60 * 1000

/** Mock mode: the browser engine's alerts against its fixed rule list. */
function localMarkers(alerts, now) {
  // Scope counts to the last 24 hours; fuel_consumption has no rule yet so always 0
  const recent = alerts.filter(n => now - n.timestamp < LAST_24H)
  const countByRule = key => (key === 'fuel_consumption' ? 0 : recent.filter(n => n.ruleId === key).length)
  return ALERT_TYPES.map(t => ({ ...t, cnt: countByRule(t.key) }))
}

/**
 * Real mode: every alert type that is either raised in the last 24 h (server
 * events, by the server's type names) or watched by an active rule under
 * Settings › Alerts — most raised first, at most six. A type with no rule and
 * no event is not shown: there is nothing behind it.
 */
const MAX_MARKERS = 6
function serverMarkers(events, rules, now) {
  const raised = alertCategories(events, now)
  const byType = new Map(raised.map(r => [r.type, r.count]))
  for (const r of rules ?? []) {
    if (r.status === 'Active' && r.type && !byType.has(r.type)) byType.set(r.type, 0)
  }
  return [...byType]
    .map(([type, cnt]) => ({ key: type, label: alertTypeLabel(type), sub: 'Rule active · none in 24h', cnt }))
    .sort((a, b) => b.cnt - a.cnt || a.label.localeCompare(b.label))
    .slice(0, MAX_MARKERS)
}

/** @param {object} stats  hooks/useDashboardStats.js (`stats.alerts`, real mode) */
export default function AlertMarkersCard({ stats }) {
  const navigate    = useNavigate()
  const { alerts }  = useNotifications()
  const rules       = useAlerts()
  const now         = Date.now()

  const server  = IS_REAL ? stats?.alerts : null
  const counts  = !IS_REAL ? localMarkers(alerts, now) : server ? serverMarkers(server.events, rules, now) : []
  const activeCount  = counts.filter(t => t.cnt > 0).length
  const emptyText = !IS_REAL ? null
    : stats?.alerts === undefined ? 'Loading alerts…'
      : !server ? 'Alerts could not be loaded. They will be tried again shortly.'
        : !counts.length ? 'No alert rules yet. Add them under Settings › Alerts.' : null

  return (
    <div className="ft-card">
      <div className="ft-card-head" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="ft-card-title">Alert Markers</h3>
          <p className="ft-card-sub">Rule categories triggered in the last 24 hours</p>
        </div>
        <button onClick={() => navigate('/notifications')} className="ft-link shrink-0">
          View all
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="w-4 h-4 rounded-full bg-sky-500 text-white text-[10px] flex items-center justify-center font-semibold">
          {activeCount > 0 ? activeCount : IS_REAL ? 0 : '6'}
        </span>
        <span className="text-[13px] font-medium" style={{ color: 'var(--c-text2)' }}>
          {activeCount > 0 ? `${activeCount} Active Rule Categor${activeCount === 1 ? 'y' : 'ies'}` : 'Active Rule Categories'}
        </span>
      </div>

      {emptyText && (IS_REAL && stats?.alerts === undefined
        ? <Skeleton lines={3} label={emptyText} style={{ marginBottom: 8 }} />
        : <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{emptyText}</p>)}

      <div className="grid grid-cols-2 gap-x-4 gap-y-0">
        {counts.map((t, i) => (
          <div
            key={t.key}
            className="flex items-start gap-1.5 py-2.5"
            style={i >= 2 ? { borderTop: '1px solid var(--c-border)' } : undefined}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.cnt > 0 ? '#f97316' : 'var(--c-text3)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <div className="text-xs leading-tight" style={{ color: 'var(--c-text2)' }}>
              <span className="font-semibold" style={{ color: 'var(--c-text1)' }}>{t.label}</span>
              <div className={t.cnt > 0 ? 'text-orange-500 font-medium' : ''} style={t.cnt > 0 ? undefined : { color: 'var(--c-text3)' }}>
                {t.cnt > 0 ? `${t.cnt} in last 24h` : t.sub}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
