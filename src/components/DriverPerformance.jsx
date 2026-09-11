import EstimatedBadge from './EstimatedBadge'

const DRIVERS = [
  { initials: 'AK', name: 'Ahmed Khan',  sub: 'TRK-041 · 48 trips', bg: 'bg-blue-500/20',   text: 'text-blue-600',   score: 98, scoreColor: 'text-emerald-600', stars: 4.5 },
  { initials: 'SA', name: 'Sara Ali',    sub: 'TRK-017 · 41 trips', bg: 'bg-purple-500/20', text: 'text-purple-600', score: 94, scoreColor: 'text-blue-600',    stars: 4.5 },
  { initials: 'OF', name: 'Omar Farooq', sub: 'TRK-009 · 38 trips', bg: 'bg-amber-500/20',  text: 'text-amber-600',  score: 91, scoreColor: 'text-amber-600',   stars: 4.5 },
  { initials: 'FN', name: 'Fatima Noor', sub: 'TRK-033 · 36 trips', bg: 'bg-rose-500/20',   text: 'text-rose-600',   score: 88, scoreColor: 'text-rose-600',    stars: 4.0 },
]

// Inline SVG stars — no Font Awesome dependency
const StarFull = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)
const StarHalf = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fillOpacity="0.25"/>
    <path d="M12 2v15.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)
const StarEmpty = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)

function Stars({ rating }) {
  return (
    <div className="flex gap-0.5" style={{ color: '#f59e0b' }}>
      {[1, 2, 3, 4, 5].map(i => {
        if (i <= Math.floor(rating))                        return <StarFull  key={i} />
        if (i === Math.ceil(rating) && rating % 1 !== 0)   return <StarHalf  key={i} />
        return <StarEmpty key={i} />
      })}
    </div>
  )
}

export default function DriverPerformance() {
  return (
    <div className="rounded-xl p-3 md:p-5" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border2)' }}>
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--c-text1)' }}>Driver Performance</h3>
            <EstimatedBadge />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text3)' }}>Top performers this month</p>
        </div>
        <a href="#" className="text-xs text-blue-500 hover:text-blue-400">View all</a>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-5 rounded-xl p-4 mb-4" style={{ background: 'var(--c-card2)', border: '1px solid var(--c-border2)' }}>
        <div className="text-center shrink-0">
          <div className="text-4xl font-bold leading-none" style={{ color: 'var(--c-text1)' }}>92</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--c-text3)' }}>Avg Score</div>
        </div>
        <div className="flex-1 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-base font-bold text-emerald-500">98%</div>
            <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>On-time</div>
          </div>
          <div>
            <div className="text-base font-bold text-blue-500">4.8</div>
            <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>Safety</div>
          </div>
          <div>
            <div className="text-base font-bold text-purple-500">127</div>
            <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>Trips</div>
          </div>
        </div>
      </div>

      {/* Driver list */}
      <div className="space-y-3">
        {DRIVERS.map(d => (
          <div key={d.initials} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${d.bg} text-[11px] font-bold ${d.text} shrink-0`}>
                {d.initials}
              </div>
              <div>
                <div className="text-xs font-semibold" style={{ color: 'var(--c-text1)' }}>{d.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--c-text3)' }}>{d.sub}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Stars rating={d.stars} />
              <span className={`text-xs font-bold w-6 text-right ${d.scoreColor}`}>{d.score}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
