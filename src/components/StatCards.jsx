import { useState, useEffect, useRef } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

const mk = arr => arr.map(v => ({ v }))

const MOCK_CARDS = [
  {
    id: 1,
    label: 'Total Vehicles',
    mockValue: '—',
    badge: null,
    badgeColor: 'text-blue-500 bg-blue-500/10',
    color: '#3b82f6',
    data: mk([32, 34, 36, 35, 40, 44, 48]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="#3b82f6">
        <path d="M20 8H4L2 14h20L20 8z"/>
        <rect x="4" y="14" width="3" height="4" rx="1"/>
        <rect x="17" y="14" width="3" height="4" rx="1"/>
        <circle cx="7" cy="18" r="2"/>
        <circle cx="17" cy="18" r="2"/>
      </svg>
    ),
    iconBg: 'bg-blue-500/10',
  },
  {
    id: 2,
    label: 'Active Vehicles',
    mockValue: '—',
    badge: null,
    badgeColor: 'text-emerald-600 bg-emerald-500/10',
    color: '#22c55e',
    data: mk([28, 30, 29, 32, 31, 33, 35]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="#10b981">
        <circle cx="12" cy="12" r="8"/>
        <circle cx="12" cy="12" r="3" fill="white"/>
      </svg>
    ),
    iconBg: 'bg-emerald-500/10',
  },
  {
    id: 3,
    label: 'Total Drivers',
    mockValue: '10',
    badge: '10',
    badgeColor: 'text-purple-600 bg-purple-500/10',
    color: '#a855f7',
    data: mk([9, 9, 10, 9, 10, 10, 10]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="#8b5cf6">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4" stroke="#8b5cf6" strokeWidth="1.5"/>
      </svg>
    ),
    iconBg: 'bg-purple-500/10',
  },
  {
    id: 4,
    label: 'Total Trips',
    mockValue: '127',
    badge: '+12',
    badgeColor: 'text-amber-600 bg-amber-500/10',
    color: '#f97316',
    data: mk([105, 112, 98, 120, 115, 118, 127]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2">
        <circle cx="6" cy="18" r="2"/>
        <circle cx="18" cy="6" r="2"/>
        <path d="M6 16V9a4 4 0 014-4h4"/>
        <path d="M18 8v7a4 4 0 01-4 4H8"/>
      </svg>
    ),
    iconBg: 'bg-amber-500/10',
  },
  {
    id: 5,
    label: 'Total Distance (km)',
    mockValue: '3,847',
    badge: '+8%',
    badgeColor: 'text-cyan-600 bg-cyan-500/10',
    color: '#06b6d4',
    data: mk([3200, 3400, 3100, 3600, 3500, 3700, 3847]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2">
        <path d="M3 12h18M3 6h18M3 18h18"/>
      </svg>
    ),
    iconBg: 'bg-cyan-500/10',
  },
  {
    id: 6,
    label: 'Total Fuel Cost',
    mockValue: '$2,341',
    badge: '-3%',
    badgeColor: 'text-rose-600 bg-rose-500/10',
    color: '#ef4444',
    data: mk([2100, 2300, 2150, 2400, 2350, 2280, 2341]),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2">
        <path d="M5 3h8l4 4v14H5V3zM9 3v4h8"/>
        <path d="M9 14h2M9 10h6"/>
      </svg>
    ),
    iconBg: 'bg-rose-500/10',
  },
]

function useCountUp(target, duration = 1400) {
  const [count, setCount] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const num = typeof target === 'number' ? Math.round(target) : 0
    // Don't animate until a real value is available
    if (!num) { setCount(0); return }

    cancelAnimationFrame(rafRef.current)
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

function Sparkline({ data, color, gradId }) {
  return (
    <ResponsiveContainer width="100%" height={28}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.25}/>
            <stop offset="100%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false}
          isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" animationBegin={300}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Skel({ w = '60%' }) {
  return (
    <div style={{ height: 22, width: w, borderRadius: 6, background: 'var(--c-border2)', animation: 'skel-pulse 1.4s ease-in-out infinite' }}/>
  )
}

export default function StatCards({ isDark, fleetData, loading }) {
  const utilBg = isDark ? '#1e3a5f' : '#e2e8f0'

  const liveValues = {
    1: fleetData ? { value: String(fleetData.total),  badge: `${fleetData.running}▲`, badgeColor: 'text-blue-500 bg-blue-500/10' } : null,
    2: fleetData ? { value: String(fleetData.active), badge: fleetData.total > 0 ? `${Math.round((fleetData.active / fleetData.total) * 100)}%` : '—', badgeColor: 'text-emerald-600 bg-emerald-500/10' } : null,
    4: fleetData?.totalTrips != null ? { value: String(fleetData.totalTrips), badge: '+12', badgeColor: 'text-amber-600 bg-amber-500/10' } : null,
    5: fleetData?.totalDistance != null ? { value: String(fleetData.totalDistance), badge: '+8%', badgeColor: 'text-cyan-600 bg-cyan-500/10' } : null,
  }

  const utilPct  = fleetData && fleetData.total > 0 ? Math.round((fleetData.active / fleetData.total) * 100) : 76
  const utilCirc = 2 * Math.PI * 10
  const utilArc  = utilCirc * (utilPct / 100)

  const c1    = useCountUp(fleetData ? fleetData.total  : 0, 1400)
  const c2    = useCountUp(fleetData ? fleetData.active : 0, 1400)
  const c3    = useCountUp(fleetData ? fleetData.total : 10, 1200)
  const c4    = useCountUp(fleetData?.totalTrips    ?? 0, 1300)
  const c5    = useCountUp(fleetData?.totalDistance ?? 0, 1500)
  const c6    = useCountUp(2341, 1400)
  const cUtil = useCountUp(utilPct, 1300)

  function displayVal(card) {
    if (card.id === 1) return fleetData ? String(c1) : '—'
    if (card.id === 2) return fleetData ? String(c2) : '—'
    if (card.id === 3) return String(c3)
    if (card.id === 4) return fleetData?.totalTrips    != null ? String(c4)          : '—'
    if (card.id === 5) return fleetData?.totalDistance != null ? c5.toLocaleString() : '—'
    if (card.id === 6) return '$' + c6.toLocaleString()
    return card.mockValue
  }

  return (
    <>
      <style>{`@keyframes skel-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {MOCK_CARDS.map((card, idx) => {
          const isLive       = card.id === 1 || card.id === 2
          const showSkeleton = loading && !fleetData && isLive
          const live         = liveValues[card.id]

          return (
            <div
              key={card.id}
              className="flex flex-col rounded-xl p-3 md:p-4"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-border2)',
                animation: 'fadeInUp 0.5s ease both',
                animationDelay: `${idx * 75}ms`,
              }}
            >
              <div className="mb-3 flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.iconBg}`}>
                  {card.icon}
                </div>
                {showSkeleton ? (
                  <Skel w="36px"/>
                ) : (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${live?.badgeColor ?? card.badgeColor}`}>
                    {live?.badge ?? card.badge}
                  </span>
                )}
              </div>

              {showSkeleton ? (
                <Skel w="55%"/>
              ) : (
                <div className="stat-value mb-0.5 text-xl md:text-2xl leading-none font-bold" style={{ color: 'var(--c-text1)' }}>
                  {displayVal(card)}
                </div>
              )}

              <div className="mb-3 text-xs" style={{ color: 'var(--c-text3)' }}>{card.label}</div>

              <div className="mt-auto" style={{ height: 28 }}>
                <Sparkline data={card.data} color={card.color} gradId={`fleet-spark-grad-${card.id}`}/>
              </div>
            </div>
          )
        })}

        {/* Utilization card */}
        <div
          className="flex flex-col rounded-xl p-3 md:p-4"
          style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-border2)',
            animation: 'fadeInUp 0.5s ease both',
            animationDelay: '450ms',
          }}
        >
          <div className="mb-2 flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#3b82f6">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 4a6 6 0 100 12A6 6 0 0012 6zm0 2a4 4 0 110 8A4 4 0 0112 8z" opacity=".3"/>
                <path d="M12 2a10 10 0 015.3 18.5L12 12V2z"/>
              </svg>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
              {fleetData ? `${utilPct}%` : '+6%'}
            </span>
          </div>

          {loading && !fleetData ? (
            <Skel w="50%"/>
          ) : (
            <div className="text-xl md:text-2xl font-bold leading-none mb-0.5" style={{ color: 'var(--c-text1)' }}>
              {cUtil}%
            </div>
          )}
          <div className="text-xs mb-3" style={{ color: 'var(--c-text3)' }}>Utilization</div>

          <div style={{ height: 28 }} className="flex items-center justify-start mt-auto">
            <svg width="28" height="28" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="10" fill="none" stroke={utilBg} strokeWidth="4"/>
              <circle
                cx="14" cy="14" r="10"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="4"
                strokeDasharray={`${utilArc} ${utilCirc - utilArc}`}
                strokeLinecap="round"
                transform="rotate(-90 14 14)"
              />
            </svg>
            <span className="ml-1 text-[10px] font-medium" style={{ color: '#22c55e' }}>
              {fleetData
                ? `${fleetData.running} running now`
                : '+6% vs last week'}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
