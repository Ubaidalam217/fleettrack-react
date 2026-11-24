import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X, MapPin, FileText, Info, ChevronRight } from 'lucide-react'
import JourneyShell from './JourneyShell'
import { StatusPill, ErrorNote } from '../../components/journeys/JourneyBits'
import { journeyApprovals, approveJourney, rejectJourney, hhmm, dayTime, duration, uaeDay, stopMark } from '../../data/journeys'
import { errorMessage } from '../../data/http'

/**
 * Approvals (design §A.2, mockup journey-approvals-simple): journeys
 * waiting for approval, with what the approver checks — vehicle, driver (licence, suspended),
 * times, distance, stops with stays, notes — and Approve / Reject (a reason is
 * required). Nobody approves a journey they created or sent; the server
 * refuses it too.
 */
export default function HseApprovals(props) {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('waiting')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await journeyApprovals())
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load the approvals'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const [today] = uaeDay(0)
  const groups = useMemo(() => {
    const rows = data?.data ?? []
    return {
      waiting: rows.filter(r => r.display === 'Pending'),
      approved: rows.filter(r => r.approvalStatus === 'APPROVED' && r.decidedAt >= today),
      rejected: rows.filter(r => r.display === 'Rejected'),
    }
  }, [data, today])

  const act = async (id, fn) => {
    setBusy(id)
    setError(null)
    try {
      await fn()
      setRejecting(null)
      setReason('')
      await load()
    } catch (e) {
      setError(errorMessage(e, 'That did not work'))
    } finally {
      setBusy(null)
    }
  }

  const list = groups[tab]
  return (
    <JourneyShell {...props} crumb="Approvals" title="Approvals" subtitle="Journeys waiting for approval. Check the details, then approve or reject.">
      <ErrorNote error={error} />
      {data && !data.canApprove && (
        <div className="j-card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <Info size={16} /> You can see the queue, but approving needs the “Journey approval” permission. A Super Admin gives it in the user’s permissions.
        </div>
      )}
      <div className="j-tabs" style={{ marginBottom: 16 }}>
        {[['waiting', 'Waiting'], ['approved', 'Approved today'], ['rejected', 'Rejected']].map(([k, l]) => (
          <button key={k} type="button" className="j-tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l} <span className="j-count">{groups[k].length}</span></button>
        ))}
      </div>

      {!data && <div className="j-skel" style={{ height: 220 }} />}
      {data && list.length === 0 && <div className="j-card j-empty">{tab === 'waiting' ? 'Nothing is waiting for approval.' : 'None.'}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1000 }}>
        {list.map(j => {
          const n = j.stops.length
          const blocked = j.ownJourney || !data.canApprove
          return (
            <div key={j.id} className="j-card" style={{ padding: 20, borderColor: rejecting === j.id ? 'var(--j-bad)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <Link to={`/journeys/${j.id}`} className="j-strong" style={{ fontSize: 18, textDecoration: 'none' }}>{j.title}</Link>
                  <div className="j-label" style={{ marginTop: 3 }}>{j.ref} · sent {j.submittedAt ? hhmm(j.submittedAt) : '—'} by <b>{j.ownJourney ? 'you' : j.submittedByName}</b></div>
                </div>
                <StatusPill journey={j} />
              </div>

              <div className="j-inset" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginTop: 14 }}>
                <div><div className="j-label">Vehicle</div><div className="j-strong">{j.vehicleLabel}{j.vehicleType ? ` · ${j.vehicleType}` : ''}</div></div>
                <div>
                  <div className="j-label">Driver</div><div className="j-strong">{j.driverName || 'No driver'}</div>
                  {j.driverProblems?.length ? <div className="j-err">{j.driverProblems[0]}</div> : j.driverName ? <div className="j-ok-text"><Check size={11} style={{ verticalAlign: -1 }} /> Licence valid</div> : null}
                </div>
                <div><div className="j-label">Leaves</div><div className="j-strong">{dayTime(j.plannedStart)}</div></div>
                <div><div className="j-label">Arrives</div><div className="j-strong">{hhmm(j.expectedArrival)}</div></div>
                <div><div className="j-label">Distance</div><div className="j-strong">{Math.round(j.plannedDistanceKm ?? 0)} km · {duration(j.plannedDriveMin)}</div></div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {j.stops.map((s, i) => (
                  <span key={s.seq} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {i > 0 && <ChevronRight size={14} className="j-muted" />}
                    <span className="j-pill j-pill--plain" style={{ padding: '4px 10px 4px 4px' }}>
                      <span className="j-badge" style={{ width: 22, height: 22, fontSize: 10.5 }}>{stopMark(i, n)}</span>
                      {s.name}{s.stayMin && i > 0 && i < n - 1 ? <span className="j-muted" style={{ fontWeight: 400 }}>stay {s.stayMin} min</span> : null}
                    </span>
                  </span>
                ))}
              </div>
              {j.instructions && <div className="j-label" style={{ marginTop: 10, display: 'flex', gap: 6, fontSize: 12.5 }}><FileText size={13} /> {j.instructions}</div>}
              {j.display === 'Rejected' && j.rejectReason && <div className="j-err" style={{ marginTop: 10 }}>Rejected by {j.decidedByName}: {j.rejectReason}</div>}
              {j.approvalStatus === 'APPROVED' && <div className="j-ok-text" style={{ marginTop: 10 }}>Approved by {j.decidedByName} at {hhmm(j.decidedAt)}</div>}
              {tab === 'waiting' && j.ownJourney && (
                <div className="j-inset" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, borderColor: 'rgba(201,184,255,.4)' }}>
                  <Info size={14} /> You created or sent this journey, so another approver must check it.
                </div>
              )}

              {rejecting === j.id && (
                <div style={{ marginTop: 14 }}>
                  <div className="j-field"><span>Why are you rejecting it? <span className="j-muted" style={{ fontWeight: 400 }}>The creator will see this.</span></span>
                    <textarea className="j-textarea" rows={2} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
                  </div>
                </div>
              )}

              {tab === 'waiting' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--j-line)', flexWrap: 'wrap' }}>
                  <Link to={`/journeys/${j.id}`} className="j-btn j-btn--ghost" style={{ textDecoration: 'none', paddingLeft: 0 }}><MapPin size={14} /> See route on map</Link>
                  {rejecting === j.id ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="j-btn" onClick={() => { setRejecting(null); setReason('') }}>Back</button>
                      <button type="button" className="j-btn j-btn--danger" disabled={busy === j.id || reason.trim().length < 3} onClick={() => act(j.id, () => rejectJourney(j.id, reason.trim()))}><X size={14} /> Send rejection</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="j-btn" disabled={blocked || busy === j.id} onClick={() => setRejecting(j.id)}><X size={14} /> Reject</button>
                      <button type="button" className="j-btn j-btn--primary" disabled={blocked || busy === j.id || j.driverProblems?.length > 0} onClick={() => act(j.id, () => approveJourney(j.id))}><Check size={14} /> Approve</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </JourneyShell>
  )
}
