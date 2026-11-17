import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, ArrowRight } from 'lucide-react'
import JourneyShell from './JourneyShell'
import JourneyMap from '../../components/journeys/JourneyMap'
import { StatusPill, StopDots, TimingChip, ErrorNote } from '../../components/journeys/JourneyBits'
import { listJourneys, getJourney, hhmm, uaeDay, stopMark } from '../../data/journeys'
import { errorMessage } from '../../data/http'

/**
 * Live Journeys (design §A.7, mockup journey-live-simple): today's journeys
 * on the road, about to leave and just done on the left; the selected one on
 * the map (planned dashed, driven solid) with its stops and check-ins.
 * Refreshes every 20 s; the engine updates the journeys every tick.
 */
export default function LiveJourneys(props) {
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const [from, to] = uaeDay(0)
      const res = await listJourneys({ from, to, live: 'true' })
      const order = { Delayed: 0, Interrupted: 1, InProgress: 2, Started: 3, Scheduled: 4, Completed: 5 }
      const list = [...res.data].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.plannedStart.localeCompare(b.plannedStart))
      setRows(list)
      setSel(s => s ?? list[0]?.id ?? null)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load the journeys'))
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!sel) { setDetail(null); return undefined }
    let live = true
    const get = () => getJourney(sel).then(d => live && setDetail(d)).catch(() => {})
    get()
    const t = setInterval(get, 20_000)
    return () => { live = false; clearInterval(t) }
  }, [sel])

  const j = detail?.id === sel ? detail : null
  const n = j?.stops.length ?? 0
  const onRoad = j && ['Started', 'InProgress', 'Delayed', 'Interrupted'].includes(j.status)

  return (
    <JourneyShell {...props} crumb="Live" title="Live journeys" subtitle={rows ? `Today · ${rows.length} journey${rows.length === 1 ? '' : 's'}` : 'Today'} wide>
      <ErrorNote error={error} />
      <div className="j-live">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {!rows && [0, 1, 2].map(i => <div key={i} className="j-skel" style={{ height: 130 }} />)}
          {rows?.length === 0 && <div className="j-card j-empty">No journeys on the road today.</div>}
          {rows?.map(r => (
            <button key={r.id} type="button" className={`j-card j-card--link${sel === r.id ? ' j-card--active' : ''}`} onClick={() => setSel(r.id)} style={{ textAlign: 'left', color: 'inherit', font: 'inherit', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="j-strong" style={{ fontSize: 15 }}>{r.vehicleLabel}</div>
                  <div className="j-label">{r.driverName || 'No driver'}</div>
                </div>
                <StatusPill journey={r} />
              </div>
              <div style={{ marginTop: 10, fontSize: 14 }}>{r.stops[0]?.name} <ArrowRight size={13} style={{ verticalAlign: -2, opacity: 0.7 }} /> {r.stops[r.stops.length - 1]?.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <StopDots stops={r.stops} />
                <span className="j-label" style={{ fontSize: 13 }}>
                  {r.status === 'Completed' ? <>Arrived <b className="j-strong">{hhmm(r.actualArrival)}</b></> : r.actualStart ? <>Arrives <b className="j-strong" style={{ fontSize: 16 }}>{hhmm(r.etaAt ?? r.expectedArrival)}</b></> : <>Leaves <b className="j-strong" style={{ fontSize: 16 }}>{hhmm(r.plannedStart)}</b></>}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="j-card j-card--flush" style={{ position: 'relative', minHeight: 560 }}>
          <JourneyMap
            path={j?.plannedPath}
            stops={j?.stops ?? []}
            progressKm={j?.status === 'Completed' ? 1e9 : j?.progressKm ?? 0}
            vehicle={j && j.lastLat != null && (onRoad || j.status === 'Completed') ? { lat: j.lastLat, lng: j.lastLng, label: j.vehicleLabel } : null}
            height={640}
            fitKey={j?.id ?? 'none'}
            showNames={false}
            fitPadding={typeof window !== 'undefined' && window.innerWidth > 900 ? [[40, 60], [380, 40]] : undefined}
          />
          <div className="j-pill j-pill--plain" style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, gap: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, borderTop: '2px dashed #fff', display: 'inline-block' }} /> Planned route</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, height: 3, background: '#fff', display: 'inline-block' }} /> Driven so far</span>
          </div>
          {j && (
            <div className="j-card" style={{ position: 'absolute', top: 12, right: 12, zIndex: 500, width: 'min(330px, calc(100% - 24px))', padding: 16, maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Link to={`/journeys/${j.id}`} className="j-strong" style={{ fontSize: 15.5, textDecoration: 'none' }}>{j.title}</Link>
                <StatusPill journey={j} />
              </div>
              <div className="j-label" style={{ marginTop: 3 }}>{j.stops[0].name} → {j.stops[n - 1].name}</div>
              <div className="j-inset" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 12, padding: 10 }}>
                <div><div className="j-label">Left</div><div className="j-num" style={{ fontSize: 18 }}>{j.actualStart ? hhmm(j.actualStart) : '—'}</div></div>
                <div><div className="j-label">{j.status === 'Completed' ? 'Arrived' : 'Arrives'}</div><div className="j-num" style={{ fontSize: 18 }}>{hhmm(j.status === 'Completed' ? j.actualArrival : j.etaAt ?? j.expectedArrival)}</div></div>
                <div><div className="j-label">Still to go</div><div className="j-num" style={{ fontSize: 18 }}>{Math.round(j.status === 'Completed' ? 0 : j.remainingKm ?? j.plannedDistanceKm ?? 0)} km</div></div>
              </div>
              {j.stops.map((s, i) => (
                <div key={s.seq} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: i ? '1px solid rgba(255,255,255,.06)' : 'none' }}>
                  <span className="j-badge" style={{ width: 26, height: 26, fontSize: 11 }} data-s={s.status !== 'PENDING' ? 'done' : ''}>{stopMark(i, n)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="j-strong" style={{ fontSize: 13 }}>{s.name}</div>
                    <div className="j-label">
                      {i === 0 ? (s.actualDepart ? `Left ${hhmm(s.actualDepart)}` : `Leaves ${hhmm(s.plannedDepart)}`)
                        : s.actualArrive ? `${hhmm(s.actualArrive)}${s.actualDepart && i < n - 1 ? ` – ${hhmm(s.actualDepart)}` : ''}` : `Expected ${hhmm(s.plannedArrive)}`}
                    </div>
                  </div>
                  {(i === 0 ? s.departTiming : s.arriveTiming)
                    ? <TimingChip timing={i === 0 ? s.departTiming : s.arriveTiming} diffMin={i === 0 ? s.departDiffMin : s.arriveDiffMin} compact />
                    : s.checkInSource === 'AUTO' && <span className="j-pill j-pill--plain">Auto</span>}
                </div>
              ))}
              {onRoad && j.delayMin != null && (
                <div className="j-label" style={{ display: 'flex', gap: 8, marginTop: 10, fontSize: 12.5, color: 'var(--j-text2)' }}>
                  <Clock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Planned to arrive at {hhmm(j.expectedArrival)}. {j.delayMin > 0 ? `It is running ${j.delayMin} minutes late.` : j.delayMin < 0 ? `It is running ${-j.delayMin} minutes early.` : 'It is on time.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </JourneyShell>
  )
}
