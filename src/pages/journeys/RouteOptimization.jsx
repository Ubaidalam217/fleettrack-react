import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Wand2, BookMarked, Upload, X, Info, Save, CirclePlus, MapPin, Flag, Check, AlertTriangle } from 'lucide-react'
import JourneyShell from './JourneyShell'
import { ErrorNote } from '../../components/journeys/JourneyBits'
import { AddressPicker, StopsImport } from '../../components/journeys/JourneyDialogs'
import {
  routeOptimizationOptions, solveRoutes, saveVehicleCapacity, listAddresses, createJourney, hhmm, duration, toLocalInput, fromLocalInput,
} from '../../data/journeys'
import { errorMessage } from '../../data/http'

/**
 * Route Optimization (client 2026-11-21, after Uffizio's Settings › Job ›
 * Route Optimization): pick vehicles (with their type and Max Load
 * Capacity), a start, the delivery points (map, address book, Excel / CSV)
 * with weights, stay times and time windows; "Optimize" splits them into trips
 * per vehicle on the server (lib/routeOptimizer.js), each ordered to drive the
 * least; "Create journeys" makes one draft journey per trip for HSE to approve.
 * Distances are estimates until a road routing service is set up.
 */

const TRIP_COLORS = ['#8cc8ff', '#7ee2a8', '#f6c870', '#ff8f80', '#c9b8ff', '#9fdccc', '#f0a3d0', '#c7d98a']
const UAE_CENTER = [24.4, 54.6]

function FitTo({ points, k }) {
  const map = useMap()
  useEffect(() => {
    const pts = points.filter(p => Number.isFinite(p[0]))
    if (pts.length === 1) map.setView(pts[0], 11)
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 13 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, k])
  return null
}
function Clicks({ onClick }) { useMapEvents({ click: e => onClick([e.latlng.lat, e.latlng.lng]) }); return null }
const pin = (text, color, big = false) => L.divIcon({
  className: '',
  html: `<span class="j-maptag" style="display:inline-flex;align-items:center;justify-content:center;transform:translate(-50%,-50%);${big ? 'width:30px;height:30px;' : 'width:24px;height:24px;'}padding:0;border-radius:50%;background:${color};color:#13232b;border-color:rgba(0,0,0,.25)">${String(text).replace(/[<>&"]/g, '')}</span>`,
  iconSize: [0, 0],
})

export default function RouteOptimization(props) {
  const [opts, setOpts] = useState(null)
  const [addresses, setAddresses] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('DISTANCE')
  const [loadType, setLoadType] = useState('PARTIAL')
  const [product, setProduct] = useState('')
  const [unit, setUnit] = useState('kg')
  const [radiusKm, setRadiusKm] = useState('')
  const [startAt, setStartAt] = useState(() => { const d = new Date(Date.now() + 2 * 3600_000); d.setUTCMinutes(0, 0, 0); return toLocalInput(d.toISOString()) })
  const [maxTrips, setMaxTrips] = useState(3)
  const [returnToStart, setReturnToStart] = useState(true)
  const [start, setStart] = useState(null)
  const [points, setPoints] = useState([])
  const [picked, setPicked] = useState({}) // vehicleId -> capacity text
  const [typedOnly, setTypedOnly] = useState(true)
  const [click, setClick] = useState('point')
  const [dialog, setDialog] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState(null)
  const [sendHse, setSendHse] = useState(false)

  useEffect(() => {
    routeOptimizationOptions().then(setOpts).catch(e => setError(errorMessage(e, 'Could not load the vehicles')))
    listAddresses().then(setAddresses).catch(() => {})
  }, [])

  const vehicles = useMemo(() => (opts?.vehicles ?? []).filter(v => !typedOnly || v.vehicleType), [opts, typedOnly])
  const byWeight = mode === 'DISTANCE_WEIGHT'
  const chosen = Object.keys(picked)
  const ready = start && points.length && chosen.length && (!byWeight || chosen.some(id => Number(picked[id]) > 0))

  const onMap = ([lat, lng]) => {
    setResult(null)
    if (click === 'start' || !start) { setStart({ name: start?.name || 'Start', lat, lng }); setClick('point'); return }
    setPoints(p => [...p, { key: `${Date.now()}${p.length}`, name: `Point ${p.length + 1}`, lat, lng, weight: '', stayMin: 10, windowFrom: '', windowTo: '' }])
  }
  const addPoints = list => { setResult(null); setPoints(p => [...p, ...list.map((a, i) => ({ key: `${Date.now()}-${i}`, name: a.name, lat: a.lat, lng: a.lng, weight: a.weight ?? '', stayMin: a.stayMin ?? 10, windowFrom: a.windowFrom ?? '', windowTo: a.windowTo ?? '', addressId: a.addressId ?? (a.row ? null : a.id) ?? null, signatureRequired: Boolean(a.signatureRequired), radiusM: a.radiusM ?? null }))]) }
  const setPoint = (k, patch) => { setResult(null); setPoints(p => p.map(x => (x.key === k ? { ...x, ...patch } : x))) }

  async function optimize() {
    setBusy(true); setError(null); setMade(null)
    try {
      const r = await solveRoutes({
        mode, loadType, product: product || null, unit: unit || null, radiusKm: radiusKm === '' ? null : Number(radiusKm),
        startAt: fromLocalInput(startAt), maxTrips: Number(maxTrips) || 3, returnToStart, start,
        vehicles: chosen.map(id => ({ vehicleId: id, capacity: picked[id] === '' ? null : Number(picked[id]) })),
        points: points.map(p => ({
          name: p.name, lat: p.lat, lng: p.lng, weight: p.weight === '' ? null : Number(p.weight), stayMin: Number(p.stayMin) || 0,
          windowFrom: p.windowFrom || null, windowTo: p.windowTo || null, addressId: p.addressId ?? null, signatureRequired: p.signatureRequired, radiusM: p.radiusM ?? null,
        })),
      })
      setResult(r)
    } catch (e) {
      setError(errorMessage(e, 'Could not optimize'))
    } finally {
      setBusy(false)
    }
  }

  async function createAll() {
    setBusy(true); setError(null)
    const out = []
    for (const t of result.trips) {
      const v = opts.vehicles.find(x => x.id === t.vehicleId)
      const stops = [
        { name: result.start.name, lat: result.start.lat, lng: result.start.lng },
        ...t.stops.map(s => ({
          name: s.name, lat: s.lat, lng: s.lng, radiusM: s.radiusM ?? undefined, stayMin: s.stayMin ?? 0, legDriveMin: s.legMin, legSource: 'ROUTING',
          purpose: 'DELIVERY', signatureRequired: Boolean(s.signatureRequired), addressId: s.addressId ?? null,
        })),
        ...(t.back ? [{ name: `Back to ${result.start.name}`, lat: result.start.lat, lng: result.start.lng, legDriveMin: t.back.legMin, legSource: 'ROUTING' }] : []),
      ]
      try {
        const r = await createJourney({
          title: `${product || 'Delivery'} · ${t.vehicleLabel} · trip ${t.tripNo}`,
          vehicleId: t.vehicleId, driverId: v?.driver?.id ?? null, plannedStart: t.startAt, routeSource: 'STRAIGHT', stops,
          instructions: `Route optimization: ${t.stops.length} stops, ${t.distanceKm} km${t.totalWeight ? `, ${t.totalWeight} ${unit || ''}`.trimEnd() : ''}${product ? ` of ${product}` : ''}.`,
          loadState: byWeight ? 'Loaded' : null, submit: sendHse,
        })
        out.push({ trip: t, id: r.data.id, ref: r.data.ref })
      } catch (e) {
        out.push({ trip: t, error: errorMessage(e, 'Could not create it') })
      }
    }
    setMade(out)
    setBusy(false)
  }

  const fit = useMemo(() => [...(start ? [[start.lat, start.lng]] : []), ...points.map(p => [p.lat, p.lng])], [start, points])
  const tripOf = useMemo(() => {
    const m = new Map()
    result?.trips.forEach((t, k) => t.stops.forEach(s => m.set(`${s.lat},${s.lng},${s.name}`, { k, seq: s.seq })))
    return m
  }, [result])

  return (
    <JourneyShell {...props} crumb="Route Optimization" title="Route optimization" wide
      subtitle="Split delivery points into trips per vehicle, within each vehicle's load, ordered to drive the least. Then make the journeys.">
      <ErrorNote error={error} />
      {opts && (opts.routing.provider === 'ESTIMATE' || result?.estimated) && (
        <div className="j-card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, padding: '12px 16px', borderColor: 'rgba(246,200,112,.45)' }}>
          <Info size={17} style={{ color: 'var(--j-warn)', marginTop: 1 }} />
          <div style={{ fontSize: 13 }}>
            <b>Estimated distances.</b> Connect a road routing service for exact road distances.
            <span className="j-label" style={{ display: 'block' }}>Now: straight-line distance × {opts.routing.roadFactor} at {opts.plannedSpeedKmh} km/h{result?.note ? ` · ${result.note}` : ''}. Set a service in <Link to="/journeys/settings" style={{ textDecoration: 'underline' }}>Journey settings</Link> (OSRM on your server, OpenRouteService or Google — each needs setting up).</span>
          </div>
        </div>
      )}
      <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', alignItems: 'start' }}>
        <div className="j-grid" style={{ gap: 14 }}>
          <div className="j-card j-form-card">
            <div className="j-seg" style={{ display: 'flex' }}>
              <button type="button" style={{ flex: 1 }} aria-pressed={!byWeight} onClick={() => { setMode('DISTANCE'); setResult(null) }}>Distance</button>
              <button type="button" style={{ flex: 1 }} aria-pressed={byWeight} onClick={() => { setMode('DISTANCE_WEIGHT'); setResult(null) }}>Distance with weight</button>
            </div>
            {byWeight && (
              <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 10, marginTop: 12 }}>
                <label className="j-field"><span>Load type</span>
                  <select className="j-select" value={loadType} onChange={e => setLoadType(e.target.value)}><option value="PARTIAL">Partial</option><option value="FULL">Full</option></select>
                </label>
                <label className="j-field"><span>Product</span><input className="j-input" value={product} onChange={e => setProduct(e.target.value)} placeholder="Diesel" /></label>
                <label className="j-field"><span>Unit</span><input className="j-input" value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, L, pallets" /></label>
              </div>
            )}
            <div className="j-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10, marginTop: 12 }}>
              <label className="j-field"><span>Leaves at</span><input className="j-input" type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} /></label>
              <label className="j-field"><span>Radius (km)</span><input className="j-input" type="number" min="0" value={radiusKm} onChange={e => setRadiusKm(e.target.value)} placeholder="Any" /></label>
              <label className="j-field"><span>Trips per vehicle</span><input className="j-input" type="number" min="1" max="10" value={maxTrips} onChange={e => setMaxTrips(e.target.value)} /></label>
            </div>
            <label className="j-label" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={returnToStart} onChange={e => setReturnToStart(e.target.checked)} /> Back to the start after each trip</label>
          </div>

          <div className="j-card j-form-card">
            <div className="j-card-head"><Flag size={16} /><h2 className="j-card-title">Start</h2></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="j-select" style={{ flex: '1 1 200px', width: 'auto' }} value="" onChange={e => { const a = addresses.find(x => x.id === e.target.value); if (a) { setStart({ name: a.name, lat: a.lat, lng: a.lng }); setResult(null) } }} aria-label="Start from the address book">
                <option value="">{start ? `${start.name} (${start.lat.toFixed(4)}, ${start.lng.toFixed(4)})` : 'From the address book…'}</option>
                {addresses.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button type="button" className="j-btn j-btn--sm" aria-pressed={click === 'start'} onClick={() => setClick(c => (c === 'start' ? 'point' : 'start'))}><MapPin size={13} /> {click === 'start' ? 'Click the map…' : 'Pick on the map'}</button>
            </div>
            {start && <input className="j-input" style={{ marginTop: 8 }} value={start.name} onChange={e => setStart(s => ({ ...s, name: e.target.value }))} aria-label="Start name" />}
          </div>

          <div className="j-card j-form-card">
            <div className="j-card-head" style={{ flexWrap: 'wrap' }}>
              <h2 className="j-card-title" style={{ flex: 1 }}>Vehicles <span className="j-label">· {chosen.length} picked</span></h2>
              <label className="j-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={typedOnly} onChange={e => setTypedOnly(e.target.checked)} /> With a vehicle type</label>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {!opts && <div className="j-skel" style={{ height: 80 }} />}
              {opts && vehicles.length === 0 && <div className="j-label">No vehicle has a Vehicle Type set{typedOnly ? ' — untick "With a vehicle type" to see all' : ''}.</div>}
              {vehicles.map(v => {
                const on = v.id in picked
                return (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.06)', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 160px', minWidth: 0, cursor: 'pointer' }}>
                      <input type="checkbox" checked={on} onChange={() => { setResult(null); setPicked(p => { const n = { ...p }; if (on) delete n[v.id]; else n[v.id] = v.capacity?.value ?? ''; return n }) }} />
                      <span style={{ minWidth: 0 }}><span className="j-strong" style={{ fontSize: 13 }}>{v.label}</span> <span className="j-label">{v.vehicleType ?? 'no type'}</span></span>
                    </label>
                    {on && byWeight && (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input className="j-input j-input--sm" style={{ width: 90 }} type="number" min="0" value={picked[v.id]} onChange={e => { setResult(null); setPicked(p => ({ ...p, [v.id]: e.target.value })) }} placeholder="Capacity" aria-label={`Max load of ${v.label}`} />
                        <span className="j-label">{v.capacity?.unit ?? unit}</span>
                        {opts.canSaveCapacity && Number(picked[v.id]) > 0 && Number(picked[v.id]) !== v.capacity?.value && (
                          <button type="button" className="j-iconbtn" style={{ width: 28, height: 28 }} title="Save as this vehicle's Max Load Capacity"
                            onClick={() => saveVehicleCapacity(v.id, { capacity: Number(picked[v.id]), unit: unit || null }).then(() => routeOptimizationOptions().then(setOpts)).catch(e => setError(errorMessage(e, 'Could not save')))}><Save size={12} /></button>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {byWeight && <div className="j-label" style={{ marginTop: 6 }}>Max Load Capacity is kept on the vehicle as the custom field "Max Load Capacity".</div>}
          </div>

          <div className="j-card j-form-card">
            <div className="j-card-head" style={{ flexWrap: 'wrap' }}>
              <h2 className="j-card-title" style={{ flex: 1 }}>Delivery points <span className="j-label">· {points.length}</span></h2>
              <button type="button" className="j-btn j-btn--sm" onClick={() => setDialog('book')}><BookMarked size={13} /> Address book</button>
              <button type="button" className="j-btn j-btn--sm" onClick={() => setDialog('import')}><Upload size={13} /> Excel / CSV</button>
            </div>
            {points.length === 0 && <div className="j-label">Click the map to add points, or add them from the address book or a sheet.</div>}
            {points.map((p, i) => (
              <div key={p.key} className="j-pt-row" style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span className="j-badge" style={{ width: 24, height: 24, fontSize: 11 }}>{i + 1}</span>
                <input className="j-input j-input--sm" value={p.name} onChange={e => setPoint(p.key, { name: e.target.value })} aria-label="Point name" />
                {byWeight ? <input className="j-input j-input--sm" type="number" min="0" value={p.weight} onChange={e => setPoint(p.key, { weight: e.target.value })} placeholder="Weight" aria-label="Weight" /> : <span />}
                <input className="j-input j-input--sm" type="number" min="0" value={p.stayMin} onChange={e => setPoint(p.key, { stayMin: e.target.value })} aria-label="Stay minutes" title="Stay (min)" />
                <input className="j-input j-input--sm" type="time" value={p.windowFrom} onChange={e => setPoint(p.key, { windowFrom: e.target.value })} aria-label="Window from" title="Window from" />
                <input className="j-input j-input--sm" type="time" value={p.windowTo} onChange={e => setPoint(p.key, { windowTo: e.target.value })} aria-label="Window to" title="Window to" />
                <button type="button" className="j-iconbtn" style={{ width: 26, height: 26 }} onClick={() => { setResult(null); setPoints(x => x.filter(y => y.key !== p.key)) }} aria-label="Remove point"><X size={12} /></button>
              </div>
            ))}
            {points.length > 0 && <div className="j-label" style={{ marginTop: 6 }}>Name{byWeight ? ', weight' : ''}, stay (min), then the time window (optional). Load type: Partial spreads the load over the vehicles, Full fills each vehicle before the next.</div>}
          </div>
          <button type="button" className="j-btn j-btn--primary" style={{ height: 46, fontSize: 14 }} disabled={!ready || busy} onClick={optimize}><Wand2 size={16} /> {busy && !result ? 'Optimizing…' : 'Optimize routes'}</button>
        </div>

        <div className="j-grid" style={{ gap: 14 }}>
          <div className="j-card j-card--flush" style={{ position: 'relative' }}>
            <div style={{ height: typeof window !== 'undefined' && window.innerWidth < 640 ? 340 : 520 }}>
              <MapContainer center={UAE_CENTER} zoom={8} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FitTo points={fit} k={`${fit.length}|${result ? 'r' : ''}`} />
                <Clicks onClick={onMap} />
                {result?.trips.map((t, k) => (
                  <Polyline key={k} positions={[[result.start.lat, result.start.lng], ...t.stops.map(s => [s.lat, s.lng]), ...(t.back ? [[result.start.lat, result.start.lng]] : [])]}
                    pathOptions={{ color: TRIP_COLORS[k % TRIP_COLORS.length], weight: 4, opacity: 0.9, dashArray: result.estimated ? '8 6' : undefined }} />
                ))}
                {start && <Marker position={[start.lat, start.lng]} icon={pin('S', '#f3f7f9', true)} />}
                {points.map((p, i) => {
                  const hit = tripOf.get(`${p.lat},${p.lng},${p.name}`)
                  return <Marker key={p.key} position={[p.lat, p.lng]} icon={pin(hit ? hit.seq : i + 1, hit ? TRIP_COLORS[hit.k % TRIP_COLORS.length] : result ? '#a7b6bf' : '#dfe8ed')} />
                })}
              </MapContainer>
            </div>
            <span className="j-pill j-pill--plain" style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, background: 'rgba(30,45,54,.88)' }}>
              <MapPin size={12} /> {click === 'start' || !start ? 'Click the map to set the start' : 'Click the map to add a delivery point'}
            </span>
          </div>

          {result && (
            <div className="j-card">
              <div className="j-card-head" style={{ flexWrap: 'wrap' }}>
                <h2 className="j-card-title" style={{ flex: 1 }}>{result.trips.length} trip{result.trips.length === 1 ? '' : 's'} · {result.totalKm} km{result.estimated ? ' (estimated)' : ''}</h2>
                <label className="j-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sendHse} onChange={e => setSendHse(e.target.checked)} /> Send to HSE at once</label>
                <button type="button" className="j-btn j-btn--sm j-btn--primary" disabled={busy || !result.trips.length || Boolean(made)} onClick={createAll}><CirclePlus size={13} /> Create {result.trips.length} journey{result.trips.length === 1 ? '' : 's'}</button>
              </div>
              {result.trips.map((t, k) => {
                const m = made?.find(x => x.trip === t)
                return (
                  <div key={k} className="j-inset" style={{ marginBottom: 10, borderLeft: `4px solid ${TRIP_COLORS[k % TRIP_COLORS.length]}` }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="j-strong" style={{ flex: 1 }}>{t.vehicleLabel} · trip {t.tripNo}</span>
                      <span className="j-label">{hhmm(t.startAt)} → {hhmm(t.endAt)} · {t.distanceKm} km · {duration(t.driveMin)} driving{t.stayMin ? ` + ${duration(t.stayMin)} stops` : ''}</span>
                    </div>
                    {byWeight && <div className="j-label" style={{ marginTop: 4 }}>Load {t.totalWeight} / {t.capacity} {unit} ({t.utilisation}%)</div>}
                    <div className="j-bar" style={{ marginTop: 6, display: byWeight ? 'block' : 'none' }}><i style={{ width: `${Math.min(100, t.utilisation ?? 0)}%` }} /></div>
                    <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                      {t.stops.map(s => (
                        <span key={s.seq}>
                          <span style={{ whiteSpace: 'nowrap' }}><b>{s.seq}.</b> {s.name} <span className="j-muted">{hhmm(s.arriveAt)}</span></span>{s.windowLate ? <span className="j-err"> (window +{s.windowLate} min)</span> : ''}{s.seq < t.stops.length ? ' → ' : ''}
                        </span>
                      ))}
                    </div>
                    {m && (m.error ? <div className="j-err" style={{ marginTop: 6 }}><AlertTriangle size={12} /> {m.error}</div> : <div className="j-ok-text" style={{ marginTop: 6 }}><Check size={12} /> <Link to={`/journeys/${m.id}`} style={{ textDecoration: 'underline' }}>{m.ref}</Link> {sendHse ? 'sent to HSE' : 'saved as a draft'}</div>)}
                  </div>
                )
              })}
              {result.unassigned.length > 0 && (
                <div className="j-inset" style={{ borderColor: 'rgba(255,143,128,.45)' }}>
                  <div className="j-strong" style={{ marginBottom: 4 }}>Left out ({result.unassigned.length})</div>
                  {result.unassigned.map((u, i) => <div key={i} style={{ fontSize: 12.5 }}>{u.name}: {u.reason}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {dialog === 'book' && <AddressPicker addresses={addresses} onClose={() => setDialog(null)} onPick={list => { setDialog(null); addPoints(list) }} />}
      {dialog === 'import' && <StopsImport withWeights title="Upload delivery points" addresses={addresses} onClose={() => setDialog(null)} onImport={rows => { setDialog(null); addPoints(rows) }} />}
    </JourneyShell>
  )
}
