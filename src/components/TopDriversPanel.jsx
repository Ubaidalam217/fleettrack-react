// 5-driver vertical list for the desktop hero row.
// Separate from DriverPerformance.jsx (which remains unchanged for mobile).
import EstimatedBadge from './EstimatedBadge'

const DRIVERS = [
  { initials: 'AK', name: 'Ahmed Khan',    assignment: 'TRK-041', trips: 48, score: 98, online: true,  color: '#5ba354', bg: 'rgba(91,163,84,0.14)' },
  { initials: 'KH', name: 'Khalid Hassan', assignment: 'TRK-005', trips: 89, score: 95, online: false, color: '#10b981', bg: 'rgba(16,185,129,0.14)' },
  { initials: 'SA', name: 'Sara Ali',      assignment: 'TRK-017', trips: 41, score: 94, online: true,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.14)' },
  { initials: 'OF', name: 'Omar Farooq',   assignment: 'TRK-009', trips: 38, score: 91, online: true,  color: '#f59e0b', bg: 'rgba(245,158,11,0.14)'  },
  { initials: 'FN', name: 'Fatima Noor',   assignment: 'TRK-033', trips: 36, score: 88, online: false, color: '#f43f5e', bg: 'rgba(244,63,94,0.14)'   },
]
// Already sorted by score desc

function scoreChipColor(score) {
  if (score >= 90) return { text: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
  if (score >= 80) return { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  return { text: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
}

export default function TopDriversPanel() {
  return (
    <div className="ft-card">
      {/* Header */}
      <div className="ft-card-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3 className="ft-card-title">Top Drivers</h3>
            <EstimatedBadge />
          </div>
          <p className="ft-card-sub">Ranked by performance score</p>
        </div>
        <a href="/drivers" className="ft-link shrink-0">
          View all
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </a>
      </div>

      {/* Status legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--c-text3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          Online
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--c-text3)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-border2)', display: 'inline-block' }} />
          Offline
        </span>
      </div>

      {/* Driver rows — evenly distributed so the list fills the card height */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'space-between' }}>
        {DRIVERS.map((d, i) => {
          const chip = scoreChipColor(d.score)
          return (
            <div
              key={d.initials}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 11px',
                borderRadius: 12,
                border: '1px solid var(--ft-inset-border)',
                background: 'var(--ft-inset)',
                cursor: 'default',
                animation: 'fadeInUp 0.4s ease both',
                animationDelay: `${i * 70}ms`,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--ft-inset)')}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: d.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: d.color,
                  flexShrink: 0,
                }}
              >
                {d.initials}
              </div>

              {/* Name + assignment */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--c-text1)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {d.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--c-text3)', marginTop: 1 }}>
                  {d.assignment} &middot; {d.trips} trips
                </div>
              </div>

              {/* Score badge */}
              <div
                style={{
                  fontSize: 11, fontWeight: 700,
                  color: chip.text, background: chip.bg,
                  borderRadius: 6, padding: '2px 7px',
                  flexShrink: 0,
                }}
              >
                {d.score}
              </div>

              {/* Online indicator */}
              <div
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: d.online ? '#22c55e' : 'var(--c-border2)',
                  flexShrink: 0,
                  boxShadow: d.online ? '0 0 0 2px rgba(34,197,94,0.2)' : 'none',
                }}
                title={d.online ? 'Online' : 'Offline'}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
