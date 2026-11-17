import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { History, PenLine, Route, Plus, X, ChevronDown, ChevronUp, Send, Check, AlertTriangle, MapPin, Undo2 } from 'lucide-react'
import JourneyShell from './JourneyShell'
import JourneyMap from '../../components/journeys/JourneyMap'
import { ErrorNote } from '../../components/journeys/JourneyBits'
import {
  journeyOptions, journeyAvailability, routeFromTrip, getJourney, createJourney, updateJourney, saveRouteTemplate,
  hhmm, duration, toLocalInput, fromLocalInput, uaeDay,
  stopMark,
} from '../../data/journeys'
import { errorMessage } from '../../data/http'
import { computeSchedule, overrideArrival } from '../../utils/journeySchedule'
import { stopsAlong, distM, pathKm } from '../../utils/journeyGeo'

/**
 * New Journey / Edit journey (design §A.7 + the client's voice note of
 * 2026-11-17, point 3): the chained schedule. The planner sets the start;
 * each leg's drive time comes from the past trip the route was copied from,
 * or the route km ÷ the planned speed (Journey settings); each stop has a stay.
 * Every stop's planned arrive / leave adds up below, live. Any leg's drive
 * time or any stop's arrival can be overridden; the times after it shift.
 */

let keySeq = 0
const newStop = (over = {}) => ({
  key: ++keySeq, name: '', arrivalType: 'RADIUS', geofenceId: null, lat: null, lng: null, radiusM: null,
  stayMin: 0, legDriveMin: null, legSource: 'SPEED', signatureRequired: false, ...over,
})

function defaultStart() {
  const d = new Date(Date.now() + 2 * 3600_000)
  d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 15) * 15, 0, 0)
  return toLocalInput(d.toISOString())
}

/**
 * Leg times from the copied trip: the DRIVING time between its closest
 * approaches to each stop (path column 3, from the server), so a long park
 * on the way does not count as driving.
 */
function tripLegTimes(trip, stops) {
  if (!trip?.path?.length) return null
  let from = 0
  const at = stops.map(s => {
    if (!Number.isFinite(s.lat)) return null
    let best = Infinity, idx = from
    for (let i = from; i < trip.path.length; i++) {
      const d = distM([s.lat, s.lng], trip.path[i])
      if (d < best) { best = d; idx = i }
    }
    from = idx
    return best < 3000 ? trip.path[idx][3] ?? trip.path[idx][2] : null
  })
  return at.map((t, i) => (i === 0 || t == null || at[i - 1] == null ? null : Math.max(1, Math.round((t - at[i - 1]) / 60))))
}

export default function JourneyForm(props) {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const [opts, setOpts] = useState(null)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(!editing)

  const [title, setTitle] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [routeSource, setRouteSource] = useState('STRAIGHT')
  const [path, setPath] = useState(null)
  const [recordedFrom, setRecordedFrom] = useState(null)
  const [templateId, setTemplateId] = useState(null)
  const [stops, setStops] = useState(() => [newStop({ name: '' }), newStop({ name: '' })])
  const [instructions, setInstructions] = useState('')
  const [more, setMore] = useState(false)
  const [customer, setCustomer] = useState('')
  const [priority, setPriority] = useState('Normal')
  const [type, setType] = useState('')
  const [saveRoute, setSaveRoute] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [clickMode, setClickMode] = useState('stop')
  const [trip, setTrip] = useState(null)
  const [tripForm, setTripForm] = useState(() => { const [f] = uaeDay(-1); return { vehicleId: '', from: toLocalInput(f), to: toLocalInput(new Date(Date.parse(f) + 86_400_000 - 60_000).toISOString()) } })
  const [tripBusy, setTripBusy] = useState(false)
  const [tripOpen, setTripOpen] = useState(false)
  const [avail, setAvail] = useState(null)

  useEffect(() => {
    journeyOptions().then(setOpts).catch(e => setError(errorMessage(e, 'Could not load vehicles and drivers')))
  }, [])

  // Edit: fill the form from the journey.
  useEffect(() => {
    if (!editing) return
    getJourney(id).then(j => {
      setTitle(j.title); setVehicleId(j.vehicleId ?? ''); setDriverId(j.driverId ?? ''); setStart(toLocalInput(j.plannedStart))
      setRouteSource(j.routeSource); setPath(j.plannedPath ?? null); setRecordedFrom(j.recordedFrom ?? null); setTemplateId(j.routeTemplateId ?? null)
      setStops(j.stops.map(s => newStop({ ...s, legSource: s.legSource ?? 'SPEED', polygon: undefined })))
      setInstructions(j.instructions ?? ''); setCustomer(j.customer ?? ''); setPriority(j.priority); setType(j.type)
      setLoaded(true)
    }).catch(e => setError(errorMessage(e, 'Could not load the journey')))
  }, [editing, id])

  const settings = opts?.settings
  const geofenceById = useMemo(() => new Map((opts?.geofences ?? []).map(g => [g.id, g])), [opts])
  const driver = opts?.drivers.find(d => d.id === driverId)

  // Geofence stops take the geofence's centre (the server snapshots the exact shape).
  const placed = useMemo(() => stops.map(s => {
    if (s.arrivalType !== 'GEOFENCE' || !s.geofenceId) return s
    const g = geofenceById.get(s.geofenceId)
    if (!g) return s
    if (g.shape === 'CIRCLE') return { ...s, lat: g.centerLat, lng: g.centerLng, radiusM: Math.round(g.radius) }
    const pts = Array.isArray(g.points) ? g.points : []
    if (!pts.length) return s
    return { ...s, lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length, polygon: pts }
  }), [stops, geofenceById])

  const ready = placed.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  const line = routeSource !== 'STRAIGHT' && path?.length >= 2 ? path : null

  const schedule = useMemo(() => {
    if (!ready) return null
    const along = stopsAlong(line, placed)
    const withKm = placed.map((s, i) => ({ ...s, legKm: i === 0 ? 0 : Math.max(0, along[i] - along[i - 1]) }))
    return computeSchedule({ plannedStart: fromLocalInput(start), speedKmh: settings?.plannedSpeedKmh ?? 70, stops: withKm })
  }, [placed, ready, line, start, settings])

  const distanceKm = line ? pathKm(line) : schedule?.distanceKm ?? 0

  // "Free at this time" for the chosen vehicle.
  const expected = schedule?.expectedArrival?.toISOString()
  useEffect(() => {
    if (!vehicleId || !expected) { setAvail(null); return undefined }
    const t = setTimeout(() => {
      journeyAvailability({ vehicleId, from: fromLocalInput(start), to: expected, excludeId: id, driverId: driverId || undefined })
        .then(setAvail).catch(() => setAvail(null))
    }, 400)
    return () => clearTimeout(t)
  }, [vehicleId, driverId, start, expected, id])

  const setStop = (i, patch) => setStops(list => list.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const removeStop = i => setStops(list => (list.length <= 2 ? list : list.filter((_, k) => k !== i)))
  const moveStop = (i, d) => setStops(list => {
    const j = i + d
    if (j < 0 || j >= list.length) return list
    const out = [...list]
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
  const addStopAt = (lat, lng) => setStops(list => {
    const empty = list.findIndex(s => !Number.isFinite(s.lat) && s.arrivalType === 'RADIUS')
    if (empty >= 0) return list.map((s, k) => (k === empty ? { ...s, lat, lng, name: s.name || (k === 0 ? 'Start' : k === list.length - 1 ? 'Destination' : `Stop ${k}`) } : s))
    const out = [...list]
    out.splice(out.length - 1, 0, newStop({ lat, lng, name: `Stop ${out.length - 1}`, stayMin: 15 }))
    return out
  })
  const onMapClick = ([lat, lng]) => {
    if (routeSource === 'DRAWN' && clickMode === 'draw') setPath(p => [...(p ?? []), [lat, lng]])
    else addStopAt(lat, lng)
  }

  async function copyTrip() {
    setTripBusy(true)
    setError(null)
    try {
      const t = await routeFromTrip({ vehicleId: tripForm.vehicleId || vehicleId, from: fromLocalInput(tripForm.from), to: fromLocalInput(tripForm.to) })
      setTrip(t)
      setPath(t.path.map(p => [p[0], p[1]]))
      setRecordedFrom({ vehicleId: t.vehicleId, vehicleLabel: t.vehicleLabel, from: t.from, to: t.to })
      setRouteSource('PAST_TRIP')
      setTemplateId(null)
      // Empty start / destination take the trip's ends.
      const a = t.path[0], b = t.path[t.path.length - 1]
      setStops(list => {
        const out = list.map(s => ({ ...s }))
        if (!Number.isFinite(out[0].lat)) Object.assign(out[0], { lat: a[0], lng: a[1], name: out[0].name || 'Start' })
        const L = out.length - 1
        if (!Number.isFinite(out[L].lat)) Object.assign(out[L], { lat: b[0], lng: b[1], name: out[L].name || 'Destination' })
        const legs = tripLegTimes(t, out)
        return out.map((s, i) => (i > 0 && legs?.[i] != null && s.legSource !== 'MANUAL' ? { ...s, legDriveMin: legs[i], legSource: 'TRIP' } : s))
      })
      setTripOpen(false)
    } catch (e) {
      setError(errorMessage(e, 'Could not read that trip'))
    } finally {
      setTripBusy(false)
    }
  }

  // Stops moved after copying a trip: re-read their leg times from it.
  useEffect(() => {
    if (!trip || routeSource !== 'PAST_TRIP') return
    const legs = tripLegTimes(trip, placed)
    setStops(list => {
      let changed = false
      const out = list.map((s, i) => {
        if (i === 0 || s.legSource === 'MANUAL') return s
        const want = legs?.[i] ?? null
        const src = want == null ? 'SPEED' : 'TRIP'
        if (s.legDriveMin === want && s.legSource === src) return s
        changed = true
        return { ...s, legDriveMin: want, legSource: src }
      })
      return changed ? out : list
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, routeSource, placed.map(s => `${s.lat},${s.lng}`).join('|')])

  function applyTemplate(tid) {
    const t = opts?.templates.find(x => x.id === tid)
    if (!t) return
    setTemplateId(t.id)
    setRouteSource(t.source)
    setPath(t.path ?? null)
    setRecordedFrom(t.recordedFrom ?? null)
    setTrip(null)
    setStops(t.stops.map(s => newStop({ ...s, legSource: s.legSource ?? 'SPEED' })))
  }

  function setLeg(i, minutes) {
    const v = minutes === '' ? null : Math.max(0, Math.round(Number(minutes)))
    setStop(i, v == null ? { legDriveMin: null, legSource: 'SPEED' } : { legDriveMin: v, legSource: 'MANUAL' })
  }
  function setArrival(i, local) {
    if (!schedule || !local) return
    setStops(list => overrideArrival(list, i, fromLocalInput(local), schedule))
  }

  async function submit(send) {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    const body = {
      title: title.trim(), vehicleId, driverId: driverId || null, plannedStart: fromLocalInput(start),
      routeSource: routeSource === 'STRAIGHT' || !path?.length ? 'STRAIGHT' : routeSource,
      plannedPath: routeSource !== 'STRAIGHT' && path?.length >= 2 ? path : null,
      recordedFrom, routeTemplateId: templateId,
      stops: placed.map(s => ({
        name: s.name.trim() || 'Stop', arrivalType: s.arrivalType, geofenceId: s.geofenceId || null, lat: s.lat, lng: s.lng,
        radiusM: s.arrivalType === 'RADIUS' ? Number(s.radiusM) || settings?.defaultRadiusM || 300 : undefined,
        stayMin: Number(s.stayMin) || 0, legDriveMin: s.legDriveMin, legSource: s.legSource, signatureRequired: Boolean(s.signatureRequired),
      })),
      instructions: instructions.trim() || null, customer: customer.trim() || null, priority, type: type || undefined, submit: send,
    }
    try {
      if (saveRoute && routeName.trim()) {
        await saveRouteTemplate({ name: routeName.trim(), source: body.routeSource, path: body.plannedPath, stops: body.stops, recordedFrom, driveMin: schedule?.driveMin ?? null })
      }
      const res = editing ? await updateJourney(id, body) : await createJourney(body)
      navigate(`/journeys/${res.data.id}`, { state: { warnings: res.warnings } })
    } catch (e) {
      setError(errorMessage(e, 'Could not save the journey'))
      if (e.details) setFieldErrors(e.details)
    } finally {
      setBusy(false)
    }
  }

  const canSave = title.trim() && vehicleId && ready && schedule && !busy
  const n = stops.length

  return (
    <JourneyShell
      {...props}
      crumb={editing ? 'Edit journey' : 'New journey'}
      title={editing ? 'Edit journey' : 'New journey'}
      subtitle="Fill in the basics and the stops. The times add up from the start; HSE approves it before the vehicle leaves."
    >
      <ErrorNote error={error} />
      {!opts || !loaded ? <div className="j-skel" style={{ height: 420 }} /> : (
        <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', alignItems: 'start' }}>
          <div className="j-card" style={{ padding: 22 }}>
            <label className="j-field">
              <span>Journey name</span>
              <input className="j-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Diesel delivery to Ruwais" maxLength={160} />
              {fieldErrors.title && <span className="j-err">{fieldErrors.title}</span>}
            </label>

            <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginTop: 16, gap: 14 }}>
              <label className="j-field">
                <span>Vehicle</span>
                <select className="j-select" value={vehicleId} onChange={e => { setVehicleId(e.target.value); if (!driverId) { const v = opts.vehicles.find(x => x.id === e.target.value); if (v?.driver) setDriverId(v.driver.id) } }}>
                  <option value="">Pick a vehicle…</option>
                  {opts.vehicles.map(v => <option key={v.id} value={v.id}>{v.label}{v.vehicleType ? ` · ${v.vehicleType}` : ''}</option>)}
                </select>
                {avail && (avail.free
                  ? <span className="j-ok-text"><Check size={12} style={{ verticalAlign: -2 }} /> Free at this time</span>
                  : <span className="j-err"><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {avail.message}</span>)}
                {fieldErrors.vehicleId && <span className="j-err">{fieldErrors.vehicleId}</span>}
              </label>
              <label className="j-field">
                <span>Driver</span>
                <select className="j-select" value={driverId} onChange={e => setDriverId(e.target.value)}>
                  <option value="">No driver yet</option>
                  {opts.drivers.filter(d => d.status !== 'Inactive').map(d => <option key={d.id} value={d.id}>{d.name}{d.status === 'Suspended' ? ' (suspended)' : ''}</option>)}
                </select>
                {driver?.problems?.length > 0 && <span className="j-err">{driver.problems[0]}</span>}
                {driver && !driver.problems?.length && <span className="j-ok-text"><Check size={12} style={{ verticalAlign: -2 }} /> Licence valid</span>}
                {avail?.driverWarning && <span className="j-warn-text">{avail.driverWarning}</span>}
              </label>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="j-field"><span>Route</span></div>
              <div className="j-seg" style={{ marginTop: 6, width: '100%', display: 'flex' }}>
                <button type="button" style={{ flex: 1 }} aria-pressed={routeSource === 'PAST_TRIP'} onClick={() => setTripOpen(o => !o)}><History size={14} /> Copy a past trip</button>
                <button type="button" style={{ flex: 1 }} aria-pressed={routeSource === 'DRAWN'} onClick={() => { setRouteSource('DRAWN'); setTrip(null); setRecordedFrom(null); if (routeSource !== 'DRAWN') setPath(null); setClickMode('draw') }}><PenLine size={14} /> Draw on the map</button>
                <button type="button" style={{ flex: 1 }} aria-pressed={routeSource === 'STRAIGHT'} onClick={() => { setRouteSource('STRAIGHT'); setPath(null); setTrip(null); setRecordedFrom(null); setClickMode('stop') }}><Route size={14} /> Straight legs</button>
              </div>

              {tripOpen && (
                <div className="j-inset" style={{ marginTop: 10 }}>
                  <div className="j-label" style={{ marginBottom: 8 }}>Pick a vehicle and when it drove this route; its track becomes the planned route.</div>
                  <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    <select className="j-select" value={tripForm.vehicleId || vehicleId} onChange={e => setTripForm(f => ({ ...f, vehicleId: e.target.value }))} aria-label="Trip vehicle">
                      <option value="">Vehicle…</option>
                      {opts.vehicles.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <input className="j-input" type="datetime-local" value={tripForm.from} onChange={e => setTripForm(f => ({ ...f, from: e.target.value }))} aria-label="Trip from" />
                    <input className="j-input" type="datetime-local" value={tripForm.to} onChange={e => setTripForm(f => ({ ...f, to: e.target.value }))} aria-label="Trip to" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button type="button" className="j-btn j-btn--sm" onClick={() => setTripOpen(false)}>Close</button>
                    <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={tripBusy || !(tripForm.vehicleId || vehicleId)} onClick={copyTrip}>{tripBusy ? 'Reading…' : 'Use this trip'}</button>
                  </div>
                </div>
              )}

              {recordedFrom && routeSource === 'PAST_TRIP' && (
                <div className="j-inset" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <History size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="j-strong" style={{ fontSize: 13 }}>{recordedFrom.vehicleLabel} · {hhmm(recordedFrom.from)} → {hhmm(recordedFrom.to)}</div>
                    <div className="j-label">{Math.round(distanceKm)} km{trip ? ` · ${duration(trip.driveMin)} driving` : ''}</div>
                  </div>
                  <button type="button" className="j-btn j-btn--sm" onClick={() => setTripOpen(true)}>Change</button>
                </div>
              )}
              {routeSource === 'DRAWN' && (
                <div className="j-inset" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PenLine size={16} />
                  <span style={{ flex: 1, fontSize: 12.5 }}>{path?.length ? `${path.length} points · ${Math.round(distanceKm)} km` : 'Click the map along the road to draw the route.'}</span>
                  <div className="j-seg">
                    <button type="button" aria-pressed={clickMode === 'draw'} onClick={() => setClickMode('draw')}>Click draws</button>
                    <button type="button" aria-pressed={clickMode === 'stop'} onClick={() => setClickMode('stop')}>Click adds a stop</button>
                  </div>
                  <button type="button" className="j-btn j-btn--sm" disabled={!path?.length} onClick={() => setPath(p => p.slice(0, -1))}><Undo2 size={13} /> Undo</button>
                </div>
              )}
              {opts.templates.length > 0 && (
                <label className="j-field" style={{ marginTop: 10 }}>
                  <span className="j-label">Or use a saved route</span>
                  <select className="j-select" value={templateId ?? ''} onChange={e => e.target.value && applyTemplate(e.target.value)}>
                    <option value="">Saved routes…</option>
                    {opts.templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.distanceKm ? ` · ${Math.round(t.distanceKm)} km` : ''}</option>)}
                  </select>
                </label>
              )}
            </div>

            <label className="j-field" style={{ marginTop: 18 }}>
              <span>Leaves at</span>
              <input className="j-input" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
              {fieldErrors.plannedStart && <span className="j-err">{fieldErrors.plannedStart}</span>}
            </label>

            {/* The chained schedule: stops with their planned arrive / leave */}
            <div className="j-inset" style={{ marginTop: 16, padding: 14 }}>
              <div className="j-caps" style={{ marginBottom: 12 }}>Stops and times</div>
              <div className="j-tl">
                {stops.map((s, i) => {
                  const sc = schedule?.stops[i]
                  const isFirst = i === 0, isLast = i === n - 1
                  return (
                    <div key={s.key} className="j-tl-row" data-done="false">
                      <span className="j-badge">{stopMark(i, n)}</span>
                      <div className="j-card" style={{ padding: 12, borderRadius: 16, background: 'var(--j-glass3)' }}>
                        {!isFirst && sc && (
                          <div className="j-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            Drive <input className="j-input j-input--sm j-input--num" type="number" min="0" value={s.legSource === 'MANUAL' ? s.legDriveMin ?? '' : sc.legDriveMin} onChange={e => setLeg(i, e.target.value)} aria-label={`Drive time to ${s.name || 'this stop'}`} /> min
                            <span>· {sc.legKm ? `${Math.round(sc.legKm)} km` : ''} · {s.legSource === 'MANUAL' ? 'set by you' : s.legSource === 'TRIP' ? 'from the past trip' : `at ${settings?.plannedSpeedKmh ?? 70} km/h`}</span>
                            {s.legSource === 'MANUAL' && <button type="button" className="j-btn j-btn--sm j-btn--ghost" onClick={() => setLeg(i, '')}>Reset</button>}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span className="j-label" style={{ width: 34 }}>{isFirst ? 'From' : isLast ? 'To' : 'Stop'}</span>
                          <input className="j-input" value={s.name} onChange={e => setStop(i, { name: e.target.value })} placeholder={isFirst ? 'Start' : isLast ? 'Destination' : 'Stop name'} aria-label={`Name of stop ${stopMark(i, n)}`} />
                          {!isFirst && !isLast && <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => removeStop(i)} aria-label="Remove stop"><X size={14} /></button>}
                          <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => moveStop(i, -1)} disabled={isFirst} aria-label="Move up"><ChevronUp size={14} /></button>
                          <button type="button" className="j-iconbtn" style={{ width: 30, height: 30 }} onClick={() => moveStop(i, 1)} disabled={isLast} aria-label="Move down"><ChevronDown size={14} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                          <div className="j-seg">
                            <button type="button" aria-pressed={s.arrivalType === 'GEOFENCE'} onClick={() => setStop(i, { arrivalType: 'GEOFENCE' })}>Geofence</button>
                            <button type="button" aria-pressed={s.arrivalType === 'RADIUS'} onClick={() => setStop(i, { arrivalType: 'RADIUS', geofenceId: null })}>Radius</button>
                          </div>
                          {s.arrivalType === 'GEOFENCE' ? (
                            <select className="j-select" style={{ flex: 1, minWidth: 150, minHeight: 34 }} value={s.geofenceId ?? ''} onChange={e => { const g = geofenceById.get(e.target.value); setStop(i, { geofenceId: e.target.value || null, name: s.name || g?.name || '' }) }} aria-label="Geofence">
                              <option value="">Pick a geofence…</option>
                              {opts.geofences.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          ) : (
                            <span className="j-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <input className="j-input j-input--sm j-input--num" type="number" min="30" step="50" value={s.radiusM ?? settings?.defaultRadiusM ?? 300} onChange={e => setStop(i, { radiusM: e.target.value })} aria-label="Radius in metres" /> m
                              {!Number.isFinite(s.lat) && <span className="j-warn-text"><MapPin size={12} style={{ verticalAlign: -2 }} /> click the map</span>}
                            </span>
                          )}
                          {!isFirst && !isLast && (
                            <span className="j-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              Stay <input className="j-input j-input--sm j-input--num" type="number" min="0" value={s.stayMin} onChange={e => setStop(i, { stayMin: Math.max(0, Number(e.target.value) || 0) })} aria-label="Stay minutes" /> min
                            </span>
                          )}
                        </div>
                        {!isFirst && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--j-text2)' }}>
                            <input type="checkbox" checked={s.signatureRequired} onChange={e => setStop(i, { signatureRequired: e.target.checked })} />
                            Delivery – signature required
                          </label>
                        )}
                        {sc && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                            {isFirst ? <span className="j-label">leave <b className="j-strong">{hhmm(sc.plannedDepart)}</b></span> : (
                              <>
                                <span className="j-label">arrive</span>
                                <input className="j-input j-input--sm" style={{ width: 215 }} type="datetime-local" value={toLocalInput(sc.plannedArrive)} onChange={e => setArrival(i, e.target.value)} aria-label="Planned arrival" />
                                {!isLast && <span className="j-label">leave <b className="j-strong">{hhmm(sc.plannedDepart)}</b></span>}
                              </>
                            )}
                          </div>
                        )}
                        {fieldErrors[`stops.${i}.geofenceId`] && <span className="j-err">{fieldErrors[`stops.${i}.geofenceId`]}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="j-btn j-btn--sm" onClick={() => setStops(list => { const out = [...list]; out.splice(out.length - 1, 0, newStop({ stayMin: 15 })); return out })}>
                <Plus size={13} /> Add a stop <span className="j-muted" style={{ fontWeight: 400 }}>or click the map</span>
              </button>
              {fieldErrors.stops && <div className="j-err" style={{ marginTop: 6 }}>{fieldErrors.stops}</div>}
            </div>

            <label className="j-field" style={{ marginTop: 16 }}>
              <span>Notes for the driver <span className="j-muted" style={{ fontWeight: 400 }}>optional</span></span>
              <textarea className="j-textarea" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Gate pass at Ruwais Gate 2. Call the office from Tarif." />
            </label>

            <div className="j-inset" style={{ marginTop: 14 }}>
              <button type="button" className="j-btn j-btn--ghost" style={{ padding: 0, height: 'auto' }} onClick={() => setMore(m => !m)}>
                {more ? <ChevronUp size={15} /> : <ChevronDown size={15} />} More options <span className="j-muted" style={{ fontWeight: 400 }}>customer, priority, journey type, save the route</span>
              </button>
              {more && (
                <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 12 }}>
                  <label className="j-field"><span>Customer</span>
                    <input className="j-input" list="jms-customers" value={customer} onChange={e => setCustomer(e.target.value)} />
                    <datalist id="jms-customers">{opts.customers.map(c => <option key={c} value={c} />)}</datalist>
                  </label>
                  <label className="j-field"><span>Priority</span>
                    <select className="j-select" value={priority} onChange={e => setPriority(e.target.value)}>{['Normal', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}</select>
                  </label>
                  <label className="j-field"><span>Journey type</span>
                    <select className="j-select" value={type} onChange={e => setType(e.target.value)}>
                      <option value="">Work it out</option><option value="ONE_WAY">One way</option><option value="ROUND_TRIP">Round trip</option><option value="MULTI_STOP">Multiple stops</option>
                    </select>
                  </label>
                  <label className="j-field" style={{ gridColumn: '1 / -1' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={saveRoute} onChange={e => setSaveRoute(e.target.checked)} /> Save this route for next time</span>
                    {saveRoute && <input className="j-input" value={routeName} onChange={e => setRouteName(e.target.value)} placeholder="Mussafah Yard → Ruwais Site B" />}
                  </label>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 20, flexWrap: 'wrap', borderTop: '1px solid var(--j-line)', paddingTop: 18 }}>
              <button type="button" className="j-btn j-btn--ghost" onClick={() => navigate(editing ? `/journeys/${id}` : '/journeys')}>Cancel</button>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="j-btn" disabled={!canSave} onClick={() => submit(false)}>Save as draft</button>
                <button type="button" className="j-btn j-btn--primary" disabled={!canSave || (avail && !avail.free)} onClick={() => submit(true)}><Send size={14} /> Send for HSE approval</button>
              </div>
            </div>
          </div>

          <div style={{ position: 'sticky', top: 0 }}>
            <div className="j-card j-card--flush" style={{ position: 'relative' }}>
              <JourneyMap
                path={line}
                stops={placed}
                height={560}
                onMapClick={onMapClick}
                showAreas
                fitKey={`${templateId}|${recordedFrom?.from}|${loaded}`}
              />
              <span className="j-pill j-pill--plain" style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, background: 'rgba(30,45,54,.88)' }}>
                <MapPin size={12} /> {routeSource === 'DRAWN' && clickMode === 'draw' ? 'Click the map to draw the route' : 'Click the map to add a stop'}
              </span>
            </div>
            <div className="j-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
              {[
                ['Distance', `${Math.round(distanceKm)} km`],
                ['Driving', duration(schedule?.driveMin)],
                ['Stays', duration(schedule?.stayMin)],
                ['Arrives', schedule?.expectedArrival ? hhmm(schedule.expectedArrival) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="j-card" style={{ padding: '10px 12px' }}>
                  <div className="j-label">{k}</div>
                  <div className="j-num" style={{ fontSize: 19 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </JourneyShell>
  )
}
