import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IS_REAL } from '../data/mode'
import { useDrivers, getDriverPerformance } from '../data/settings'

/**
 * Top Drivers: the account's own drivers, ranked on the last seven days by the
 * Driver Performance report's safety score (server/src/lib/driverPerformance.js).
 * A trip is credited the way that report credits it — the iButton read during
 * it, else the vehicle's assigned driver. Drivers who did not drive are not
 * ranked. With no drivers, or no server, the card says what is missing.
 */

const DAYS = 7
const TTL_MS = 10 * 60 * 1000
let cache = null // { key, at, promise }

function loadRanking() {
  const to = new Date()
  const from = new Date(to.getTime() - DAYS * 86400 * 1000)
  const key = to.toISOString().slice(0, 13) // the hour: one ranking per hour at most
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.promise
  const promise = getDriverPerformance(from.toISOString(), to.toISOString())
  cache = { key, at: Date.now(), promise }
  promise.catch(() => { if (cache?.promise === promise) cache = null })
  return promise
}

const PALETTE = [
  ['var(--ft-accent)', 'color-mix(in srgb, var(--ft-accent) 14%, transparent)'],
  ['#10b981', 'rgba(16,185,129,0.14)'],
  ['#8b5cf6', 'rgba(139,92,246,0.14)'],
  ['#f59e0b', 'rgba(245,158,11,0.14)'],
  ['#f43f5e', 'rgba(244,63,94,0.14)'],
]

function scoreChipColor(score) {
  if (score >= 80) return { text: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
  if (score >= 60) return { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  return { text: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
}

const initials = name => String(name ?? '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

function Empty({ children }) {
  return (
    <div className="ft-inset" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', textAlign: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.6 }}>{children}</span>
    </div>
  )
}

export default function TopDriversPanel() {
  const drivers = useDrivers()
  const hasDrivers = (drivers?.length ?? 0) > 0
  const [state, setState] = useState({ loading: true, error: null, rows: null })

  useEffect(() => {
    if (!IS_REAL || !hasDrivers) return undefined
    let live = true
    loadRanking().then(
      data => {
        if (!live) return
        const rows = (data?.drivers ?? [])
          .filter(d => d.trips > 0 && d.safetyScore != null)
          .sort((a, b) => b.safetyScore - a.safetyScore || b.distanceKm - a.distanceKm)
          .slice(0, 5)
        setState({ loading: false, error: null, rows })
      },
      err => { if (live) setState({ loading: false, error: err?.message || 'Could not load', rows: null }) },
    )
    return () => { live = false }
  }, [hasDrivers])

  let body
  if (!hasDrivers) body = <Empty>No drivers yet. Add drivers and assign them to vehicles under Settings › Driver.</Empty>
  else if (!IS_REAL) body = <Empty>The driver ranking is worked out on the server, which this demo does not use.</Empty>
  else if (state.loading) body = <Empty>Ranking drivers on the last {DAYS} days…</Empty>
  else if (state.error) body = <Empty>The driver ranking could not be loaded: {state.error}</Empty>
  else if (!state.rows.length) body = <Empty>None of your drivers drove in the last {DAYS} days, or their trips could not be credited to them (no iButton read and no vehicle assigned).</Empty>
  else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'flex-start' }}>
        {state.rows.map((d, i) => {
          const chip = scoreChipColor(d.safetyScore)
          const [color, bg] = PALETTE[i % PALETTE.length]
          return (
            <div
              key={d.driverId}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 11px', borderRadius: 12,
                border: '1px solid var(--ft-inset-border)', background: 'var(--ft-inset)',
                animation: 'fadeInUp 0.4s ease both', animationDelay: `${i * 70}ms`,
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: '50%', background: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color, flexShrink: 0,
              }}>
                {initials(d.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--c-text3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.vehicles?.length ? `${d.vehicles.join(', ')} · ` : ''}{d.trips} trip{d.trips === 1 ? '' : 's'} · {Math.round(d.distanceKm).toLocaleString()} km
                </div>
              </div>
              <div
                title="Safety score: speeding and harsh driving per 100 km, fatigue and incidents"
                style={{ fontSize: 11, fontWeight: 700, color: chip.text, background: chip.bg, borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}
              >
                {d.safetyScore}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="ft-card">
      <div className="ft-card-head">
        <div>
          <h3 className="ft-card-title">Top Drivers</h3>
          <p className="ft-card-sub">Safety score, last {DAYS} days</p>
        </div>
        <Link to="/reports/driver-performance" className="ft-link shrink-0">
          View all
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </Link>
      </div>
      {body}
    </div>
  )
}
