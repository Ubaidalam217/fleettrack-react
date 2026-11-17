import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Phone, MapPinned, Pencil, Send, Check, X, Ban, Trash2, PenTool, MessageSquarePlus, ShieldCheck } from 'lucide-react'
import JourneyShell from './JourneyShell'
import JourneyMap from '../../components/journeys/JourneyMap'
import SignaturePad from '../../components/journeys/SignaturePad'
import { StatusPill, TimingChip, HalfGauge, ErrorNote } from '../../components/journeys/JourneyBits'
import {
  getJourney, submitJourney, approveJourney, rejectJourney, cancelJourney, deleteJourney, addJourneyNote, signStop, signatureUrl,
  hhmm, dayTime, duration, EVENT_LABEL, eventTone, STATUS_META,
  stopMark,
} from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { diffText } from '../../utils/journeySchedule'

/**
 * One journey (client 2026-11-17, point 4): where it is now, which stops are
 * done, what is ahead, km done / remaining, ETA. The layout is the prototype
 * the client liked (journey-detail-dark): header with plate, title, driver,
 * HSE state and a status pill; compliance %; the distance half gauge; the
 * stops with planned vs actual; leg progress; the map (driven solid, still to
 * go dashed); and a bottom bar with the distance to arrival, ETA and Call
 * driver. Then the timeline, proof of delivery, events and violations.
 */

const FAIL_TYPES = new Set(['OFF_ROUTE', 'UNPLANNED_STOP', 'SKIPPED_STOP', 'BREAK_DUE', 'DAILY_LIMIT', 'NO_SIGNAL', 'NOT_DEPARTED'])

/** Compliance: on-time departures/arrivals and clean checks, of everything judged. */
function compliance(j) {
  let checks = 0, pass = 0
  for (const e of j.events) {
    if (/^(ARRIVE|DEPART)_/.test(e.type)) { checks++; if (e.type.endsWith('ON_TIME')) pass++ }
    else if (FAIL_TYPES.has(e.type)) checks++
  }
  if (j.approvalStatus === 'APPROVED') { checks++; pass++ }
  return { checks, pass, pct: checks ? Math.round((pass / checks) * 100) : null }
}

const stopDone = s => ['DEPARTED', 'PASSED', 'SKIPPED'].includes(s.status)

export default function JourneyDetail(props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [j, setJ] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [signing, setSigning] = useState(null)
  const [note, setNote] = useState('')
  const [sigImg, setSigImg] = useState({})
  const warnings = location.state?.warnings ?? []

  const load = useCallback(async () => {
    try {
      setJ(await getJourney(id))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load the journey'))
    }
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  // Signed stops: fetch their images (authenticated) once.
  useEffect(() => {
    if (!j) return
    for (const s of j.stops) {
      if (s.signature && !sigImg[s.seq]) signatureUrl(j.id, s.seq).then(url => url && setSigImg(m => ({ ...m, [s.seq]: url })))
    }
  }, [j, sigImg])

  const act = async (fn, after) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (after) after()
      await load()
    } catch (e) {
      setError(errorMessage(e, 'That did not work'))
    } finally {
      setBusy(false)
    }
  }

  const comp = useMemo(() => (j ? compliance(j) : null), [j])

  if (!j) {
    return (
      <JourneyShell {...props} crumb="Journey">
        <ErrorNote error={error} />
        {!error && <div className="j-skel" style={{ height: 480 }} />}
      </JourneyShell>
    )
  }

  const n = j.stops.length
  const planned = j.plannedDistanceKm ?? 0
  const done = j.status === 'Completed' ? planned : Math.min(planned, j.progressKm ?? 0)
  const remaining = Math.max(0, planned - done)
  const onRoad = ['Started', 'InProgress', 'Delayed', 'Interrupted'].includes(j.status)
  const vehicle = j.lastLat != null && (onRoad || j.status === 'Completed')
    ? { lat: j.lastLat, lng: j.lastLng, label: `${j.vehicleLabel}${onRoad && j.lastSpeed != null ? ` · ${Math.round(j.lastSpeed)} km/h` : ''}` }
    : null
  const hse = j.approvalStatus === 'APPROVED' ? 'HSE approved' : j.approvalStatus === 'PENDING' ? 'Waiting for HSE' : j.approvalStatus === 'REJECTED' ? 'Rejected by HSE' : 'Not sent to HSE'
  const eta = j.status === 'Completed' ? j.actualArrival : j.etaAt ?? j.expectedArrival
  const gaugeTag = { Started: 'STARTED', InProgress: 'IN TRANSIT', Delayed: 'IN TRANSIT', Interrupted: 'NO SIGNAL', Completed: 'ARRIVED', Scheduled: 'SCHEDULED' }[j.status] ?? (STATUS_META[j.display]?.label ?? '').toUpperCase()

  return (
    <JourneyShell {...props} crumb={j.ref}>
      {/* Header */}
      <div className="j-card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16, padding: '14px 18px' }}>
        <button type="button" className="j-iconbtn" onClick={() => navigate('/journeys')} aria-label="Back to Journeys"><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="j-title" style={{ fontSize: 22 }}><b>{j.vehicleLabel}</b> · {j.title}</h1>
          <div className="j-label" style={{ marginTop: 4, fontSize: 12.5 }}>
            {j.ref} · {j.driverName || 'No driver'} · {hse}{j.customer ? ` · ${j.customer}` : ''}{j.priority !== 'Normal' ? ` · ${j.priority}` : ''}
          </div>
        </div>
        <StatusPill journey={j} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {j.can.edit && <Link to={`/journeys/${j.id}/edit`} className="j-btn j-btn--sm" style={{ textDecoration: 'none' }}><Pencil size={13} /> Edit</Link>}
          {j.can.submit && <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy} onClick={() => act(() => submitJourney(j.id))}><Send size={13} /> Send for HSE approval</button>}
          {j.can.cancel && <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => setCancelling(c => !c)}><Ban size={13} /> Cancel journey</button>}
          {j.can.delete && <button type="button" className="j-btn j-btn--sm j-btn--danger" disabled={busy} onClick={() => window.confirm('Delete this draft?') && act(() => deleteJourney(j.id), () => navigate('/journeys'))}><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      <ErrorNote error={error} />
      {warnings.map(w => <div key={w} className="j-card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13, borderColor: 'rgba(246,200,112,.5)' }}>{w}</div>)}
      {j.display === 'Rejected' && j.rejectReason && <div className="j-card" style={{ marginBottom: 12, padding: '12px 16px', borderColor: 'rgba(255,143,128,.5)' }}><b>Rejected by {j.decidedByName}:</b> {j.rejectReason}</div>}

      {cancelling && (
        <div className="j-card" style={{ marginBottom: 16 }}>
          <div className="j-field"><span>Why is it cancelled?{onRoad ? '' : ' (optional)'}</span>
            <textarea className="j-textarea" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="j-btn j-btn--sm" onClick={() => setCancelling(false)}>Back</button>
            <button type="button" className="j-btn j-btn--sm j-btn--danger" disabled={busy} onClick={() => act(() => cancelJourney(j.id, reason.trim() || null), () => setCancelling(false))}>Cancel journey</button>
          </div>
        </div>
      )}

      {j.display === 'Pending' && (j.can.approve || rejecting) && (
        <div className="j-card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShieldCheck size={20} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="j-strong">Waiting for HSE approval</div>
            <div className="j-label">Sent by {j.submittedByName} at {dayTime(j.submittedAt)}</div>
          </div>
          {!rejecting ? (
            <>
              <button type="button" className="j-btn" disabled={busy} onClick={() => setRejecting(true)}><X size={14} /> Reject</button>
              <button type="button" className="j-btn j-btn--primary" disabled={busy} onClick={() => act(() => approveJourney(j.id))}><Check size={14} /> Approve</button>
            </>
          ) : (
            <div style={{ width: '100%' }}>
              <textarea className="j-textarea" rows={2} placeholder="Why are you rejecting it? The creator will see this." value={reason} onChange={e => setReason(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="j-btn j-btn--sm" onClick={() => setRejecting(false)}>Back</button>
                <button type="button" className="j-btn j-btn--sm j-btn--danger" disabled={busy || reason.trim().length < 3} onClick={() => act(() => rejectJourney(j.id, reason.trim()), () => setRejecting(false))}><X size={13} /> Send rejection</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Row 1: compliance · distance gauge · stops */}
      <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', marginBottom: 16 }}>
        <div className="j-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', minHeight: 220 }}>
          <div className="j-big" style={{ fontSize: 84 }}>{comp.pct == null ? '—' : <>{comp.pct}<small style={{ fontSize: 40 }}>%</small></>}</div>
          <div style={{ marginTop: 10, fontSize: 14, color: 'var(--j-text2)' }}>
            {comp.pct == null ? 'Nothing to judge yet' : comp.pct >= 85 ? 'Journey compliance is good' : comp.pct >= 60 ? 'Journey compliance needs attention' : 'Journey compliance is poor'}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--j-text2)' }}>
            based on <span className="j-pill j-pill--plain" data-tone="ok" style={{ background: 'rgba(126,226,168,.16)' }}>{comp.checks} HSE check{comp.checks === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className="j-card">
          <div className="j-card-head"><h2 className="j-card-title">Distance driven</h2></div>
          <HalfGauge value={planned ? done / planned : 0} label={<>{Math.round(done)}<small style={{ fontSize: 16, marginLeft: 4 }}>km</small></>} sub={`from ${Math.round(planned)} km planned`} tag={gaugeTag} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12.5 }}>
            <span className="j-label">Left <b className="j-strong">{j.actualStart ? hhmm(j.actualStart) : '—'}</b> <span className="j-muted">plan {hhmm(j.plannedStart)}</span></span>
            <span className="j-label">Driving <b className="j-strong">{duration(j.plannedDriveMin)}</b> planned</span>
          </div>
        </div>

        <div className="j-card">
          <div className="j-card-head"><h2 className="j-card-title">Stops</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>{j.stopsDone} of {n - 1} reached</span></div>
          {j.stops.map((s, i) => {
            const isFirst = i === 0, isLast = i === n - 1
            const left = isFirst ? s.actualDepart : null
            const actual = isFirst ? left : s.actualArrive
            const plannedT = isFirst ? s.plannedDepart : s.plannedArrive
            const timing = isFirst ? { timing: s.departTiming, diff: s.departDiffMin } : { timing: s.arriveTiming, diff: s.arriveDiffMin }
            return (
              <div key={s.seq} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? '1px solid rgba(255,255,255,.06)' : 'none' }}>
                <span className="j-badge" data-s={stopDone(s) || (isLast && s.status === 'ARRIVED') ? 'done' : s.status === 'ARRIVED' ? 'now' : ''}>{stopMark(i, n)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="j-strong" style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  {s.signatureRequired && !isFirst && <div className="j-label">{s.signature ? `Signed by ${s.signature.signedByName || '—'}` : 'Signature pending'}</div>}
                  {s.status === 'SKIPPED' && <div className="j-err">Missed</div>}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5 }}>
                  <div>{actual ? <>{isFirst ? 'left' : 'arrived'} <b className="j-strong">{hhmm(actual)}</b></> : <span className="j-muted">{isFirst ? 'leaves' : 'exp.'} {hhmm(plannedT)}</span>}</div>
                  {timing.timing ? <TimingChip timing={timing.timing} diffMin={timing.diff} compact /> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Row 2: route progress per leg */}
      <div className="j-card" style={{ marginBottom: 16 }}>
        <div className="j-card-head"><h2 className="j-card-title">Route progress</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>planned vs actual, leg by leg</span></div>
        <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
          {j.stops.slice(1).map((s, k) => {
            const i = k + 1
            const a = j.stops[i - 1]
            const legDone = s.status !== 'PENDING'
            const startKm = a.alongKm ?? 0, endKm = s.alongKm ?? startKm
            const frac = legDone ? 1 : endKm > startKm ? Math.max(0, Math.min(1, ((j.progressKm ?? 0) - startKm) / (endKm - startKm))) : 0
            const actualMin = a.actualDepart && s.actualArrive ? Math.round((new Date(s.actualArrive) - new Date(a.actualDepart)) / 60000) : null
            return (
              <div key={s.seq} className="j-inset">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                  <span className="j-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stopMark(i - 1, n)} → {stopMark(i, n)} · {s.name}</span>
                  <span className="j-muted">{Math.round(s.legKm ?? 0)} km</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
                  <span className="j-dot" style={{ background: '#f3f7f9' }} />
                  <div className="j-bar" style={{ flex: 1 }}><i style={{ width: `${frac * 100}%` }} /></div>
                  <span className="j-dot" data-tone={legDone ? 'ok' : 'muted'} />
                </div>
                <div className="j-label">Planned {duration(s.legDriveMin)}{actualMin != null ? ` · actual ${duration(actualMin)}` : ''}{s.stayMin && i < n - 1 ? ` · stay ${duration(s.stayMin)}` : ''}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Row 3: map */}
      <div className="j-card j-card--flush" style={{ position: 'relative', marginBottom: 16 }}>
        <JourneyMap path={j.plannedPath} stops={j.stops} progressKm={j.status === 'Completed' ? 1e9 : j.progressKm ?? 0} vehicle={vehicle} height={440} fitKey={j.id} />
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, display: 'flex', gap: 14, fontSize: 12 }} className="j-pill j-pill--plain">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, height: 3, background: '#fff', display: 'inline-block' }} /> Driven</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 18, height: 0, borderTop: '2px dashed #fff', display: 'inline-block' }} /> Planned, still to go</span>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="j-card" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div className="j-label">Distance to arrival</div>
          <div className="j-num"><b style={{ fontWeight: 500 }}>{Math.round(remaining)}</b> <span className="j-muted">/ {Math.round(planned)} km</span></div>
        </div>
        <div className="j-ticks j-hide-sm" style={{ flex: 1, minWidth: 120 }}>
          <span style={{ position: 'absolute', top: -3, left: `calc(${planned ? (done / planned) * 100 : 0}% - ${planned ? (done / planned) * 28 : 0}px)`, width: 28, height: 28, borderRadius: '50%', border: '2px solid #fff', background: 'rgba(30,45,54,.9)', boxShadow: '0 0 0 4px rgba(255,255,255,.12)' }} />
        </div>
        <div>
          <div className="j-label">{j.status === 'Completed' ? 'Arrived' : 'ETA'}</div>
          <div className="j-num">{hhmm(eta)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {j.driverMobile && <a className="j-btn j-btn--primary" href={`tel:${j.driverMobile}`} style={{ textDecoration: 'none' }}><Phone size={14} /> Call driver</a>}
          <Link className="j-btn" to="/tracking" style={{ textDecoration: 'none' }}><MapPinned size={14} /> View on Live Map</Link>
        </div>
      </div>

      {/* Timeline + proof of delivery · events */}
      <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start' }}>
        <div className="j-card">
          <div className="j-card-head"><h2 className="j-card-title">Timeline</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>planned vs actual · on time = within ±{j.settings.onTimeMin} min</span></div>
          <div className="j-tl">
            {j.stops.map((s, i) => {
              const isFirst = i === 0, isLast = i === n - 1
              const st = stopDone(s) || (isLast && s.status === 'ARRIVED') ? 'done' : s.status === 'ARRIVED' ? 'now' : ''
              return (
                <div key={s.seq} className="j-tl-row" data-done={st === 'done'}>
                  <span className="j-badge" data-s={st}>{stopMark(i, n)}</span>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span className="j-strong">{s.name}</span>
                      <span className="j-label">{s.arrivalType === 'GEOFENCE' ? 'Geofence' : `Radius ${s.radiusM} m`}{s.stayMin && !isFirst && !isLast ? ` · stay ${duration(s.stayMin)}` : ''}{s.checkInSource === 'AUTO' && s.actualArrive ? ' · Auto check-in' : ''}</span>
                    </div>
                    {!isFirst && (
                      <TimeLine label="Arrive" planned={s.plannedArrive} actual={s.actualArrive} timing={s.arriveTiming} diff={s.arriveDiffMin} />
                    )}
                    {!isLast && (
                      <TimeLine label="Leave" planned={s.plannedDepart} actual={s.actualDepart} timing={s.departTiming} diff={s.departDiffMin} />
                    )}
                    {s.status === 'SKIPPED' && <div className="j-err" style={{ marginTop: 4 }}>Stop missed</div>}
                    {!isFirst && s.signatureRequired && (
                      <div className="j-inset" style={{ marginTop: 8, padding: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <PenTool size={14} />
                          <span style={{ flex: 1, fontSize: 12.5 }}>
                            {s.signature ? <>Signed by <b>{s.signature.signedByName || '—'}</b> at {dayTime(s.signature.signedAt)}{s.signature.source === 'DRIVER_APP' ? ' (driver app)' : ''}</> : 'Delivery – signature pending'}
                          </span>
                          {!s.signature && j.can.sign && j.status !== 'Cancelled' && signing !== s.seq && <button type="button" className="j-btn j-btn--sm" onClick={() => setSigning(s.seq)}>Sign here</button>}
                        </div>
                        {s.signature && sigImg[s.seq] && <img src={sigImg[s.seq]} alt={`Signature at ${s.name}`} style={{ marginTop: 8, maxWidth: '100%', height: 90, objectFit: 'contain', background: '#f3f7f9', borderRadius: 10 }} />}
                        {signing === s.seq && (
                          <div style={{ marginTop: 10 }}>
                            <SignaturePad busy={busy} onCancel={() => setSigning(null)} onSave={body => act(() => signStop(j.id, s.seq, body), () => setSigning(null))} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="j-card">
          <div className="j-card-head"><h2 className="j-card-title">What happened</h2><span className="j-card-sub" style={{ marginLeft: 'auto' }}>{j.events.length} events</span></div>
          {j.can.note && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input className="j-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (a call with the driver…)" aria-label="Note" />
              <button type="button" className="j-btn" disabled={!note.trim() || busy} onClick={() => act(() => addJourneyNote(j.id, note.trim()), () => setNote(''))}><MessageSquarePlus size={14} /></button>
            </div>
          )}
          {j.events.length === 0 && <div className="j-empty" style={{ padding: 20 }}>Nothing yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
            {j.events.map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span className="j-dot" data-tone={eventTone(e.type)} style={{ marginTop: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="j-strong" style={{ fontSize: 13 }}>{e.type === 'STATUS' ? `${STATUS_META[e.toStatus]?.label ?? e.toStatus}` : EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="j-label">{dayTime(e.occurredAt)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--j-text2)' }}>{e.message}{e.durationSec ? ` · ${duration(e.durationSec / 60)}` : ''}{e.actorName && e.type === 'NOTE' ? ` — ${e.actorName}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
          {j.violations.length > 0 && (
            <>
              <div className="j-caps" style={{ margin: '16px 0 6px' }}>Device and alert-rule violations in this journey</div>
              {j.violations.map(v => (
                <div key={v.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 12.5 }}>
                  <span className="j-dot" data-tone={v.severity === 'High' || v.severity === 'Critical' ? 'bad' : 'warn'} style={{ marginTop: 5 }} />
                  <span style={{ flex: 1 }}><b>{v.title}</b> · {v.message}</span>
                  <span className="j-label">{hhmm(v.occurredAt)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </JourneyShell>
  )
}

function TimeLine({ label, planned, actual, timing, diff }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, fontSize: 12.5, flexWrap: 'wrap' }}>
      <span className="j-label" style={{ width: 42 }}>{label}</span>
      <span className="j-muted">plan <b style={{ color: 'var(--j-text2)' }}>{hhmm(planned)}</b></span>
      <span>{actual ? <>actual <b className="j-strong">{hhmm(actual)}</b></> : <span className="j-muted">—</span>}</span>
      {timing && <TimingChip timing={timing} diffMin={diff} />}
      {!timing && diff != null && <span className="j-muted">{diffText(diff)}</span>}
    </div>
  )
}
