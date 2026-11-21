/**
 * Route optimization (client 2026-11-21, after Uffizio's Settings › Job ›
 * Route Optimization): split delivery points into trips per vehicle and
 * order each trip, minimising the total distance, within each vehicle's
 * capacity and the radius. Pure: the distances come in as a matrix
 * (lib/distanceProvider.js), so the same code runs on estimates or on a road
 * routing service.
 *
 * The heuristic (a capacity-aware vehicle-routing heuristic, fast enough for
 * a few hundred points on the server):
 *   1. Points outside the radius, or heavier than every vehicle, are left out
 *      with the reason.
 *   2. Sweep: points sorted by their bearing from the start; walking round,
 *      a trip takes points until its limit — the vehicle's capacity
 *      (DISTANCE_WEIGHT; Load Type FULL fills each vehicle, PARTIAL spreads
 *      the load over all of them) or an even share of the points (DISTANCE).
 *      Every starting bearing is tried; the best total wins.
 *   3. Each trip: nearest neighbour from the start, then 2-opt.
 *   4. Trips go to the vehicles in turn (a vehicle may do up to maxTrips
 *      trips, one after the other, back at the start in between).
 * Time windows are soft: the stop times are worked out (waiting when early)
 * and a stop reached after its window is flagged.
 */

const R = 6371.0088
export function haversineKm(a, b) {
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

const bearing = (o, p) => Math.atan2(p.lng - o.lng, p.lat - o.lat)

/** Length of a trip [0, …stops, 0?] through the matrix (index 0 = the start). */
export function tripKm(order, km, returnToStart = true) {
  let total = 0, prev = 0
  for (const i of order) { total += km[prev][i]; prev = i }
  if (returnToStart && order.length) total += km[prev][0]
  return total
}

/** Nearest neighbour from the start over these matrix indexes. */
export function nearestNeighbour(ids, km) {
  const left = new Set(ids)
  const out = []
  let cur = 0
  while (left.size) {
    let best = null, bestD = Infinity
    for (const i of left) if (km[cur][i] < bestD) { bestD = km[cur][i]; best = i }
    out.push(best)
    left.delete(best)
    cur = best
  }
  return out
}

/** 2-opt: reverse any stretch that makes the trip shorter, until none does. */
export function twoOpt(order, km, returnToStart = true) {
  const route = [0, ...order, ...(returnToStart ? [0] : [])]
  const n = route.length
  let improved = true
  let guard = 0
  while (improved && guard++ < 200) {
    improved = false
    for (let i = 1; i < n - 2; i++) {
      for (let k = i + 1; k < n - (returnToStart ? 1 : 0); k++) {
        const a = route[i - 1], b = route[i], c = route[k], d = route[k + 1]
        const before = km[a][b] + (d === undefined ? 0 : km[c][d])
        const after = km[a][c] + (d === undefined ? 0 : km[b][d])
        if (after < before - 1e-9) {
          route.splice(i, k - i + 1, ...route.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
  }
  return route.slice(1, returnToStart ? -1 : undefined)
}

const minOfDay = hhmm => {
  if (!hhmm) return null
  const [h, m] = String(hhmm).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
const UAE_MS = 4 * 3600 * 1000

/**
 * @param {object} p
 * @param {{lat,lng,name?}} p.start
 * @param {Array<{id?,name,lat,lng,weight?,stayMin?,windowFrom?,windowTo?}>} p.points
 * @param {Array<{id,label?,capacity?}>} p.vehicles
 * @param {'DISTANCE'|'DISTANCE_WEIGHT'} p.mode
 * @param {'FULL'|'PARTIAL'} [p.loadType]
 * @param {number|null} [p.radiusKm]
 * @param {number[][]} p.km    (n+1)² km, index 0 = the start, i = points[i-1]
 * @param {number[][]} p.min   (n+1)² driving minutes
 * @param {number} [p.startAt] ms; the first trip leaves then
 * @param {number} [p.maxTrips] per vehicle
 * @param {boolean} [p.returnToStart]
 */
export function optimizeRoutes({ start, points, vehicles, mode = 'DISTANCE', loadType = 'PARTIAL', radiusKm = null, km, min, startAt = Date.now(), maxTrips = 3, returnToStart = true, turnaroundMin = 30 }) {
  const byWeight = mode === 'DISTANCE_WEIGHT'
  const unassigned = []
  const fleet = vehicles.map(v => ({ ...v, capacity: byWeight ? Number(v.capacity) : Infinity }))
    .filter(v => !byWeight || v.capacity > 0)
    .sort((a, b) => b.capacity - a.capacity)
  if (!fleet.length) return { trips: [], unassigned: points.map(p => ({ ...p, reason: byWeight ? 'No vehicle has a load capacity' : 'No vehicle' })), totalKm: 0 }
  const maxCap = Math.max(...fleet.map(v => v.capacity))

  const eligible = []
  points.forEach((p, k) => {
    const i = k + 1
    const w = Number(p.weight) || 0
    if (radiusKm > 0 && haversineKm(start, p) > radiusKm) unassigned.push({ ...p, reason: `Outside the ${radiusKm} km radius` })
    else if (byWeight && w > maxCap) unassigned.push({ ...p, reason: `Heavier (${w}) than any vehicle can carry (${maxCap})` })
    else eligible.push({ i, w, angle: bearing(start, p) })
  })
  if (!eligible.length) return { trips: [], unassigned, totalKm: 0 }

  const slots = []
  for (let r = 0; r < maxTrips; r++) for (const v of fleet) slots.push(v)
  const totalW = eligible.reduce((s, e) => s + e.w, 0)
  const share = Math.ceil(eligible.length / fleet.length)
  /** The limit of the trip in slot s. */
  const limitOf = s => {
    const v = slots[s]
    if (!byWeight) return { maxW: Infinity, maxN: share }
    if (loadType === 'FULL') return { maxW: v.capacity, maxN: Infinity }
    // PARTIAL: an even share of the load, but never above the vehicle's capacity.
    const even = (totalW / fleet.length) * 1.15
    return { maxW: Math.min(v.capacity, Math.max(even, Math.max(...eligible.map(e => e.w)))), maxN: Infinity }
  }

  const sorted = [...eligible].sort((a, b) => a.angle - b.angle)
  let best = null
  // Every starting bearing (up to 60 of them, evenly, for a long list).
  const stepOff = Math.max(1, Math.floor(sorted.length / 60))
  for (let off = 0; off < sorted.length; off += stepOff) {
    const ring = [...sorted.slice(off), ...sorted.slice(0, off)]
    const groups = []
    let s = 0, cur = [], w = 0
    let left = []
    for (const e of ring) {
      if (s >= slots.length) { left.push(e); continue }
      const lim = limitOf(s)
      if (cur.length && (w + e.w > lim.maxW || cur.length >= lim.maxN)) {
        groups.push({ slot: s, ids: cur.map(x => x.i), w })
        s++; cur = []; w = 0
        if (s >= slots.length) { left.push(e); continue }
      }
      cur.push(e); w += e.w
    }
    if (cur.length && s < slots.length) groups.push({ slot: s, ids: cur.map(x => x.i), w })
    else if (cur.length) left = left.concat(cur)
    let total = 0
    const routes = groups.map(g => {
      const order = twoOpt(nearestNeighbour(g.ids, km), km, returnToStart)
      const d = tripKm(order, km, returnToStart)
      total += d
      return { ...g, order, km: d }
    })
    // Fewer points left out always wins; then the shorter total.
    if (!best || left.length < best.left.length || (left.length === best.left.length && total < best.total - 1e-9)) best = { routes, total, left }
  }
  for (const e of best.left) unassigned.push({ ...points[e.i - 1], reason: 'No vehicle trip left (add vehicles or allow more trips)' })

  // Times: each vehicle's trips one after another.
  const freeAt = new Map()
  const trips = best.routes.map(r => {
    const v = slots[r.slot]
    let t = freeAt.get(v.id) ?? startAt
    const leave = t
    let prev = 0, driveMin = 0, stayMin = 0, waitMin = 0, late = 0
    const stops = r.order.map((i, k) => {
      const p = points[i - 1]
      const legKm = km[prev][i], legMin = min[prev][i]
      t += legMin * 60_000
      driveMin += legMin
      const dayStart = Math.floor((t + UAE_MS) / 86_400_000) * 86_400_000 - UAE_MS
      const from = minOfDay(p.windowFrom), to = minOfDay(p.windowTo)
      if (from != null && t < dayStart + from * 60_000) { waitMin += (dayStart + from * 60_000 - t) / 60_000; t = dayStart + from * 60_000 }
      const arriveAt = t
      const windowLate = to != null && t > dayStart + to * 60_000 ? Math.round((t - dayStart - to * 60_000) / 60_000) : 0
      if (windowLate) late++
      const stay = Math.max(0, Number(p.stayMin) || 0)
      stayMin += stay
      t += stay * 60_000
      prev = i
      return { ...p, seq: k + 1, legKm: Math.round(legKm * 100) / 100, legMin: Math.round(legMin), arriveAt: new Date(arriveAt).toISOString(), departAt: new Date(t).toISOString(), windowLate }
    })
    let backKm = 0, backMin = 0
    if (returnToStart && r.order.length) { backKm = km[prev][0]; backMin = min[prev][0]; t += backMin * 60_000; driveMin += backMin }
    freeAt.set(v.id, t + turnaroundMin * 60_000)
    const weight = r.order.reduce((s, i) => s + (Number(points[i - 1].weight) || 0), 0)
    return {
      vehicleId: v.id, vehicleLabel: v.label ?? null, capacity: byWeight ? v.capacity : null,
      stops, back: returnToStart ? { legKm: Math.round(backKm * 100) / 100, legMin: Math.round(backMin) } : null,
      distanceKm: Math.round(r.km * 10) / 10, driveMin: Math.round(driveMin), stayMin: Math.round(stayMin), waitMin: Math.round(waitMin),
      totalWeight: Math.round(weight * 100) / 100,
      utilisation: byWeight && v.capacity > 0 ? Math.round((weight / v.capacity) * 100) : null,
      startAt: new Date(leave).toISOString(), endAt: new Date(t).toISOString(), lateStops: late,
    }
  })
  // Number the trips per vehicle in time order.
  const n = new Map()
  for (const tr of [...trips].sort((a, b) => a.startAt.localeCompare(b.startAt))) { n.set(tr.vehicleId, (n.get(tr.vehicleId) ?? 0) + 1); tr.tripNo = n.get(tr.vehicleId) }
  return { trips, unassigned, totalKm: Math.round(best.total * 10) / 10 }
}
