const INSIGHTS = [
  {
    type: 'warning',
    bg: 'rgba(245,158,11,0.15)',
    border: 'rgba(245,158,11,0.2)',
    titleColor: '#d97706',
    title: 'High Idle Time Detected',
    desc: 'TRK-012 idling 2.3h today. Potential $18 fuel savings.',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    type: 'error',
    bg: 'rgba(239,68,68,0.15)',
    border: 'rgba(239,68,68,0.2)',
    titleColor: '#dc2626',
    title: 'Maintenance Due Soon',
    desc: '3 vehicles need oil change within 500 km.',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="#ef4444">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 11a1 1 0 01-1-1V8a1 1 0 012 0v4a1 1 0 01-1 1zm1 4a1 1 0 11-2 0 1 1 0 012 0z"/>
      </svg>
    ),
  },
  {
    type: 'info',
    bg: 'rgba(59,130,246,0.15)',
    border: 'rgba(59,130,246,0.2)',
    titleColor: '#2563eb',
    title: 'Route Optimization',
    desc: 'Alternate route saves 23 km for TRK-028 today.',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

export default function AIInsights() {
  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>AI Insights</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text3)' }}>Smart recommendations</p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-blue-500" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>3 new</span>
      </div>

      <div className="space-y-3">
        {INSIGHTS.map(ins => (
          <div key={ins.type} className="rounded-lg p-3" style={{ background: 'var(--c-card2)', border: `1px solid ${ins.border}` }}>
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: ins.bg }}>
                {ins.icon}
              </div>
              <div>
                <div className="text-xs font-semibold mb-0.5" style={{ color: ins.titleColor }}>{ins.title}</div>
                <div className="text-[10px] leading-relaxed" style={{ color: 'var(--c-text3)' }}>{ins.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
