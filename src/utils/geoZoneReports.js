// Geo Zone Visit Report — per-sub-report aggregation.
//
// Pure derivation layer between geoZoneEngine.js's analyzeVehicle() (one
// vehicle's segments/trips/visits/historyRows) and the page/export code. Runs
// analyzeVehicle TWICE per vehicle — once against the user's GEOFENCE zones,
// once against their ADDRESS zones — since the reference's 5 sub-reports split
// along that line: Trip Report, Visited Summary, Geofence History and the
// Geofence-to-Geofence Trip Summary all read geofences only; Address Visits
// reads addresses only. Both passes share the one already-fetched message
// set, so there is no extra network cost to running both.
//
// Driver / Employee No render "--" everywhere: this fleet has no driver-tag/
// RFID field anywhere in Flespi (see geoZoneEngine.js's own note), so a
// per-trip driver can never be derived, only guessed — and guessing is not
// what "never invent values" allows.
//
// Fuel: no fuel field exists on any device on this account (re-probed for
// Phase 5 Movement Report) — fuel columns always render "0.0" (numeric) or
// "--" (Fuel Cost, which has no numeric default in the reference). Temperature:
// only `ble.sensor.temperature.1` is fetched, and only the Test Bench device
// has live values for it, so every other vehicle's Port/Reach/Departure/
// Average temperature columns read "0.0" — the reference's own convention for
// "no reading" is 0.0, not a blank cell, so that is what every vehicle without
// sensor data gets too.
import { analyzeVehicle } from './geoZoneEngine'
import { settingsProfileForImei } from '../data/settings'
import { reverseGeocodeMany, geocodeKey, shortenAddress, countUncached } from './geocode'

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ── formatting ──────────────────────────────────────────────────────────────

const pad2 = n => String(n).padStart(2, '0')

/** Seconds -> "HH:MM:SS", hours uncapped (the reference's totals run past 24). */
export function formatHMS(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`
}

/** Seconds -> "HH:MM", hours uncapped — the Geofence-to-Geofence summary's unit. */
export function formatHM(seconds) {
  const total = Math.max(0, Math.round((seconds || 0) / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${pad2(h)}:${pad2(m)}`
}

/**
 * "DD-MM-YYYY hh:mm[:ss] AM/PM" — the reference PDFs' own date form (UAE
 * locale), distinct from movementReport.js's M/D/YYYY (a different reference
 * sample). `seconds: true` is used for Trip Report / G2G Trip Summary
 * timestamps (the reference shows seconds there); Visited Summary, Address
 * Visits and Geofence History omit them.
 */
export function formatGZDateTime(ts, { seconds = false } = {}) {
  if (ts == null) return '--'
  const d = new Date(ts * 1000)
  const date = `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`
  const h24 = d.getHours()
  const h = h24 % 12 || 12
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const time = seconds
    ? `${pad2(h)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${mer}`
    : `${pad2(h)}:${pad2(d.getMinutes())} ${mer}`
  return `${date} ${time}`
}

function coordText(p) {
  if (p?.lat == null || p?.lng == null) return '--'
  return `${p.lat},${p.lng}`
}

function formatTemp(v) {
  return v != null ? v.toFixed(1) : '0.0'
}

// ── temperature lookups ─────────────────────────────────────────────────────
// Trips/visits/history rows only carry {ts,lat,lng} (geoZoneEngine's msgPoint),
// not the raw message — so a temperature reading "at" a trip boundary means
// finding the nearest raw message by timestamp in the vehicle's own message
// array (ascending), via binary search.

function findMessageAtTs(messages, ts) {
  if (ts == null || !messages.length) return null
  let lo = 0, hi = messages.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((messages[mid].timestamp ?? 0) < ts) lo = mid + 1
    else hi = mid
  }
  const candidates = [messages[lo - 1], messages[lo]].filter(Boolean)
  candidates.sort((a, b) => Math.abs((a.timestamp ?? Infinity) - ts) - Math.abs((b.timestamp ?? Infinity) - ts))
  return candidates[0] ?? null
}

function temperatureAtTs(messages, ts) {
  const m = findMessageAtTs(messages, ts)
  return num(m?.['ble.sensor.temperature.1'])
}

function temperatureAvg(messages, fromTs, toTs) {
  let sum = 0, n = 0
  for (const m of messages) {
    const ts = m.timestamp
    if (ts == null || ts < fromTs || ts > toTs) continue
    const t = num(m['ble.sensor.temperature.1'])
    if (t != null) { sum += t; n++ }
  }
  return n > 0 ? sum / n : null
}

// ── vehicle meta + zone scoping ─────────────────────────────────────────────

/**
 * Company/Branch/Vehicle-label for one Flespi device row, via the SAME
 * IMEI-keyed join the Live Map's vehicle panel already uses
 * (`settingsProfileForImei`, re-exported from data/settings.js and backed by
 * the same stores in both mock and real mode — no separate real-mode-only
 * join needed). `company`/`branch` read "—" for an unlinked device, matching
 * the app's own existing convention for "no Settings registration" rather
 * than inventing a label.
 */
export function vehicleMeta(vehicle) {
  const profile = settingsProfileForImei(vehicle.ident)
  return {
    deviceId: vehicle.id,
    vehicleId: vehicle.master?.plateNo || vehicle.name || `Device ${vehicle.id}`,
    company: profile.linked ? profile.bgName : '—',
    branch: profile.linked ? profile.branchName : '—',
    bgId: profile.linked ? profile.bgId : null,
  }
}

/**
 * The zones one vehicle gets tested against: its own BG's zones in real mode
 * (tenant isolation — a vehicle never sees another BG's geofences), the full
 * scoped list in mock mode (explicit instruction — mock data has no reliable
 * per-vehicle BG wiring worth replicating), further narrowed to the user's
 * multi-select when one was made.
 */
export function zonesForVehicle(meta, allZones, isMockMode, selectedIds) {
  let zones = isMockMode
    ? allZones
    : (meta.bgId ? allZones.filter(z => z.companyId === meta.bgId) : [])
  if (selectedIds && selectedIds.size > 0) zones = zones.filter(z => selectedIds.has(String(z.id)))
  return zones
}

/**
 * Run the engine for every vehicle, geofences and addresses both.
 *
 * @param {Map<number,{messages:object[],truncated:boolean}>} byDeviceMessages
 * @param {object[]} vehicles           from useFlespiData() — already scoped
 *                                       to the signed-in account
 * @param {object[]} geofenceZones      useGeofences() rows with kind GEOFENCE
 * @param {object[]} addressZones       useGeofences() rows with kind ADDRESS
 * @param {object} [opts]               dwellSec, mergeGapSec, maxGapSec,
 *                                       isMockMode, selectedGeofenceIds,
 *                                       selectedAddressIds (Set<string>)
 * @returns {Map<number,{meta,messages,geo,addr}>}
 */
export function buildGeoZoneAnalysis(byDeviceMessages, vehicles, geofenceZones, addressZones, opts = {}) {
  const { isMockMode = false, selectedGeofenceIds, selectedAddressIds } = opts
  const analysis = new Map()
  for (const vehicle of vehicles) {
    const meta = vehicleMeta(vehicle)
    const messages = byDeviceMessages.get(vehicle.id)?.messages ?? []
    const geoZones = zonesForVehicle(meta, geofenceZones, isMockMode, selectedGeofenceIds)
    const addrZones = zonesForVehicle(meta, addressZones, isMockMode, selectedAddressIds)
    analysis.set(vehicle.id, {
      meta,
      messages,
      geo: analyzeVehicle(messages, geoZones, opts),
      addr: analyzeVehicle(messages, addrZones, opts),
    })
  }
  return analysis
}

// ── 1. Geofence Trip Report ─────────────────────────────────────────────────
//
// "Last Distance" has no clearer definition in the reference than "Distance"
// itself (both columns were present but only one value was legible in the
// source row read for this build) — assumed equal to the trip's own
// distanceKm, same as Distance, rather than guessed at a second meaning.

export function buildTripReport(analysis) {
  let totalDistance = 0, totalRunning = 0, totalIdle = 0, totalStop = 0, totalInactive = 0
  const perVehiclePages = []
  const locationRefs = []

  for (const { meta, geo, messages } of analysis.values()) {
    const rows = geo.trips.map(t => {
      const row = {
        company: meta.company, branch: meta.branch, vehicle: meta.vehicleId, driver: '--',
        startFence: t.startFence?.name ?? '--',
        startLat: t.start.lat, startLng: t.start.lng, startLocation: null,
        startPosition: coordText(t.start),
        startTime: formatGZDateTime(t.start.ts, { seconds: true }),
        startTemp: formatTemp(temperatureAtTs(messages, t.start.ts)),
        endFence: t.endFence?.name ?? '--',
        endLat: t.end.lat, endLng: t.end.lng, endLocation: null,
        endPosition: coordText(t.end),
        endTime: formatGZDateTime(t.end.ts, { seconds: true }),
        endTemp: formatTemp(temperatureAtTs(messages, t.end.ts)),
        avgTemp: formatTemp(temperatureAvg(messages, t.start.ts, t.end.ts)),
        distanceKm: t.distanceKm.toFixed(2),
        lastDistanceKm: t.distanceKm.toFixed(2),
        runningSec: formatHMS(t.runningSec), idleSec: formatHMS(t.idleSec),
        stopSec: formatHMS(t.stopSec), inactiveSec: formatHMS(t.inactiveSec),
        duration: formatHMS(t.durationSec),
        startFuel: '0.0', endFuel: '0.0', refill: '0.0', drain: '0.0',
        fuelConsumed: '0.0', fuelCost: '--',
      }
      locationRefs.push({ obj: row, latKey: 'startLat', lngKey: 'startLng', textKey: 'startLocation' })
      locationRefs.push({ obj: row, latKey: 'endLat', lngKey: 'endLng', textKey: 'endLocation' })
      return row
    })

    totalDistance += geo.trips.reduce((s, t) => s + t.distanceKm, 0)
    totalRunning += geo.trips.reduce((s, t) => s + t.runningSec, 0)
    totalIdle += geo.trips.reduce((s, t) => s + t.idleSec, 0)
    totalStop += geo.trips.reduce((s, t) => s + t.stopSec, 0)
    totalInactive += geo.trips.reduce((s, t) => s + t.inactiveSec, 0)
    perVehiclePages.push({ meta, rows })
  }

  return {
    summary: {
      distanceKm: totalDistance.toFixed(2),
      runningSec: formatHMS(totalRunning), idleSec: formatHMS(totalIdle),
      stopSec: formatHMS(totalStop), inactiveSec: formatHMS(totalInactive),
      fuelConsumed: '0.0',
    },
    perVehiclePages,
    locationRefs,
  }
}

// ── 2. Geofence Visited Summary ─────────────────────────────────────────────

export function buildVisitedSummary(analysis) {
  let totalVisits = 0, totalDuration = 0, totalOutside = 0
  const vehicleRows = []
  const perVehiclePages = []
  const locationRefs = []

  for (const { meta, geo, messages } of analysis.values()) {
    let vDuration = 0, vOutside = 0
    const rows = geo.visits.map(v => {
      const duration = v.depart ? Math.max(0, (v.depart.ts ?? 0) - (v.reach.ts ?? 0)) : 0
      const outside = v.outsideDurationSec ?? 0
      vDuration += duration
      vOutside += outside
      const row = {
        geofence: v.fence?.name ?? '--',
        reachTime: formatGZDateTime(v.reach.ts),
        reachLat: v.reach.lat, reachLng: v.reach.lng, reachLocation: null,
        reachCoordinates: coordText(v.reach),
        departTime: v.depart ? formatGZDateTime(v.depart.ts) : '--',
        departLat: v.depart?.lat ?? null, departLng: v.depart?.lng ?? null, departLocation: null,
        departCoordinates: v.depart ? coordText(v.depart) : '--',
        geofenceDuration: formatHMS(duration),
        geofenceOutsideDuration: formatHMS(outside),
        tempPort: '0.0',
        tempReach: formatTemp(temperatureAtTs(messages, v.reach.ts)),
        tempDeparture: v.depart ? formatTemp(temperatureAtTs(messages, v.depart.ts)) : '0.0',
        tempAverage: formatTemp(temperatureAvg(messages, v.reach.ts, v.depart ? v.depart.ts : v.reach.ts)),
      }
      locationRefs.push({ obj: row, latKey: 'reachLat', lngKey: 'reachLng', textKey: 'reachLocation' })
      if (v.depart) locationRefs.push({ obj: row, latKey: 'departLat', lngKey: 'departLng', textKey: 'departLocation' })
      return row
    })

    totalVisits += geo.visits.length
    totalDuration += vDuration
    totalOutside += vOutside
    vehicleRows.push({
      company: meta.company, branch: meta.branch, vehicle: meta.vehicleId,
      noOfVisits: geo.visits.length,
      geofenceDuration: formatHMS(vDuration),
      geofenceOutsideDuration: formatHMS(vOutside),
    })
    perVehiclePages.push({
      meta,
      summary: { geofenceDuration: formatHMS(vDuration), geofenceOutsideDuration: formatHMS(vOutside) },
      rows,
    })
  }

  return {
    summary: {
      noOfVisits: totalVisits,
      geofenceDuration: formatHMS(totalDuration),
      geofenceOutsideDuration: formatHMS(totalOutside),
    },
    vehicleRows,
    perVehiclePages,
    locationRefs,
  }
}

// ── 3. Address Visits ───────────────────────────────────────────────────────
// Flat, non-grouped table, sorted chronologically across every vehicle. No
// geocoding: Name/Type come from the ADDRESS zone record itself, not a
// reverse-geocode of the vehicle's position.

export function buildAddressVisits(analysis) {
  const entries = []
  for (const { meta, addr } of analysis.values()) {
    for (const v of addr.visits) {
      entries.push({
        ts: v.reach.ts ?? 0,
        row: {
          company: meta.company, branch: meta.branch, object: meta.vehicleId, driver: '--',
          name: v.fence?.name ?? '--',
          type: v.fence?.category || '--',
          arrivalTime: formatGZDateTime(v.reach.ts),
          departureTime: v.depart ? formatGZDateTime(v.depart.ts) : '--',
          visitDuration: v.depart ? formatHM((v.depart.ts ?? 0) - (v.reach.ts ?? 0)) : '--',
        },
      })
    }
  }
  entries.sort((a, b) => a.ts - b.ts)
  return { rows: entries.map(e => e.row) }
}

// ── 4. Geofence History ─────────────────────────────────────────────────────
// Two levels: one summary row per (vehicle, geofence) pair with a visit
// count, and — under it — every individual entry/exit for that pair.

export function buildGeofenceHistory(analysis) {
  const groups = []
  const locationRefs = []

  for (const { meta, geo } of analysis.values()) {
    const byFence = new Map()
    for (const row of geo.historyRows) {
      const fid = row.fence?.id
      if (fid == null) continue
      if (!byFence.has(fid)) byFence.set(fid, { fence: row.fence, rows: [] })
      byFence.get(fid).rows.push(row)
    }

    for (const { fence, rows } of byFence.values()) {
      const detailRows = rows.map(r => {
        const dr = {
          company: meta.company, branch: meta.branch, vehicle: meta.vehicleId,
          driver: '--', employeeNo: '--', geofenceName: fence.name,
          entryTime: formatGZDateTime(r.entry.ts),
          entryLat: r.entry.lat, entryLng: r.entry.lng, entryPosition: null,
          durationInFence: formatHMS(r.durationSec),
          approxDistance: (r.distanceKm ?? 0).toFixed(2),
          exitTime: r.exit ? formatGZDateTime(r.exit.ts) : '--',
          exitLat: r.exit?.lat ?? null, exitLng: r.exit?.lng ?? null, exitPosition: null,
        }
        locationRefs.push({ obj: dr, latKey: 'entryLat', lngKey: 'entryLng', textKey: 'entryPosition' })
        if (r.exit) locationRefs.push({ obj: dr, latKey: 'exitLat', lngKey: 'exitLng', textKey: 'exitPosition' })
        return dr
      })

      groups.push({
        company: meta.company, branch: meta.branch, object: meta.vehicleId,
        driver: '--', employeeNo: '--',
        geofenceName: fence.name, geofenceType: fence.category || '--',
        noOfVisits: rows.length,
        detailRows,
      })
    }
  }

  return { groups, locationRefs }
}

// ── 5. Geofence-to-Geofence Trip Summary ────────────────────────────────────
// Top summary has no Idle bucket (confirmed against the reference's own
// Summary block); the per-vehicle Detail row does; the per-vehicle trip-by-
// trip page adds AVG/MAX speed, computed from the trip's own usage window.

export function buildG2GTripSummary(analysis) {
  let totalTrips = 0, totalDistance = 0, totalRunning = 0, totalStop = 0, totalInactive = 0
  const vehicleRows = []
  const perVehiclePages = []

  for (const { meta, geo } of analysis.values()) {
    const trips = geo.trips
    let vDist = 0, vRun = 0, vIdle = 0, vStop = 0, vInactive = 0, vDuration = 0

    const rows = trips.map((t, i) => {
      vDist += t.distanceKm; vRun += t.runningSec; vIdle += t.idleSec
      vStop += t.stopSec; vInactive += t.inactiveSec; vDuration += t.durationSec
      const runningHours = t.runningSec / 3600
      const avg = runningHours > 0 ? Math.round(t.distanceKm / runningHours) : 0
      return {
        tripNo: i + 1, driver: '--', employeeNo: '--',
        startFence: t.startFence?.name ?? '--', startDate: formatGZDateTime(t.start.ts, { seconds: true }),
        endFence: t.endFence?.name ?? '--', endDate: formatGZDateTime(t.end.ts, { seconds: true }),
        distanceKm: t.distanceKm.toFixed(2),
        running: formatHM(t.runningSec), idle: formatHM(t.idleSec),
        stop: formatHM(t.stopSec), inactive: formatHM(t.inactiveSec),
        duration: formatHM(t.durationSec),
        avg, max: Math.round(t.maxSpeed || 0),
      }
    })

    totalTrips += trips.length
    totalDistance += vDist
    totalRunning += vRun
    totalStop += vStop
    totalInactive += vInactive

    vehicleRows.push({
      company: meta.company, branch: meta.branch, vehicle: meta.vehicleId, driver: '--', employeeNo: '--',
      startFence: trips[0]?.startFence?.name ?? '--',
      endFence: trips[trips.length - 1]?.endFence?.name ?? '--',
      noOfTrips: trips.length, distanceKm: vDist.toFixed(2),
      running: formatHM(vRun), idle: formatHM(vIdle),
      stop: formatHM(vStop), inactive: formatHM(vInactive), duration: formatHM(vDuration),
    })
    perVehiclePages.push({ meta, rows })
  }

  return {
    summary: {
      noOfTrips: totalTrips, distanceKm: totalDistance.toFixed(2),
      running: formatHM(totalRunning), stop: formatHM(totalStop), inactive: formatHM(totalInactive),
    },
    vehicleRows,
    perVehiclePages,
  }
}

// ── shared location resolution ──────────────────────────────────────────────
// One pattern for all 4 reports that carry a lat/lng-backed Location/Position
// field (everything except Address Visits, which needs no geocoding) —
// mirrors movementReport.js's resolveReportLocations exactly: resolve in
// place, in order, up to a network-lookup budget, so the table renders
// immediately with raw coordinates and addresses fill in behind it.

export function countGeoZonePendingGeocodes(locationRefs) {
  const coords = locationRefs
    .map(r => ({ lat: r.obj[r.latKey], lng: r.obj[r.lngKey] }))
    .filter(c => c.lat != null && c.lng != null)
  return countUncached(coords)
}

export async function resolveGeoZoneLocations(locationRefs, opts = {}) {
  const { limit = Infinity, signal, onProgress } = opts
  const coords = locationRefs
    .map(r => ({ lat: r.obj[r.latKey], lng: r.obj[r.lngKey] }))
    .filter(c => c.lat != null && c.lng != null)
  if (coords.length === 0) return { resolved: 0, skipped: 0 }

  const { addresses, resolved, skipped } = await reverseGeocodeMany(coords, { limit, signal, onProgress })
  for (const ref of locationRefs) {
    const lat = ref.obj[ref.latKey], lng = ref.obj[ref.lngKey]
    if (lat == null || lng == null) continue
    const hit = addresses.get(geocodeKey(lat, lng))
    if (hit) ref.obj[ref.textKey] = `${shortenAddress(hit, 4)};`
  }
  return { resolved, skipped }
}

/** What a Location/Position field shows right now — raw coordinates until resolved. */
export function locationText(obj, textKey, latKey, lngKey) {
  if (obj[textKey]) return obj[textKey]
  const lat = obj[latKey], lng = obj[lngKey]
  if (lat == null || lng == null) return '--'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}
