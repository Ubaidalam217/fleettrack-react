import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'

const ALERT_TYPES = [
  { key: 'overspeed',        label: 'Overspeed Events',  sub: '> 80 km/h threshold'  },
  { key: 'gps_lost',         label: 'GPS Signal Loss',   sub: 'No data > 15 min'     },
  { key: 'off_hours_engine', label: 'Off-Hours Engine',  sub: 'Outside 6am-10pm'     },
  { key: 'high_idle',        label: 'High Idle Time',    sub: 'Stationary > 20 min'  },
  { key: 'long_stop',        label: 'Extended Stops',    sub: 'Halted > 4 hrs'       },
  { key: 'fuel_consumption', label: 'Fuel Consumption',  sub: 'Monitoring coming soon'},
]

const LAST_24H = 24 * 60 * 60 * 1000

export default function AlertMarkersCard() {
  const navigate    = useNavigate()
  const { alerts }  = useNotifications()

  // Scope counts to the last 24 hours; fuel_consumption has no rule yet so always 0
  const now    = Date.now()
  const recent = alerts.filter(n => now - n.timestamp < LAST_24H)

  function countByRule(key) {
    if (key === 'fuel_consumption') return 0
    return recent.filter(n => n.ruleId === key).length
  }

  const counts       = ALERT_TYPES.map(t => ({ ...t, cnt: countByRule(t.key) }))
  const activeCount  = counts.filter(t => t.cnt > 0).length

  return (
    <div className="bg-[#f4f5f7] rounded-2xl p-5 flex-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-slate-900 font-semibold text-[15px]">Alert Markers</h3>
        <button
          onClick={() => navigate('/notifications')}
          className="flex items-center gap-1 text-xs font-medium text-slate-700 bg-white rounded-full px-3 py-1.5 shadow-sm hover:shadow-md transition"
        >
          View all
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="w-4 h-4 rounded-full bg-sky-500 text-white text-[10px] flex items-center justify-center font-semibold">
          {activeCount > 0 ? activeCount : '6'}
        </span>
        <span className="text-slate-700 text-sm font-medium">
          {activeCount > 0 ? `${activeCount} Active Rule Categor${activeCount === 1 ? 'y' : 'ies'}` : 'Active Rule Categories'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0">
        {counts.map((t, i) => (
          <div
            key={t.key}
            className={`flex items-start gap-1.5 py-2.5 ${i >= 2 ? 'border-t border-slate-200' : ''}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.cnt > 0 ? '#f97316' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <div className="text-xs text-slate-700 leading-tight">
              <span className="font-semibold">{t.label}</span>
              <div className={t.cnt > 0 ? 'text-orange-500 font-medium' : 'text-slate-400'}>
                {t.cnt > 0 ? `${t.cnt} in last 24h` : t.sub}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
