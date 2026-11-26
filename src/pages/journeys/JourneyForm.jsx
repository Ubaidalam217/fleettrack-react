import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { History, PenLine, Route, Navigation, Plus, X, ChevronDown, ChevronUp, Send, Check, AlertTriangle, MapPin, Undo2, BookMarked, Upload, Copy, LayoutTemplate, Repeat, Thermometer, Truck } from 'lucide-react'
import JourneyShell from './JourneyShell'
import JourneyMap from '../../components/journeys/JourneyMap'
import { useFlespiData } from '../../hooks/useFlespiData'
import { appendStops } from '../../utils/journeyStops'
import { ErrorNote, Toggle } from '../../components/journeys/JourneyBits'
import { JModal, AddressPicker, StopsImport } from '../../components/journeys/JourneyDialogs'
import {
  journeyOptions, journeyAvailability, routeFromTrip, getJourney, createJourney, updateJourney, saveRouteTemplate,
  hhmm, duration, toLocalInput, fromLocalInput, uaeDay, dayTime,
  stopMark, recentJourneys, bulkAddresses, saveJourneyTemplate, PURPOSE_LABEL, roadRoute,
} from '../../data/journeys'
import { applyRoadLegs, clearRoadLegs, estimateBanner, routeKey, routePoints, PROVIDER_LABEL } from '../../utils/roadRoute'
import { upcoming, scheduleErrors, describeSchedule, WEEKDAY_SHORT, uaeDateKey } from '../../utils/journeyRecurrence'
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
  stayMin: 0, legDriveMin: null, legSource: 'SPEED', signatureRequired: false,
  visitVia: 'MAP', purpose: null, loadState: null, addressId: null, formId: null, ...over,
})

/** The plan part of a stop (no actuals), to copy from a journey, a template or a saved route. */
const planOf = s => ({
  name: s.name, arrivalType: s.arrivalType ?? 'RADIUS', geofenceId: s.geofenceId ?? null, lat: s.lat, lng: s.lng, radiusM: s.radiusM ?? null,
  stayMin: s.stayMin ?? 0, legDriveMin: s.legDriveMin ?? null, legSource: s.legSource ?? 'SPEED', signatureRequired: Boolean(s.signatureRequired),
  visitVia: s.visitVia ?? 'MAP', purpose: s.purpose ?? null, loadState: s.loadState ?? null, addressId: s.addressId ?? null, formId: s.formId ?? null,
})

const PURPOSES = ['LOADING', 'UNLOADING', 'DELIVERY', 'REST', 'OTHER']
// Live statuses of a vehicle that is reporting (client 2026-11-26): Driving, Idle and Off
// (ignition off, still reporting). Inactive and No Data vehicles are not offered.
const ACTIVE_LIVE = ['Running', 'Idle', 'Stopped']

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
  // "Road route" is the default (client 2026-11-24): the best road through the stops, from the server.
  const [routeSource, setRouteSource] = useState('ROAD')
  const [road, setRoad] = useState({ status: 'idle', route: null, note: null }) // idle | loading | ok | estimate
  const roadSeq = useRef(0)
  const roadFitted = useRef(false) // the map zooms to the first route only, not on every stop you add
  const roadLoadedKey = useRef(null) // an edited journey keeps its saved line until a stop moves
  const [roadFit, setRoadFit] = useState(0)
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
  // The Uffizio Job-module options (client 2026-11-21).
  const [startLogic, setStartLogic] = useState('ANY_DATA')
  const [startBufferMin, setStartBufferMin] = useState('')
  const [routeToleranceM, setRouteToleranceM] = useState('')
  const [forceCloseH, setForceCloseH] = useState('')
  const [convoy, setConvoy] = useState([])
  const [convoyToleranceM, setConvoyToleranceM] = useState(200)
  const [loadState, setLoadState] = useState('')
  const [tempMin, setTempMin] = useState('')
  const [tempMax, setTempMax] = useState('')
  const [when, setWhen] = useState('FIXED') // FIXED | RELATIVE | AUTOMATIC
  const [sched, setSched] = useState(() => ({ repeat: 'DAILY', weekdays: [], monthDays: [], validFrom: uaeDateKey(Date.now()), validTo: '', horizonDays: 7, name: '' }))
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [dialog, setDialog] = useState(null) // 'book' | 'import' | 'copy' | 'template'
  const [recent, setRecent] = useState(null)
  // Approval is a choice on each journey (client 2026-11-24): on unless the BG's setting or the planner says otherwise.
  const [needsApproval, setNeedsApproval] = useState(true)
  const [approvalLocked, setApprovalLocked] = useState(false) // sent for approval already: it cannot skip it
  const approvalTouched = useRef(false)

  useEffect(() => {
    journeyOptions().then(o => {
      setOpts(o)
      if (!approvalTouched.current) setNeedsApproval(o.settings?.allowNoApproval === false ? true : o.settings?.approvalByDefault !== false)
    }).catch(e => setError(errorMessage(e, 'Could not load vehicles and drivers')))
  }, [])

  // Edit: fill the form from the journey.
  useEffect(() => {
    if (!editing) return
    getJourney(id).then(j => {
      setTitle(j.title); setVehicleId(j.vehicleId ?? ''); setDriverId(j.driverId ?? ''); setStart(toLocalInput(j.plannedStart))
      setRouteSource(j.routeSource); setPath(j.plannedPath ?? null); setRecordedFrom(j.recordedFrom ?? null); setTemplateId(j.routeTemplateId ?? null)
      roadLoadedKey.current = j.routeSource === 'ROAD' && j.plannedPath?.length >= 2 ? routeKey(j.stops) : null
      setStops(j.stops.map(s => newStop({ ...s, legSource: s.legSource ?? 'SPEED', polygon: undefined })))
      setInstructions(j.instructions ?? ''); setCustomer(j.customer ?? ''); setPriority(j.priority); setType(j.type)
      applyOptions(j)
      approvalTouched.current = true
      setNeedsApproval(j.approvalStatus !== 'NOT_REQUIRED'); setApprovalLocked(['PENDING', 'APPROVED', 'REJECTED'].includes(j.approvalStatus))
      setLoaded(true)
    }).catch(e => setError(errorMessage(e, 'Could not load the journey')))
  }, [editing, id])

  const settings = opts?.settings

  // "Journey from it" (Checkpoints & Routes › Templates): /journeys/new?template=<id>.
  const [params] = useSearchParams()
  const fromTemplate = params.get('template')
  useEffect(() => {
    if (editing || !opts || !fromTemplate) return
    const t = opts.journeyTemplates?.find(x => x.id === fromTemplate)
    if (t) applyPlan(t.body, { vehicle: t.vehicleId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, fromTemplate, editing])
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

  // Road route: ask the server for the best road through the stops whenever a stop moves (debounced).
  const stopsKey = routeKey(placed)
  useEffect(() => {
    if (routeSource !== 'ROAD' || !loaded) { roadSeq.current++; setRoad(r => (r.status === 'idle' ? r : { status: 'idle', route: null, note: null })); return undefined }
    const pts = routePoints(placed)
    if (!pts) { roadSeq.current++; setRoad({ status: 'idle', route: null, note: null }); return undefined }
    if (roadLoadedKey.current === stopsKey) { setRoad(r => ({ ...r, status: 'ok' })); return undefined }
    roadLoadedKey.current = null
    const mine = ++roadSeq.current
    setRoad(r => ({ ...r, status: 'loading' }))
    const t = setTimeout(() => {
      roadRoute({ points: pts, bgId: opts?.bgId ?? null }).then(route => {
        if (mine !== roadSeq.current) return
        const ok = !route.estimated
        setPath(ok ? route.geometry : null)
        setStops(list => applyRoadLegs(list, route))
        setRoad({ status: ok ? 'ok' : 'estimate', route, note: route.note })
        if (ok && !roadFitted.current) { roadFitted.current = true; setRoadFit(n => n + 1) }
        if (!ok) roadFitted.current = false
      }).catch(() => {
        if (mine !== roadSeq.current) return
        setPath(null)
        setStops(list => clearRoadLegs(list))
        setRoad({ status: 'estimate', route: null, note: 'The road service did not answer' })
      })
    }, 700)
    return () => clearTimeout(t)
    // placed is represented by stopsKey (only a moved stop needs a new route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSource, stopsKey, loaded, opts?.bgId])

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
    return appendStops(list, [{ lat, lng }], newStop)
  })
  const onMapClick = ([lat, lng]) => {
    if (routeSource === 'DRAWN' && clickMode === 'draw') setPath(p => [...(p ?? []), [lat, lng]])
    else addStopAt(lat, lng)
  }

  /** The journey-level options of a journey or a template body. */
  function applyOptions(b) {
    setStartLogic(b.startLogic ?? 'ANY_DATA')
    setStartBufferMin(b.startBufferMin ?? '')
    setRouteToleranceM(b.routeToleranceM ?? '')
    setForceCloseH(b.forceCloseMin != null ? Math.round((b.forceCloseMin / 60) * 10) / 10 : '')
    setConvoy(Array.isArray(b.convoy) ? b.convoy.map(c => (typeof c === 'string' ? c : c.vehicleId)) : [])
    setConvoyToleranceM(b.convoyToleranceM ?? 200)
    setLoadState(b.loadState ?? '')
    setTempMin(b.tempMin ?? '')
    setTempMax(b.tempMax ?? '')
    if (b.startLogic || b.startBufferMin != null || b.routeToleranceM || b.forceCloseMin != null || b.convoy?.length || b.loadState || b.tempMin != null || b.tempMax != null) setMore(true)
  }

  /** A template, a past journey: everything but the times (and the vehicle unless it has one). */
  function applyPlan(b, { vehicle } = {}) {
    setTitle(b.title ?? '')
    setCustomer(b.customer ?? ''); setPriority(b.priority ?? 'Normal'); setType(b.type ?? ''); setInstructions(b.instructions ?? '')
    setRouteSource(b.routeSource ?? 'STRAIGHT'); setPath(b.plannedPath ?? null); setRecordedFrom(b.recordedFrom ?? null); setTemplateId(b.routeTemplateId ?? null)
    setTrip(null)
    setStops((b.stops ?? []).map(x => newStop(planOf(x))))
    if (b.needsApproval === false && settings?.allowNoApproval !== false) { approvalTouched.current = true; setNeedsApproval(false) }
    applyOptions(b)
    if (vehicle) setVehicleId(vehicle)
  }

  /** Address-book entries / uploaded rows as stops, before the destination (or filling empty start / end). */
  function insertStops(list) {
    setStops(cur => {
      const out = cur.map(x => ({ ...x }))
      const queue = list.map(a => newStop({
        name: a.name, arrivalType: a.arrivalType ?? 'RADIUS', geofenceId: a.geofenceId ?? null, lat: a.lat, lng: a.lng,
        radiusM: a.radiusM ?? null, stayMin: a.stayMin ?? (['DELIVERY', 'LOADING', 'UNLOADING'].includes(a.purpose) ? 15 : 0),
        purpose: a.purpose ?? null, addressId: a.addressId ?? (a.id && !a.row ? a.id : null), visitVia: a.visitVia ?? 'MAP',
        signatureRequired: Boolean(a.signatureRequired),
      }))
      // Empty slots first (a new journey's blank start and destination).
      for (let i = 0; i < out.length && queue.length; i++) {
        if (!Number.isFinite(out[i].lat) && out[i].arrivalType === 'RADIUS') out[i] = { ...queue.shift(), key: out[i].key }
      }
      return queue.length ? appendStops(out, queue, newStop) : out
    })
  }

  async function onImport(rows) {
    setDialog(null)
    insertStops(rows)
    const save = rows.filter(r => r.saveAddress)
    if (save.length) {
      try {
        const res = await bulkAddresses(save.map(r => ({ row: r.row, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radiusM, purpose: r.purpose })))
        setOpts(o => ({ ...o, addresses: [...(o.addresses ?? []), ...res.data].sort((a, b) => a.name.localeCompare(b.name)) }))
        if (res.errors?.length) setError(`Saved ${res.data.length} address${res.data.length === 1 ? '' : 'es'}; not saved: ${res.errors.map(e => `row ${e.row} (${e.message})`).join(', ')}`)
      } catch (e) {
        setError(errorMessage(e, 'The stops were added, but saving them as addresses failed'))
      }
    }
  }

  async function openCopy() {
    setDialog('copy')
    if (!recent) recentJourneys().then(setRecent).catch(e => setError(errorMessage(e, 'Could not load the journeys')))
  }
  async function copyJourney(jid) {
    setDialog(null)
    try {
      const j = await getJourney(jid)
      applyPlan({ ...j, convoy: j.convoy ?? [] }, { vehicle: vehicleId ? null : j.vehicleId })
      if (!driverId && j.driverId) setDriverId(j.driverId)
    } catch (e) {
      setError(errorMessage(e, 'Could not copy that journey'))
    }
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

  /** Leaving "Road route": the minutes the road service set go back to the planned speed. */
  function leaveRoad() {
    roadSeq.current++
    setRoad({ status: 'idle', route: null, note: null })
    setStops(list => clearRoadLegs(list))
  }

  function setLeg(i, minutes) {
    const v = minutes === '' ? null : Math.max(0, Math.round(Number(minutes)))
    const routed = road.route && !road.route.estimated ? road.route.legs[i - 1] : null
    // Reset on a road route goes back to the road minutes, not to the speed estimate.
    if (v == null && routeSource === 'ROAD' && routed) setStop(i, { legDriveMin: routed.durationMin, legSource: 'ROUTING' })
    else setStop(i, v == null ? { legDriveMin: null, legSource: 'SPEED' } : { legDriveMin: v, legSource: 'MANUAL' })
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
        visitVia: s.visitVia ?? 'MAP', purpose: s.purpose || null, loadState: s.loadState || null, addressId: s.addressId || null, formId: s.formId || null,
      })),
      instructions: instructions.trim() || null, customer: customer.trim() || null, priority, type: type || undefined, needsApproval: canSkip ? needsApproval : true, submit: send && (!canSkip || needsApproval),
      ...optionFields(),
    }
    try {
      if (saveRoute && routeName.trim()) {
        await saveRouteTemplate({ name: routeName.trim(), source: body.routeSource, path: body.plannedPath, stops: body.stops, recordedFrom, driveMin: schedule?.driveMin ?? null })
      }
      const { vehicleId: _v, driverId: _d, plannedStart: _p, submit: _s, ...plan } = body
      if (!editing && when !== 'FIXED') {
        // A schedule: the engine makes its journeys (they wait for approval unless an approver approves the schedule).
        const errs = scheduleErrors(scheduleBody())
        if (Object.keys(errs).length) { setFieldErrors(errs); throw new Error(Object.values(errs)[0]) }
        await saveJourneyTemplate({ name: sched.name.trim() || title.trim(), vehicleId, driverId: driverId || null, body: plan, ...scheduleBody() })
        navigate('/journeys/checkpoints?tab=templates', { state: { saved: sched.name.trim() || title.trim() } })
        return
      }
      if (saveTemplate && templateName.trim()) {
        await saveJourneyTemplate({ name: templateName.trim(), vehicleId: null, driverId: null, body: plan, scheduleKind: 'NONE' })
      }
      const res = editing ? await updateJourney(id, body) : await createJourney(body)
      navigate(`/journeys/${res.data.id}`, { state: { warnings: res.warnings } })
    } catch (e) {
      const first = e.details ? Object.values(e.details)[0] : null
      setError(`${errorMessage(e, 'Could not save the journey')}${first && typeof first === 'string' ? `: ${first}` : ''}`)
      if (e.details) setFieldErrors(e.details)
    } finally {
      setBusy(false)
    }
  }

  function optionFields() {
    const int = v => (v === '' || v == null ? null : Math.round(Number(v)))
    const flt = v => (v === '' || v == null ? null : Number(v))
    return {
      startLogic, startBufferMin: int(startBufferMin), routeToleranceM: int(routeToleranceM),
      forceCloseMin: forceCloseH === '' ? null : Math.round(Number(forceCloseH) * 60),
      convoy: convoy.filter(c => c && c !== vehicleId), convoyToleranceM: Number(convoyToleranceM) || 200,
      loadState: loadState || null,
      tempMin: vehicleHasTemp ? flt(tempMin) : null, tempMax: vehicleHasTemp ? flt(tempMax) : null,
    }
  }
  function scheduleBody() {
    const startUae = toLocalInput(fromLocalInput(start))
    return {
      scheduleKind: when, repeat: sched.repeat, weekdays: sched.weekdays, monthDays: sched.monthDays,
      startTime: startUae.slice(11, 16),
      validFrom: sched.validFrom ? new Date(Date.parse(`${sched.validFrom}T00:00:00Z`) - 4 * 3600_000).toISOString() : null,
      validTo: sched.validTo ? new Date(Date.parse(`${sched.validTo}T00:00:00Z`) - 4 * 3600_000).toISOString() : null,
      horizonDays: Number(sched.horizonDays) || 7,
    }
  }

  const vehicle = opts?.vehicles.find(v => v.id === vehicleId)
  const vehicleHasTemp = Boolean(vehicle?.hasTemperature)

  // Live positions (Flespi and Uffizio vehicles, as on the Live Map), by IMEI.
  // Client 2026-11-26: the vehicle list shows only active vehicles (reporting:
  // Driving, Idle or Off; not Inactive or No Data), and picking one shows where
  // it is now on the map.
  const live = useFlespiData({ withUffizio: true })
  const liveByImei = useMemo(() => {
    const m = new Map()
    for (const v of live.data?.vehicles ?? []) {
      const k = String(v.ident ?? '').replace(/\D/g, '')
      if (k) m.set(k, v)
    }
    return m
  }, [live.data])
  const pickable = useMemo(() => {
    if (!opts) return []
    // Until the live status is known (or when it cannot be read) every vehicle is offered.
    if (!liveByImei.size) return opts.vehicles
    return opts.vehicles.filter(v => ACTIVE_LIVE.includes(liveByImei.get(String(v.imei ?? '').replace(/\D/g, ''))?.status) || v.id === vehicleId)
  }, [opts, liveByImei, vehicleId])
  const hereNow = vehicle ? liveByImei.get(String(vehicle.imei ?? '').replace(/\D/g, '')) : null
  const vehiclePin = hereNow && Number.isFinite(hereNow.lat) && Number.isFinite(hereNow.lng) ? { lat: hereNow.lat, lng: hereNow.lng, label: vehicle.label } : null
  const nextDays = useMemo(() => (when === 'RELATIVE' ? upcoming({ ...scheduleBody(), validFrom: scheduleBody().validFrom }, Date.now(), Math.max(14, Number(sched.horizonDays) || 7)).slice(0, 5) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [when, sched, start])

  const canSkip = settings?.allowNoApproval !== false && !approvalLocked && when !== 'AUTOMATIC'
  const noApproval = canSkip && !needsApproval
  const canSave = title.trim() && vehicleId && ready && schedule && !busy && road.status !== 'loading'
  const n = stops.length

  return (
    <JourneyShell
      {...props}
      crumb={editing ? 'Edit journey' : 'New journey'}
      title={editing ? 'Edit journey' : 'New journey'}
      subtitle="Fill in the basics and the stops. The times add up from the start; it is approved before the vehicle leaves, unless you switch approval off."
    >
      <ErrorNote error={error} />
      {!opts || !loaded ? <div className="j-skel" style={{ height: 420 }} /> : (
        <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', alignItems: 'start' }}>
          <div className="j-card j-form-card">
            {!editing && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <span className="j-label" style={{ alignSelf: 'center' }}>Start from</span>
                {(opts.journeyTemplates ?? []).length > 0 && <button type="button" className="j-btn j-btn--sm" onClick={() => setDialog('template')}><LayoutTemplate size={13} /> A template</button>}
                <button type="button" className="j-btn j-btn--sm" onClick={openCopy}><Copy size={13} /> A previous journey</button>
              </div>
            )}
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
                  {pickable.map(v => <option key={v.id} value={v.id}>{v.label}{v.vehicleType ? ` · ${v.vehicleType}` : ''}</option>)}
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
              <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                {[
                  ['ROAD', <><Navigation size={14} /> Road route</>, () => { if (routeSource !== 'ROAD') { setRouteSource('ROAD'); setPath(null); setTrip(null); setRecordedFrom(null); setTemplateId(null); roadLoadedKey.current = null } setClickMode('stop') }],
                  ['PAST_TRIP', <><History size={14} /> Copy a past trip</>, () => setTripOpen(o => !o)],
                  ['DRAWN', <><PenLine size={14} /> Draw on the map</>, () => { leaveRoad(); setRouteSource('DRAWN'); setTrip(null); setRecordedFrom(null); if (routeSource !== 'DRAWN') setPath(null); setClickMode('draw') }],
                  ['STRAIGHT', <><Route size={14} /> Straight legs</>, () => { leaveRoad(); setRouteSource('STRAIGHT'); setPath(null); setTrip(null); setRecordedFrom(null); setClickMode('stop') }],
                ].map(([k, label, onClick]) => (
                  <button key={k} type="button" className="j-tab" style={{ border: '1px solid var(--j-line2)', justifyContent: 'center' }} aria-pressed={routeSource === k} onClick={onClick}>{label}</button>
                ))}
              </div>

              {routeSource === 'ROAD' && (
                <div className="j-inset" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} role="status" data-testid="road-status">
                  <Navigation size={16} />
                  {road.status === 'loading' && <span style={{ flex: 1, fontSize: 12.5 }}>Finding the best road route…</span>}
                  {road.status === 'idle' && <span style={{ flex: 1, fontSize: 12.5 }}>Click the map to place the start and the destination; the road route is drawn for you.</span>}
                  {road.status === 'ok' && road.route && (
                    <span style={{ flex: 1, fontSize: 12.5 }}>
                      By road: <b className="j-strong">{Math.round(road.route.distanceKm)} km · {duration(road.route.durationMin)}</b> driving
                      <span className="j-muted"> · {PROVIDER_LABEL[road.route.provider] ?? road.route.provider}. Change a leg's minutes below if you know better.</span>
                    </span>
                  )}
                  {road.status === 'ok' && !road.route && <span style={{ flex: 1, fontSize: 12.5 }}>The saved road route. Move a stop and it is drawn again.</span>}
                  {road.status === 'estimate' && (
                    <span style={{ flex: 1, fontSize: 12.5 }} className="j-warn-text"><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {estimateBanner(road.note)}. Straight legs at {settings?.plannedSpeedKmh ?? 70} km/h are used.</span>
                  )}
                </div>
              )}

              {tripOpen && (
                <div className="j-inset" style={{ marginTop: 10 }}>
                  <div className="j-label" style={{ marginBottom: 8 }}>Pick a vehicle and when it drove this route; its track becomes the planned route.</div>
                  <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    <select className="j-select" value={tripForm.vehicleId || vehicleId} onChange={e => setTripForm(f => ({ ...f, vehicleId: e.target.value }))} aria-label="Trip vehicle">
                      <option value="">Vehicle…</option>
                      {pickable.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
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

            {!editing && (
              <div style={{ marginTop: 18 }}>
                <div className="j-field"><span>When</span></div>
                <div className="j-seg" style={{ marginTop: 6, width: '100%', display: 'flex' }}>
                  <button type="button" style={{ flex: 1 }} aria-pressed={when === 'FIXED'} onClick={() => setWhen('FIXED')}>Once</button>
                  <button type="button" style={{ flex: 1 }} aria-pressed={when === 'RELATIVE'} onClick={() => setWhen('RELATIVE')}><Repeat size={13} /> Repeats</button>
                  <button type="button" style={{ flex: 1 }} aria-pressed={when === 'AUTOMATIC'} onClick={() => setWhen('AUTOMATIC')}>Automatic</button>
                </div>
              </div>
            )}

            <label className="j-field" style={{ marginTop: 14 }}>
              <span>{when === 'RELATIVE' ? 'First journey leaves at (the time repeats)' : when === 'AUTOMATIC' ? 'Times are worked out from when it leaves; this sets the plan' : 'Leaves at'}</span>
              <input className="j-input" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
              {fieldErrors.plannedStart && <span className="j-err">{fieldErrors.plannedStart}</span>}
            </label>

            {when !== 'FIXED' && (
              <div className="j-inset" style={{ marginTop: 12 }}>
                {when === 'RELATIVE' && (
                  <>
                    <div className="j-seg" style={{ display: 'flex', width: '100%' }}>
                      {[['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly']].map(([k, l]) => (
                        <button key={k} type="button" style={{ flex: 1 }} aria-pressed={sched.repeat === k} onClick={() => setSched(x => ({ ...x, repeat: k }))}>{l}</button>
                      ))}
                    </div>
                    {sched.repeat === 'WEEKLY' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {WEEKDAY_SHORT.map((d, k) => (
                          <button key={d} type="button" className="j-tab" style={{ border: '1px solid var(--j-line2)' }} aria-pressed={sched.weekdays.includes(k)}
                            onClick={() => setSched(x => ({ ...x, weekdays: x.weekdays.includes(k) ? x.weekdays.filter(y => y !== k) : [...x.weekdays, k] }))}>{d}</button>
                        ))}
                      </div>
                    )}
                    {sched.repeat === 'MONTHLY' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginTop: 10 }}>
                        {Array.from({ length: 31 }, (_, k) => k + 1).map(d => (
                          <button key={d} type="button" className="j-tab" style={{ justifyContent: 'center', padding: 0, height: 30, border: '1px solid var(--j-line)' }} aria-pressed={sched.monthDays.includes(d)}
                            onClick={() => setSched(x => ({ ...x, monthDays: x.monthDays.includes(d) ? x.monthDays.filter(y => y !== d) : [...x.monthDays, d] }))}>{d}</button>
                        ))}
                      </div>
                    )}
                    {(fieldErrors.weekdays || fieldErrors.monthDays) && <div className="j-err" style={{ marginTop: 6 }}>{fieldErrors.weekdays || fieldErrors.monthDays}</div>}
                  </>
                )}
                {when === 'AUTOMATIC' && <div className="j-label" style={{ fontSize: 12.5, lineHeight: 1.5 }}>A journey is made each time the vehicle leaves the first stop, on the valid days. It needs an approver to approve the schedule first, because it is already on the road when it is made.</div>}
                <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 10, marginTop: 10 }}>
                  <label className="j-field"><span>Valid from</span><input className="j-input" type="date" value={sched.validFrom} onChange={e => setSched(x => ({ ...x, validFrom: e.target.value }))} /></label>
                  <label className="j-field"><span>Valid to <span className="j-muted" style={{ fontWeight: 400 }}>optional</span></span><input className="j-input" type="date" value={sched.validTo} onChange={e => setSched(x => ({ ...x, validTo: e.target.value }))} /></label>
                  {when === 'RELATIVE' && <label className="j-field"><span>Make days ahead</span><input className="j-input" type="number" min="0" max="62" value={sched.horizonDays} onChange={e => setSched(x => ({ ...x, horizonDays: e.target.value }))} /></label>}
                </div>
                <label className="j-field" style={{ marginTop: 10 }}><span>Schedule name</span><input className="j-input" value={sched.name} onChange={e => setSched(x => ({ ...x, name: e.target.value }))} placeholder={title || 'Daily Ruwais run'} /></label>
                <div className="j-label" style={{ marginTop: 10, fontSize: 12.5 }}>
                  {describeSchedule({ scheduleKind: when, ...scheduleBody() })}
                  {nextDays.length > 0 && <> · next: {nextDays.map(o => dayTime(o.start)).join(', ')}</>}
                </div>
                <div className="j-label" style={{ marginTop: 6, fontSize: 12 }}>Each journey still goes for approval, unless an approver approves the schedule (Checkpoints &amp; Routes › Templates &amp; schedules).</div>
                {(fieldErrors.validFrom || fieldErrors.validTo || fieldErrors.vehicleId) && <div className="j-err">{fieldErrors.validFrom || fieldErrors.validTo || fieldErrors.vehicleId}</div>}
              </div>
            )}

            {/* The chained schedule: stops with their planned arrive / leave */}
            <div className="j-inset" style={{ marginTop: 16, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <div className="j-caps" style={{ flex: 1 }}>Stops and times</div>
                <button type="button" className="j-btn j-btn--sm" onClick={() => setDialog('book')}><BookMarked size={13} /> Address book</button>
                <button type="button" className="j-btn j-btn--sm" onClick={() => setDialog('import')}><Upload size={13} /> Excel / CSV</button>
              </div>
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
                            <span>· {sc.legKm ? `${Math.round(sc.legKm)} km` : ''} · {s.legSource === 'MANUAL' ? 'set by you' : s.legSource === 'TRIP' ? 'from the past trip' : s.legSource === 'ROUTING' ? 'by road' : `at ${settings?.plannedSpeedKmh ?? 70} km/h`}</span>
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
                        {!isFirst && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                            <div className="j-seg" title="How the stop counts as reached">
                              <button type="button" aria-pressed={s.visitVia !== 'QR'} onClick={() => setStop(i, { visitVia: 'MAP' })}>Map</button>
                              <button type="button" aria-pressed={s.visitVia === 'QR'} onClick={() => setStop(i, { visitVia: 'QR' })}>QR scan</button>
                            </div>
                            <select className="j-select" style={{ width: 'auto', minHeight: 34, flex: '1 1 110px' }} value={s.purpose ?? ''} onChange={e => setStop(i, { purpose: e.target.value || null })} aria-label="State at this stop">
                              <option value="">State…</option>
                              {PURPOSES.map(x => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}
                            </select>
                            <select className="j-select" style={{ width: 'auto', minHeight: 34, flex: '1 1 110px' }} value={s.loadState ?? ''} onChange={e => setStop(i, { loadState: e.target.value || null })} aria-label="Load state after this stop">
                              <option value="">Load…</option>
                              {(settings?.loadStates ?? []).map(x => <option key={x} value={x}>{x}</option>)}
                            </select>
                            {(opts.forms ?? []).length > 0 && (
                              <select className="j-select" style={{ width: 'auto', minHeight: 34, flex: '1 1 130px' }} value={s.formId ?? ''} onChange={e => setStop(i, { formId: e.target.value || null })} aria-label="Form filled at this stop">
                                <option value="">No form</option>
                                {opts.forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                        {s.visitVia === 'QR' && !isFirst && <div className="j-label" style={{ marginTop: 6 }}>The driver scans this stop's QR (from the journey's QR sheet) on the driver link.</div>}
                        {sc && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                            {isFirst ? <span className="j-label">leave <b className="j-strong">{hhmm(sc.plannedDepart)}</b></span> : (
                              <>
                                <span className="j-label">arrive</span>
                                <input className="j-input j-input--sm" style={{ width: 215, maxWidth: '100%' }} type="datetime-local" value={toLocalInput(sc.plannedArrive)} onChange={e => setArrival(i, e.target.value)} aria-label="Planned arrival" />
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
              <button type="button" className="j-btn j-btn--sm" onClick={() => setStops(list => appendStops(list, [{ lat: null, lng: null }], newStop))}>
                <Plus size={13} /> Add a stop <span className="j-muted" style={{ fontWeight: 400 }}>or click the map</span>
              </button>
              {fieldErrors.stops && <div className="j-err" style={{ marginTop: 6 }}>{fieldErrors.stops}</div>}
            </div>

            <label className="j-field" style={{ marginTop: 16 }}>
              <span>Notes for the driver <span className="j-muted" style={{ fontWeight: 400 }}>optional</span></span>
              <textarea className="j-textarea" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Gate pass at Ruwais Gate 2. Call the office from Tarif." />
            </label>

            {when !== 'AUTOMATIC' && (
              <div className="j-inset" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }} data-testid="approval-choice">
                <div style={{ minWidth: 0 }}>
                  <div className="j-strong" style={{ fontSize: 13.5 }}>Needs approval</div>
                  <div className="j-label" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                    {approvalLocked ? 'This journey was already sent for approval, so it keeps going through it. A change to the route or the times sends it back.'
                      : settings?.allowNoApproval === false ? 'Every journey must be approved before the vehicle leaves (Journey settings).'
                        : needsApproval ? 'An approver checks it before the vehicle leaves. Save it as a draft or send it.'
                          : when === 'RELATIVE' ? 'The journeys this schedule makes are scheduled at once, with no approval.' : 'No approval: saving makes it Scheduled at once. The driver, the vehicle and the other checks still apply.'}
                  </div>
                </div>
                <Toggle label="Needs approval" checked={canSkip ? needsApproval : true} disabled={!canSkip} onChange={x => { approvalTouched.current = true; setNeedsApproval(x) }} />
              </div>
            )}

            <div className="j-inset" style={{ marginTop: 14 }}>
              <button type="button" className="j-btn j-btn--ghost" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start', display: 'block', lineHeight: 1.5 }} onClick={() => setMore(m => !m)}>
                {more ? <ChevronUp size={15} /> : <ChevronDown size={15} />} More options <span className="j-muted" style={{ fontWeight: 400 }}>customer, priority, start logic, tolerance, convoy, load, temperature, force close</span>
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
                  <label className="j-field"><span>Journey starts when</span>
                    <select className="j-select" value={startLogic} onChange={e => setStartLogic(e.target.value)}>
                      <option value="ANY_DATA">It leaves the first stop</option><option value="IGNITION_ON">The ignition comes on there</option>
                    </select>
                  </label>
                  <label className="j-field"><span>Start buffer (min)</span>
                    <input className="j-input" type="number" min="0" max="720" value={startBufferMin} onChange={e => setStartBufferMin(e.target.value)} placeholder={String(settings?.startBufferMin ?? 60)} />
                  </label>
                  <label className="j-field"><span>Route tolerance (m)</span>
                    <input className="j-input" type="number" min="20" step="10" value={routeToleranceM} onChange={e => setRouteToleranceM(e.target.value)} placeholder={String(Math.round((settings?.offRouteKm ?? 1) * 1000))} />
                  </label>
                  <label className="j-field"><span>Force close after (h)</span>
                    <input className="j-input" type="number" min="0" step="0.5" value={forceCloseH} onChange={e => setForceCloseH(e.target.value)} placeholder={String(settings?.forceCloseHours ?? 12)} />
                  </label>
                  <label className="j-field"><span>Load state</span>
                    <select className="j-select" value={loadState} onChange={e => setLoadState(e.target.value)}>
                      <option value="">—</option>{(settings?.loadStates ?? []).map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <div className="j-field" style={{ gridColumn: '1 / -1' }}>
                    <span><Thermometer size={13} /> Temperature limits (°C)</span>
                    {vehicleId && !vehicleHasTemp ? (
                      <span className="j-label">No sensor: this vehicle does not report a temperature.</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input className="j-input" style={{ width: 110 }} type="number" step="0.5" value={tempMin} onChange={e => setTempMin(e.target.value)} placeholder="Lowest" aria-label="Lowest temperature" disabled={!vehicleId} />
                        <span className="j-muted">to</span>
                        <input className="j-input" style={{ width: 110 }} type="number" step="0.5" value={tempMax} onChange={e => setTempMax(e.target.value)} placeholder="Highest" aria-label="Highest temperature" disabled={!vehicleId} />
                        {!vehicleId && <span className="j-label">Pick the vehicle first</span>}
                      </div>
                    )}
                    {fieldErrors.tempMax && <span className="j-err">{fieldErrors.tempMax}</span>}
                  </div>
                  <div className="j-field" style={{ gridColumn: '1 / -1' }}>
                    <span><Truck size={13} /> Convoy <span className="j-muted" style={{ fontWeight: 400 }}>vehicles that travel with this one</span></span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {convoy.map(cid => (
                        <span key={cid} className="j-pill j-pill--plain">{opts.vehicles.find(v => v.id === cid)?.label ?? 'Vehicle'}
                          <button type="button" className="j-btn--ghost" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => setConvoy(c => c.filter(x => x !== cid))} aria-label="Remove from convoy"><X size={12} /></button>
                        </span>
                      ))}
                      {convoy.length < 5 && (
                        <select className="j-select" style={{ width: 'auto', minHeight: 32 }} value="" onChange={e => e.target.value && setConvoy(c => [...new Set([...c, e.target.value])])} aria-label="Add a convoy vehicle">
                          <option value="">Add a vehicle…</option>
                          {pickable.filter(v => v.id !== vehicleId && !convoy.includes(v.id)).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      )}
                      {convoy.length > 0 && (
                        <span className="j-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          within <input className="j-input j-input--sm j-input--num" type="number" min="50" step="50" value={convoyToleranceM} onChange={e => setConvoyToleranceM(e.target.value)} aria-label="Convoy tolerance in metres" /> m of the lead
                        </span>
                      )}
                    </div>
                    {fieldErrors.convoy && <span className="j-err">{fieldErrors.convoy}</span>}
                  </div>
                  <label className="j-field" style={{ gridColumn: '1 / -1' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={saveRoute} onChange={e => setSaveRoute(e.target.checked)} /> Save this route for next time</span>
                    {saveRoute && <input className="j-input" value={routeName} onChange={e => setRouteName(e.target.value)} placeholder="Mussafah Yard → Ruwais Site B" />}
                  </label>
                  {!editing && when === 'FIXED' && (
                    <label className="j-field" style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)} /> Also save as a template (without a vehicle) for any vehicle</span>
                      {saveTemplate && <input className="j-input" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder={title || 'Ruwais delivery'} />}
                    </label>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 20, flexWrap: 'wrap', borderTop: '1px solid var(--j-line)', paddingTop: 18 }}>
              <button type="button" className="j-btn j-btn--ghost" onClick={() => navigate(editing ? `/journeys/${id}` : '/journeys')}>Cancel</button>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(when === 'FIXED' || editing) && noApproval ? (
                  <button type="button" className="j-btn j-btn--primary" disabled={!canSave || (avail && !avail.free)} onClick={() => submit(false)}><Check size={14} /> Save journey</button>
                ) : when === 'FIXED' || editing ? (
                  <>
                    <button type="button" className="j-btn" disabled={!canSave} onClick={() => submit(false)}>Save as draft</button>
                    <button type="button" className="j-btn j-btn--primary" disabled={!canSave || (avail && !avail.free)} onClick={() => submit(true)}><Send size={14} /> Send for approval</button>
                  </>
                ) : (
                  <button type="button" className="j-btn j-btn--primary" disabled={!canSave} onClick={() => submit(false)}><Repeat size={14} /> Save the schedule</button>
                )}
              </div>
            </div>
          </div>

          <div className="j-form-map">
            <div className="j-card j-card--flush" style={{ position: 'relative' }}>
              <JourneyMap
                path={line}
                stops={placed}
                height={typeof window !== 'undefined' && window.innerWidth < 640 ? 320 : 560}
                onMapClick={onMapClick}
                showAreas
                vehicle={vehiclePin}
                fitKey={`${templateId}|${recordedFrom?.from}|${loaded}|${roadFit}|${vehiclePin ? vehicleId : ""}`}
              />
              <span className="j-pill j-pill--plain" style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, background: 'rgba(30,45,54,.88)' }}>
                <MapPin size={12} /> {routeSource === 'DRAWN' && clickMode === 'draw' ? 'Click the map to draw the route' : 'Click the map to add a stop'}
              </span>
            </div>
            <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))', gap: 10, marginTop: 12 }}>
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
      {dialog === 'book' && <AddressPicker addresses={opts?.addresses ?? []} onClose={() => setDialog(null)} onPick={list => { setDialog(null); insertStops(list) }} />}
      {dialog === 'import' && <StopsImport addresses={opts?.addresses ?? []} defaultRadiusM={settings?.defaultRadiusM} onClose={() => setDialog(null)} onImport={onImport} />}
      {dialog === 'copy' && (
        <JModal title="Copy a previous journey" sub="Its stops, route and options; you set the vehicle and the time." onClose={() => setDialog(null)}>
          {!recent && <div className="j-skel" style={{ height: 120 }} />}
          {recent?.length === 0 && <div className="j-empty">No journeys yet.</div>}
          {recent?.map(r => (
            <button key={r.id} type="button" className="j-card j-card--link" style={{ width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', padding: 12, marginBottom: 8 }} onClick={() => copyJourney(r.id)}>
              <div className="j-strong">{r.title}</div>
              <div className="j-label">{r.ref} · {r.vehicleLabel} · {dayTime(r.plannedStart)} · {r.stopCount} stops{r.plannedDistanceKm ? ` · ${Math.round(r.plannedDistanceKm)} km` : ''}</div>
            </button>
          ))}
        </JModal>
      )}
      {dialog === 'template' && (
        <JModal title="Start from a template" sub="Templates are kept in Checkpoints & Routes." onClose={() => setDialog(null)}>
          {(opts?.journeyTemplates ?? []).map(t => (
            <button key={t.id} type="button" className="j-card j-card--link" style={{ width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', padding: 12, marginBottom: 8 }}
              onClick={() => { setDialog(null); applyPlan(t.body, { vehicle: t.vehicleId }) }}>
              <div className="j-strong">{t.name}</div>
              <div className="j-label">{t.body?.stops?.length ?? 0} stops · {t.vehicleId ? (opts.vehicles.find(v => v.id === t.vehicleId)?.label ?? 'a vehicle') : 'any vehicle'}{t.scheduleKind !== 'NONE' ? ' · a schedule' : ''}</div>
            </button>
          ))}
        </JModal>
      )}
    </JourneyShell>
  )
}
