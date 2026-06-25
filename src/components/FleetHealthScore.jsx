import { useState, useEffect, useRef } from 'react'
import { PieChart, Pie, Cell } from 'recharts'

function scoreColor(s) {
  if (s >= 80) return '#22c55e'
  if (s >= 60) return '#f59e0b'
  if (s >= 40) return '#f97316'
  return '#ef4444'
}

function scoreLabel(s) {
  if (s >= 90) return 'Excellent'
  if (s >= 70) return 'Good'
  if (s >= 50) return 'Fair'
  return 'Poor'
}

function Skel({ w = '40%', h = 16 }) {
  return (
    <div style={{ height: h, width: w, borderRadius: 6, background: 'var(--c-border2)', animation: 'skel-pulse 1.4s ease-in-out infinite' }}/>
  )
}

function useCountUp(target, duration = 1400) {
  const [count, setCount] = useState(0)
  const rafRef  = useRef(null)
  useEffect(() => {
    const num = typeof target === 'number' ? Math.round(target) : 0
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

export default function FleetHealthScore({ isDark, fleetData, loading }) {
  const gaugeBg = isDark ? '#1a2d4a' : '#e2e8f0'

  const score = fleetData ? fleetData.healthScore : 92
  const total = fleetData ? fleetData.total : 48
  const pct   = n => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%'

  const rows = fleetData
    ? [
        { label: 'Moving',  color: '#22c55e', pct: pct(fleetData.running),                     count: fleetData.running  },
        { label: 'Idle',    color: '#f59e0b', pct: pct(fleetData.idle),                        count: fleetData.idle     },
        { label: 'Stopped', color: '#ef4444', pct: pct(fleetData.stopped),                     count: fleetData.stopped  },
        { label: 'Offline', color: '#9ca3af', pct: pct(fleetData.inactive + fleetData.noData), count: fleetData.inactive + fleetData.noData },
      ]
    : [
        { label: 'Healthy',   color: '#22c55e', pct: '71%', count: 34 },
        { label: 'Attention', color: '#f59e0b', pct: '17%', count: 8  },
        { label: 'Critical',  color: '#ef4444', pct: '6%',  count: 3  },
        { label: 'Offline',   color: '#9ca3af', pct: '6%',  count: 3  },
      ]

  const arcColor    = fleetData ? scoreColor(score) : '#22c55e'
  const label       = fleetData ? scoreLabel(score)  : 'Excellent'
  const displayScore = useCountUp(score, 1400)

  const [barsReady, setBarsReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setBarsReady(true), 500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <style>{`@keyframes skel-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      <h3 className="text-sm font-semibold mb-0.5" style={{ color: 'var(--c-text1)' }}>Fleet Health Score</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--c-text3)' }}>Overall fleet condition</p>

      <div style={{ position: 'relative', height: 140, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', lineHeight: 0 }}>
          <PieChart width={280} height={160}>
            <Pie
              data={[{ v: score }, { v: 100 - score }]}
              cx={140}
              cy={150}
              innerRadius={100}
              outerRadius={130}
              startAngle={180}
              endAngle={0}
              dataKey="v"
              strokeWidth={0}
              isAnimationActive={true}
              animationBegin={0}
              animationDuration={1200}
              animationEasing="ease-out"
            >
              <Cell fill={arcColor}/>
              <Cell fill={gaugeBg}/>
            </Pie>
          </PieChart>
        </div>

        <div style={{ position: 'absolute', top: '68%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', zIndex: 10 }}>
          {loading && !fleetData ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <Skel w="56px" h={36}/>
              <Skel w="40px" h={14}/>
            </div>
          ) : (
            <>
              <div className="text-3xl md:text-4xl font-bold leading-none" style={{ color: 'var(--c-text1)' }}>{displayScore}</div>
              <div className="text-xs md:text-sm mt-0.5 text-gray-400">/ 100</div>
              <div className="text-xs md:text-sm font-semibold mt-0.5" style={{ color: arcColor }}>{label}</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--c-text2)' }}>
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.color }}/>
              {r.label}
            </span>
            <div className="flex items-center gap-2">
              {loading && !fleetData ? (
                <Skel w="60px"/>
              ) : (
                <>
                  <div className="h-1 w-16 md:w-20 rounded-full" style={{ background: 'var(--c-progress)' }}>
                    <div
                      className="h-1 rounded-full"
                      style={{
                        width: barsReady ? r.pct : '0%',
                        background: r.color,
                        transition: 'width 0.85s ease',
                      }}
                    />
                  </div>
                  <span className="text-xs font-semibold w-5 text-right" style={{ color: 'var(--c-text1)' }}>{r.count}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
