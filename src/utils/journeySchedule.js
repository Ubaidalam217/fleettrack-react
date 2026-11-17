/**
 * The chained schedule of a journey and how its times are judged — shared by
 * the server (routes/journeys.js computes and stores it, the engine judges
 * against it) and the web (New Journey shows it live as the planner types).
 *
 * Client, 2026-11-17: "leave Karachi 10:00 → Hyderabad 12:00 (2 h) → stay
 * 30 min → leave 12:30 → next leg 2 h…". The planner sets the start time;
 * every stop's planned arrive / leave then adds up:
 *
 *   arrive(i) = leave(i-1) + legDriveMin(i)
 *   leave(i)  = arrive(i)  + stayMin(i)
 *
 * A leg's drive time comes from, in order:
 *   MANUAL  the planner typed it (or moved the stop's arrival, which sets it)
 *   TRIP    the past trip the route was copied from (time between the two
 *           closest approaches)
 *   SPEED   leg km ÷ the planned speed (Journey settings)
 * Changing one leg shifts every time after it, nothing before it.
 */

export const LEG_SOURCES = ['SPEED', 'TRIP', 'MANUAL']

const toMs = v => (v == null || v === '' ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v))
const MIN = 60_000

/** Minutes for `km` at `kmh`, at least 1 for any real distance. */
export function legMinutes(km, kmh) {
  if (!(km > 0)) return 0
  return Math.max(1, Math.round((km / Math.max(1, kmh || 70)) * 60))
}

/**
 * @param {object} p
 * @param {Date|string|number} p.plannedStart  when the vehicle leaves the first stop
 * @param {number} p.speedKmh                  planned speed for SPEED legs
 * @param {Array<{ legKm?: number, legDriveMin?: number|null, legSource?: string, stayMin?: number }>} p.stops
 *        in order, origin first; the origin's leg is ignored.
 * @returns {{ stops: object[], expectedArrival: Date|null, distanceKm: number, driveMin: number, stayMin: number, totalMin: number }}
 */
export function computeSchedule({ plannedStart, speedKmh = 70, stops = [] }) {
  const start = toMs(plannedStart)
  let clock = start
  let driveMin = 0, stayMin = 0, distanceKm = 0
  const out = stops.map((s, i) => {
    const stay = Math.max(0, Math.round(Number(s.stayMin) || 0))
    if (i === 0) {
      return { ...s, legKm: 0, legDriveMin: 0, legSource: null, stayMin: 0, plannedArrive: null, plannedDepart: start == null ? null : new Date(start) }
    }
    const km = Math.max(0, Number(s.legKm) || 0)
    let source = LEG_SOURCES.includes(s.legSource) ? s.legSource : 'SPEED'
    let leg = s.legDriveMin == null || s.legDriveMin === '' ? null : Math.max(0, Math.round(Number(s.legDriveMin)))
    if (source === 'SPEED' || leg === null || !Number.isFinite(leg)) {
      source = 'SPEED'
      leg = legMinutes(km, speedKmh)
    }
    const last = i === stops.length - 1
    driveMin += leg
    distanceKm += km
    if (!last) stayMin += stay
    const arrive = clock == null ? null : clock + leg * MIN
    const depart = arrive == null || last ? null : arrive + stay * MIN
    if (arrive != null) clock = last ? arrive : depart
    return {
      ...s, legKm: Math.round(km * 100) / 100, legDriveMin: leg, legSource: source, stayMin: last ? stay : stay,
      plannedArrive: arrive == null ? null : new Date(arrive),
      plannedDepart: depart == null ? null : new Date(depart),
    }
  })
  const lastStop = out[out.length - 1]
  return {
    stops: out,
    expectedArrival: out.length > 1 ? lastStop.plannedArrive : null,
    distanceKm: Math.round(distanceKm * 10) / 10,
    driveMin,
    stayMin,
    totalMin: driveMin + stayMin,
  }
}

/**
 * Sets stop i's planned arrival to `arriveAt` by making its leg MANUAL; the
 * times after it follow when the schedule is computed again.
 */
export function overrideArrival(stops, i, arriveAt, schedule) {
  const prev = schedule.stops[i - 1]
  const prevLeave = toMs(prev?.plannedDepart ?? prev?.plannedArrive)
  const at = toMs(arriveAt)
  if (i < 1 || prevLeave == null || at == null) return stops
  const leg = Math.max(0, Math.round((at - prevLeave) / MIN))
  return stops.map((s, k) => (k === i ? { ...s, legDriveMin: leg, legSource: 'MANUAL' } : s))
}

/**
 * The six events of the client's voice note (2026-11-17): a departure or an
 * arrival is EARLY, ON_TIME or LATE against its planned time, with on time
 * meaning within ± `toleranceMin` (Journey settings).
 */
export function timingOf(actual, planned, toleranceMin = 10) {
  const a = toMs(actual), p = toMs(planned)
  if (a == null || p == null) return null
  const diffMin = Math.round((a - p) / MIN)
  const timing = Math.abs(diffMin) <= toleranceMin ? 'ON_TIME' : diffMin > 0 ? 'LATE' : 'EARLY'
  return { timing, diffMin }
}

export const TIMING_LABEL = Object.freeze({ EARLY: 'Early', ON_TIME: 'On time', LATE: 'Late' })

/** "+8 min", "−12 min", "on time" */
export function diffText(diffMin) {
  if (diffMin == null) return ''
  if (diffMin === 0) return '±0 min'
  const h = Math.floor(Math.abs(diffMin) / 60), m = Math.abs(diffMin) % 60
  const body = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
  return `${diffMin > 0 ? '+' : '−'}${body}`
}

/**
 * What a journey shows as its state. "Pending approval" and "Rejected" are
 * stored as Draft with an approval status (design §A.2) but shown as their own.
 */
export function displayStatus(j) {
  if (!j) return 'Draft'
  if (j.status === 'Draft') {
    if (j.approvalStatus === 'PENDING') return 'Pending'
    if (j.approvalStatus === 'REJECTED') return 'Rejected'
    return 'Draft'
  }
  return j.status
}

export const ACTIVE_STATUSES = Object.freeze(['Started', 'InProgress', 'Delayed', 'Interrupted'])
export const FINAL_STATUSES = Object.freeze(['Completed', 'Cancelled'])

/** JRN-2026-0012: the year of the planned start (UAE), and the running number. */
export function journeyRef(j) {
  const ms = toMs(j?.plannedStart)
  const year = ms == null ? '' : new Date(ms + 4 * 3600 * 1000).getUTCFullYear()
  return `JRN-${year}-${String(j?.journeyNo ?? 0).padStart(4, '0')}`
}
