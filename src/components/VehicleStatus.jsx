import { useState } from 'react'

const STATUS_STYLE = {
  Running:  { label: 'Moving',  textColor: 'text-emerald-600', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.2)', dot: '#22c55e', blink: true  },
  Idle:     { label: 'Idle',    textColor: 'text-amber-600',   bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.2)', dot: '#f59e0b', blink: false },
  Stopped:  { label: 'Stopped', textColor: 'text-red-600',     bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.2)', dot: '#ef4444', blink: false },
  Inactive: { label: 'Offline', textColor: 'text-gray-400',    bg: 'var(--c-progress)',       border: 'transparent',          dot: '#9ca3af', blink: false },
  NoData:   { label: 'No Data', textColor: 'text-gray-400',    bg: 'var(--c-progress)',       border: 'transparent',          dot: '#9ca3af', blink: false },
}

const STATUS_ORDER = { Running: 0, Idle: 1, Stopped: 2, Inactive: 3, NoData: 4 }

function relTime(ts) {
  if (!ts) return 'No data'
  const secs = Date.now() / 1000 - ts
  if (secs < 60)   return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

function locationStr(v) {
  if (v.lat != null && v.lng != null) return `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`
  return 'No GPS data'
}

function Skel() {
  return (
    <div style={{ height: 13, borderRadius: 4, background: 'var(--c-border2)', animation: 'skel-pulse 1.4s ease-in-out infinite', width: '70%' }}/>
  )
}

export default function VehicleStatus({ vehicles, loading }) {
  const [hovered, setHovered] = useState(null)

  const source  = vehicles ?? []
  const sorted  = [...source].sort((a, b) => (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5))
  const rows    = sorted.slice(0, 6)
  const isLive  = source.length > 0
  const showSkeleton = loading && !isLive
  const showEmpty    = !loading && !isLive

  return (
    <div className="rounded-xl" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <style>{`@keyframes skel-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      <div className="flex items-center justify-between px-3 py-3 md:px-5 md:py-4" style={{ borderBottom: '1px solid var(--c-border2)' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Vehicle Status</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text3)' }}>
            {isLive
              ? `${source.length} vehicles · live data`
              : loading ? 'Fetching live data…' : 'No vehicles reporting'}
          </p>
        </div>
        <a href="/tracking" className="text-xs text-blue-500 hover:text-blue-400 transition-colors">View all →</a>
      </div>

      <div className="overflow-x-auto rounded-b-xl">
        <table style={{ width: '100%', fontSize: 12, minWidth: 480 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border2)', background: 'var(--c-thead)' }}>
              {['Vehicle', 'Status', 'Location', 'Speed', 'Updated'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text3)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--c-border2)' }}>
                  {Array.from({ length: 5 }).map((__, c) => (
                    <td key={c} className="px-3 py-2.5"><Skel/></td>
                  ))}
                </tr>
              ))
            ) : showEmpty ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px 12px', textAlign: 'center', color: 'var(--c-text3)', fontSize: 12 }}>
                  No vehicles reporting
                </td>
              </tr>
            ) : (
              rows.map(v => {
                const st  = STATUS_STYLE[v.status] ?? STATUS_STYLE.NoData
                const key = v.id ?? v.name

                return (
                  <tr
                    key={key}
                    style={{
                      borderBottom: '1px solid var(--c-border2)',
                      background: hovered === key ? 'var(--c-hover)' : 'transparent',
                      transition: 'background 0.1s',
                      cursor: 'default',
                    }}
                    onMouseEnter={() => setHovered(key)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Vehicle name */}
                    <td className="px-3 py-2.5 font-bold" style={{ color: 'var(--c-text1)', whiteSpace: 'nowrap' }}>
                      {v.name || v.ident || `Device ${v.id}`}
                    </td>

                    {/* Status badge */}
                    <td className="px-3 py-2.5" style={{ whiteSpace: 'nowrap' }}>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.textColor}`}
                        style={{ background: st.bg, border: `1px solid ${st.border}` }}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${st.blink ? 'live-blink' : ''}`} style={{ background: st.dot }}/>
                        {st.label}
                      </span>
                    </td>

                    {/* Location */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-text2)', whiteSpace: 'nowrap' }}>
                      {locationStr(v)}
                    </td>

                    {/* Speed */}
                    <td className="px-3 py-2.5 font-semibold" style={{ color: v.status === 'Running' ? '#22c55e' : 'var(--c-text1)', whiteSpace: 'nowrap' }}>
                      {v.speed != null ? `${v.speed} km/h` : '—'}
                    </td>

                    {/* Last updated */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-text3)', whiteSpace: 'nowrap' }}>
                      {relTime(v.lastTs)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
