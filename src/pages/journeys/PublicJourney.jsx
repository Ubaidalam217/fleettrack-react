import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Truck, Clock, MapPin, Check, QrCode, LogIn, Camera, PenTool, ClipboardList, X, AlertTriangle, Navigation } from 'lucide-react'
import JourneyMap from '../../components/journeys/JourneyMap'
import SignaturePad from '../../components/journeys/SignaturePad'
import { JModal } from '../../components/journeys/JourneyDialogs'
import { FormFields } from '../../components/journeys/JourneyExtras'
import { TimingChip } from '../../components/journeys/JourneyBits'
import { publicJourney, driverCheckIn, driverForm, driverPhoto, driverSignature, hhmm, dayTime, STATUS_META, stopMark, PURPOSE_LABEL } from '../../data/journeys'
import { photoJpegBase64 } from '../../utils/imageUpload'
import './jms.css'

/**
 * A journey's public pages, no login (client 2026-11-21, after Uffizio's
 * "Send tracking link" and its driver app):
 *
 *   /share/journey/:token   the tracking link — where the vehicle is, the
 *                           stops done and ahead, the ETA (for the customer).
 *   /driver/journey/:token  the driver link — the same on the driver's phone,
 *                           plus at each stop: check in (a QR stop is scanned
 *                           with the camera, or its code typed), the stop's
 *                           form, a photo and the delivery signature.
 *
 * Everything goes through the link's token (routes/journeyPublic.js).
 */

const isDone = s => ['ARRIVED', 'DEPARTED', 'PASSED', 'SKIPPED'].includes(s.status)

export default function PublicJourney({ driver = false }) {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await publicJourney(token))
      setError(null)
    } catch (e) {
      setError(e.status === 410 ? 'This link has expired.' : e.status === 404 ? 'This link does not exist or was switched off.' : e.message)
    }
  }, [token])
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const j = data?.journey
  const meta = j ? STATUS_META[j.display] ?? STATUS_META.Draft : null
  const n = j?.stops.length ?? 0
  const nextIdx = j ? j.stops.findIndex(s => !isDone(s)) : -1

  return (
    <div className="jms-theme" style={{ minHeight: '100vh' }}>
      <div className="j-page" style={{ maxWidth: 980 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <img src="/logo/fleetmax-logo-sea.png" alt="FleetmaxX" style={{ height: 22, filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
          <span className="j-crumb" style={{ margin: 0 }}>{driver ? 'Driver' : 'Live journey'}</span>
        </div>
        {error && <div className="j-card" style={{ borderColor: 'var(--j-bad)' }}><AlertTriangle size={16} /> {error}</div>}
        {!j && !error && <div className="j-skel" style={{ height: 300 }} />}
        {j && (
          <>
            <div className="j-card" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h1 className="j-title" style={{ fontSize: 22 }}><b>{j.vehicleLabel}</b> · {j.title}</h1>
                  <div className="j-label" style={{ marginTop: 4 }}>{j.ref}{j.driverName ? ` · ${j.driverName}` : ''}{j.customer ? ` · ${j.customer}` : ''}</div>
                </div>
                <span className="j-pill" data-tone={meta.tone}>{meta.label}</span>
              </div>
              <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 14 }}>
                <div><div className="j-label">{j.actualStart ? 'Left' : 'Leaves'}</div><div className="j-num">{hhmm(j.actualStart ?? j.plannedStart)}</div></div>
                <div><div className="j-label">{j.status === 'Completed' ? 'Arrived' : 'Arrives about'}</div><div className="j-num">{hhmm(j.status === 'Completed' ? j.actualArrival : j.etaAt ?? j.expectedArrival)}</div></div>
                <div><div className="j-label">Still to go</div><div className="j-num">{j.status === 'Completed' ? 0 : Math.round(j.remainingKm ?? j.plannedDistanceKm ?? 0)} km</div></div>
                <div><div className="j-label">Stops reached</div><div className="j-num">{j.stops.filter((s, i) => i > 0 && isDone(s)).length} / {n - 1}</div></div>
              </div>
              {j.delayMin != null && ['InProgress', 'Delayed', 'Started'].includes(j.status) && (
                <div className="j-label" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}><Clock size={13} /> {j.delayMin > 5 ? `Running about ${j.delayMin} min late.` : j.delayMin < -5 ? `Running about ${-j.delayMin} min early.` : 'On time.'}</div>
              )}
              {driver && j.instructions && <div className="j-inset" style={{ marginTop: 12, fontSize: 13 }}><b>Notes:</b> {j.instructions}</div>}
            </div>

            <div className="j-card j-card--flush" style={{ marginBottom: 14 }}>
              <JourneyMap path={j.plannedPath} stops={j.stops} progressKm={j.status === 'Completed' ? 1e9 : j.progressKm ?? 0}
                vehicle={j.position ? { lat: j.position.lat, lng: j.position.lng, label: j.vehicleLabel } : null}
                height={typeof window !== 'undefined' && window.innerWidth < 640 ? 300 : 420} fitKey={j.ref} showNames={false} />
              <div className="j-label" style={{ padding: '8px 14px' }}>{j.position?.at ? `Position at ${dayTime(j.position.at)}` : 'The position shows once the journey has started.'} · updates every {data.refreshSec} s</div>
            </div>

            {note && <div className="j-card" style={{ marginBottom: 12, padding: '10px 14px', borderColor: note.bad ? 'var(--j-bad)' : 'rgba(126,226,168,.5)', fontSize: 13 }}>{note.text}</div>}

            <div className="j-card">
              <div className="j-card-head"><MapPin size={16} /><h2 className="j-card-title">Stops</h2></div>
              {j.stops.map((s, i) => (
                <StopRow key={s.seq} s={s} i={i} n={n} next={i === nextIdx} driver={driver && j.canAct} token={token}
                  onDone={text => { setNote({ text }); load() }} onError={text => setNote({ text, bad: true })} />
              ))}
            </div>
            <div className="j-label" style={{ textAlign: 'center', marginTop: 14 }}>Link open until {dayTime(data.expiresAt)} · FleetmaxX</div>
          </>
        )}
      </div>
    </div>
  )
}

function StopRow({ s, i, n, next, driver, token, onDone, onError }) {
  const [open, setOpen] = useState(null) // 'scan' | 'form' | 'sign'
  const [busy, setBusy] = useState(false)
  const [answers, setAnswers] = useState({})
  const [errs, setErrs] = useState({})
  const photo = useRef(null)
  const done = isDone(s)
  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); setOpen(null); onDone(ok) } catch (e) { onError(e.details ? String(Object.values(e.details)[0]) : e.message); if (e.details) setErrs(e.details) } finally { setBusy(false) }
  }
  const here = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve({})
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 5000, maximumAge: 60_000 })
  })
  const checkIn = async code => run(async () => driverCheckIn(token, s.seq, { code: code ?? null, ...(await here()) }), `Checked in at ${s.name}.`)
  const isLast = i === n - 1
  const timing = i === 0 ? { t: s.departTiming, d: s.departDiffMin } : { t: s.arriveTiming, d: s.arriveDiffMin }

  return (
    <div style={{ padding: '12px 0', borderTop: i ? '1px solid var(--j-line)' : 'none' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="j-badge" data-s={done ? 'done' : next ? 'now' : ''}>{stopMark(i, n)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="j-strong" style={{ fontSize: 14 }}>{s.name}</div>
          <div className="j-label">
            {i === 0 ? (s.actualDepart ? `Left ${hhmm(s.actualDepart)}` : `Leaves ${hhmm(s.plannedDepart)}`) : s.actualArrive ? `Arrived ${hhmm(s.actualArrive)}` : `Expected ${hhmm(s.plannedArrive)}`}
            {s.purpose ? ` · ${PURPOSE_LABEL[s.purpose]}` : ''}{s.status === 'SKIPPED' ? ' · missed' : ''}
          </div>
        </div>
        {timing.t ? <TimingChip timing={timing.t} diffMin={timing.d} compact /> : done && <Check size={16} />}
      </div>
      {driver && i > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingLeft: 40 }}>
          {s.status === 'PENDING' && (s.visitVia === 'QR'
            ? <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy} onClick={() => setOpen('scan')}><QrCode size={13} /> Scan QR to check in</button>
            : <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy} onClick={() => window.confirm(`Check in at ${s.name}${isLast ? ' (the end of the journey)' : ''}?`) && checkIn(null)}><LogIn size={13} /> Check in</button>)}
          {s.formFields?.length > 0 && !s.formDone && <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => setOpen('form')}><ClipboardList size={13} /> Fill the form</button>}
          {s.formDone && <span className="j-pill" data-tone="ok">Form filled</span>}
          <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={e => {
            const f = e.target.files?.[0]
            if (f) run(async () => driverPhoto(token, s.seq, { data: await photoJpegBase64(f) }), 'Photo saved.')
            e.target.value = ''
          }} />
          <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => photo.current?.click()}><Camera size={13} /> Photo{s.photoCount ? ` (${s.photoCount})` : ''}</button>
          {s.signatureRequired && !s.signed && <button type="button" className="j-btn j-btn--sm" disabled={busy} onClick={() => setOpen('sign')}><PenTool size={13} /> Signature</button>}
          {s.signed && <span className="j-pill" data-tone="ok">Signed</span>}
        </div>
      )}
      {open === 'scan' && <Scanner stop={s} busy={busy} onClose={() => setOpen(null)} onCode={code => checkIn(code)} error={errs.code} />}
      {open === 'form' && (
        <JModal title={`${s.name}: form`} onClose={() => setOpen(null)}
          footer={<><button type="button" className="j-btn" onClick={() => setOpen(null)}>Cancel</button><button type="button" className="j-btn j-btn--primary" disabled={busy} onClick={() => run(() => driverForm(token, s.seq, answers), 'Form saved.')}>Save</button></>}>
          <FormFields fields={s.formFields} answers={answers} setAnswers={setAnswers} errors={errs}
            onPhoto={async (key, f) => { const p = await driverPhoto(token, s.seq, { data: await photoJpegBase64(f), fieldKey: key }); setAnswers(a => ({ ...a, [key]: p.id })) }} />
        </JModal>
      )}
      {open === 'sign' && (
        <JModal title={`${s.name}: delivery signature`} sub="The person receiving signs with a finger." onClose={() => setOpen(null)}>
          <SignaturePad busy={busy} onCancel={() => setOpen(null)} onSave={body => run(() => driverSignature(token, s.seq, body), 'Signature saved.')} />
        </JModal>
      )}
    </div>
  )
}

/**
 * The QR scanner: the phone's camera through the browser (BarcodeDetector
 * where the browser has it, else jsQR on the video frames); the code can
 * always be typed instead.
 */
function Scanner({ stop, onCode, onClose, busy, error }) {
  const video = useRef(null)
  const [typed, setTyped] = useState('')
  const [camErr, setCamErr] = useState(null)
  useEffect(() => {
    let stream, raf, stopped = false
    let detector = null
    const canvas = document.createElement('canvas')
    async function startCam() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (stopped) return
        video.current.srcObject = stream
        await video.current.play()
        if ('BarcodeDetector' in window) {
          try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { detector = null }
        }
        const jsQR = detector ? null : (await import('jsqr')).default
        const tick = async () => {
          if (stopped) return
          const v = video.current
          if (v && v.readyState >= 2) {
            let text = null
            if (detector) {
              const found = await detector.detect(v).catch(() => [])
              text = found[0]?.rawValue ?? null
            } else {
              canvas.width = v.videoWidth; canvas.height = v.videoHeight
              const ctx = canvas.getContext('2d', { willReadFrequently: true })
              ctx.drawImage(v, 0, 0)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              text = jsQR(img.data, img.width, img.height)?.data ?? null
            }
            if (text) { stopped = true; onCode(text); return }
          }
          raf = setTimeout(tick, 250)
        }
        tick()
      } catch (e) {
        setCamErr(e?.name === 'NotAllowedError' ? 'The camera was not allowed. Type the code instead.' : 'No camera here. Type the code instead.')
      }
    }
    if (navigator.mediaDevices?.getUserMedia) startCam()
    else setCamErr('This browser cannot use the camera. Type the code instead.')
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach(t => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <JModal title={`Scan the QR at ${stop.name}`} onClose={onClose} width={480}
      footer={<><button type="button" className="j-btn" onClick={onClose}><X size={13} /> Close</button><button type="button" className="j-btn j-btn--primary" disabled={busy || typed.trim().length < 4} onClick={() => onCode(typed.trim())}><Navigation size={13} /> Check in with the code</button></>}>
      {!camErr && <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 14, background: '#000', aspectRatio: '4 / 3', objectFit: 'cover' }} />}
      {camErr && <div className="j-warn-text" style={{ fontSize: 13 }}>{camErr}</div>}
      <label className="j-field" style={{ marginTop: 12 }}>
        <span>Or type the code printed under the QR</span>
        <input className="j-input" value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} placeholder="e.g. K7Q2MX" autoCapitalize="characters" style={{ letterSpacing: '.15em', fontFamily: 'monospace', fontSize: 18 }} />
      </label>
      {error && <div className="j-err" style={{ marginTop: 6 }}>{error}</div>}
      <div className="j-label" style={{ marginTop: 8 }}><Truck size={12} /> Checking in records where you are, if the phone allows it.</div>
    </JModal>
  )
}
