/**
 * The Journey reports (Reports › Journey, client 2026-11-21 after Uffizio's
 * five Job reports, plus the client's own analytics list): pure builders from
 * GET /api/journeys/report rows to the paper's tables (components/reports/
 * CtrackPaper.jsx on screen, utils/ctrackExport.js for PDF and Excel), and the
 * journey list / one journey as a paper for Journeys' Download buttons.
 */

const UAE_MS = 4 * 3600 * 1000
const pad = n => String(n).padStart(2, '0')
const toMs = v => (v == null ? null : typeof v === 'number' ? v : Date.parse(v))

/** "22/11/2026 06:05" in UAE time. */
export function dt(v) {
  const ms = toMs(v)
  if (ms == null || !Number.isFinite(ms)) return '—'
  const d = new Date(ms + UAE_MS)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const hm = v => (toMs(v) == null ? '—' : dt(v).slice(11))
/** "+12 min", "−5 min", "on time" style difference, minutes. */
export function signed(min) {
  if (min == null || !Number.isFinite(min)) return '—'
  if (min === 0) return '0 min'
  const a = Math.abs(Math.round(min))
  const body = a >= 60 ? `${Math.floor(a / 60)} h ${a % 60} min` : `${a} min`
  // A plain hyphen: the PDF's built-in fonts have no minus sign.
  return `${min > 0 ? '+' : '-'}${body}`
}
const km = v => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 10) / 10}`)
const money = v => (v ? Number(v).toFixed(2) : '0.00')
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')
export const STATUS_TEXT = Object.freeze({
  Draft: 'Draft', Pending: 'Pending approval', Rejected: 'Rejected', Scheduled: 'Scheduled', Started: 'Started', InProgress: 'In progress',
  Delayed: 'Delayed', Interrupted: 'No signal', Completed: 'Completed', Cancelled: 'Cancelled', ForceClosed: 'Force closed',
})
const TIMING = { EARLY: 'Early', ON_TIME: 'On time', LATE: 'Late' }

const destination = j => j.stops?.[j.stops.length - 1]
/** Arrived on time (or early) at the destination: the on-time measure. */
export const arrivedOnTime = j => j.status === 'Completed' && destination(j)?.arriveTiming !== 'LATE'
const endDiff = j => (j.actualArrival ? Math.round((toMs(j.actualArrival) - toMs(j.expectedArrival)) / 60000) : null)
const routeOf = j => `${j.stops?.[0]?.name ?? '?'} → ${destination(j)?.name ?? '?'}`
export const drivenKm = j => j.drivenKm ?? (j.status === 'Completed' ? j.plannedDistanceKm : j.progressKm) ?? null
const offRoute = j => j.offRouteCount ?? (j.events ?? []).filter(e => e.type === 'OFF_ROUTE').length

// ── 1. Today's Journey Status ───────────────────────────────────────────────
export const STATUS_COLUMNS = [
  { key: 'ref', label: 'Journey', width: '9%', pdf: 9 },
  { key: 'title', label: 'Title', width: '14%', pdf: 14 },
  { key: 'vehicle', label: 'Vehicle', width: '9%', pdf: 9 },
  { key: 'driver', label: 'Driver', width: '10%', pdf: 10 },
  { key: 'route', label: 'From → To', width: '16%', pdf: 16 },
  { key: 'plannedStart', label: 'Planned start', width: '7%', pdf: 7 },
  { key: 'actualStart', label: 'Left', width: '6%', pdf: 6 },
  { key: 'eta', label: 'ETA / arrived', width: '7%', pdf: 7 },
  { key: 'stops', label: 'Stops', width: '6%', pdf: 6, align: 'center' },
  { key: 'progress', label: 'Km done / planned', width: '8%', pdf: 8, align: 'right' },
  { key: 'status', label: 'Status', width: '8%', pdf: 8 },
]
export function statusRows(journeys) {
  return journeys.map(j => ({
    key: j.id, ref: j.ref, title: j.title, vehicle: j.vehicleLabel, driver: j.driverName || '—', route: routeOf(j),
    plannedStart: hm(j.plannedStart), actualStart: hm(j.actualStart),
    eta: j.status === 'Completed' ? hm(j.actualArrival) : hm(j.etaAt ?? j.expectedArrival),
    stops: `${j.stopsDone ?? 0}/${Math.max(0, (j.stops?.length ?? 1) - 1)}`,
    progress: `${km(j.status === 'Completed' ? j.plannedDistanceKm : j.progressKm ?? 0)} / ${km(j.plannedDistanceKm)}`,
    status: (STATUS_TEXT[j.display] ?? j.display) + (j.delayMin > 10 && ['InProgress', 'Delayed'].includes(j.status) ? ` (${signed(j.delayMin)})` : ''),
  }))
}
export function statusSummary(journeys) {
  const n = s => journeys.filter(j => s.includes(j.display)).length
  return [
    { label: 'Journeys', value: journeys.length },
    { label: 'Waiting for approval', value: n(['Pending']) },
    { label: 'Scheduled', value: n(['Scheduled']) },
    { label: 'On the road', value: n(['Started', 'InProgress', 'Delayed', 'Interrupted']) },
    { label: 'Late now', value: journeys.filter(j => j.status === 'Delayed').length },
    { label: 'Completed', value: n(['Completed']) },
    { label: 'Cancelled / force closed', value: n(['Cancelled', 'ForceClosed']) },
  ]
}

// ── 2. Journey Summary ──────────────────────────────────────────────────────
export const SUMMARY_COLUMNS = [
  { key: 'ref', label: 'Journey', width: '8%', pdf: 8 },
  { key: 'vehicle', label: 'Vehicle', width: '8%', pdf: 8 },
  { key: 'driver', label: 'Driver', width: '9%', pdf: 9 },
  { key: 'customer', label: 'Customer', width: '8%', pdf: 8 },
  { key: 'pStart', label: 'Planned start', width: '9%', pdf: 9 },
  { key: 'aStart', label: 'Actual start', width: '9%', pdf: 9 },
  { key: 'pEnd', label: 'Planned end', width: '9%', pdf: 9 },
  { key: 'aEnd', label: 'Actual end', width: '9%', pdf: 9 },
  { key: 'delay', label: 'Delay', width: '6%', pdf: 6, align: 'right' },
  { key: 'pKm', label: 'Planned km', width: '5%', pdf: 5, align: 'right' },
  { key: 'aKm', label: 'Actual km', width: '5%', pdf: 5, align: 'right' },
  { key: 'alerts', label: 'Alerts', width: '4%', pdf: 4, align: 'right' },
  { key: 'cost', label: 'Cost', width: '5%', pdf: 5, align: 'right' },
  { key: 'status', label: 'Status', width: '7%', pdf: 7 },
]
export function summaryRows(journeys) {
  return journeys.map(j => ({
    key: j.id, ref: j.ref, vehicle: j.vehicleLabel, driver: j.driverName || '—', customer: j.customer || '—',
    pStart: dt(j.plannedStart), aStart: dt(j.actualStart), pEnd: dt(j.expectedArrival), aEnd: dt(j.actualArrival),
    delay: j.status === 'Completed' ? signed(endDiff(j)) : j.delayMin != null && ['InProgress', 'Delayed', 'Started', 'Interrupted'].includes(j.status) ? signed(j.delayMin) : '—',
    pKm: km(j.plannedDistanceKm), aKm: km(drivenKm(j)), alerts: j.alertCount ?? 0, cost: money(j.cost),
    status: STATUS_TEXT[j.display] ?? j.display,
  }))
}
export function summaryTotals(journeys) {
  const done = journeys.filter(j => j.status === 'Completed')
  const delays = done.map(endDiff).filter(v => v != null)
  return [
    { label: 'Journeys', value: journeys.length },
    { label: 'Completed', value: done.length },
    { label: 'Arrived on time', value: pct(done.filter(arrivedOnTime).length, done.length) },
    { label: 'Average delay', value: delays.length ? signed(Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)) : '—' },
    { label: 'Planned km', value: km(journeys.reduce((s, j) => s + (j.plannedDistanceKm ?? 0), 0)) },
    { label: 'Driven km', value: km(journeys.reduce((s, j) => s + (drivenKm(j) ?? 0), 0)) },
    { label: 'Alerts', value: journeys.reduce((s, j) => s + (j.alertCount ?? 0), 0) },
    { label: 'Cost', value: money(journeys.reduce((s, j) => s + (j.cost ?? 0), 0)) },
  ]
}

// ── 3. Journey Detail Summary (per stop) ────────────────────────────────────
export const DETAIL_COLUMNS = [
  { key: 'seq', label: '#', width: '3%', pdf: 3, align: 'center' },
  { key: 'stop', label: 'Stop', width: '13%', pdf: 13 },
  { key: 'state', label: 'State', width: '7%', pdf: 7 },
  { key: 'pArr', label: 'Planned arrive', width: '7%', pdf: 7 },
  { key: 'aArr', label: 'Arrived', width: '7%', pdf: 7 },
  { key: 'arr', label: 'Arrival', width: '8%', pdf: 8 },
  { key: 'pDep', label: 'Planned leave', width: '7%', pdf: 7 },
  { key: 'aDep', label: 'Left', width: '7%', pdf: 7 },
  { key: 'dep', label: 'Departure', width: '8%', pdf: 8 },
  { key: 'legKm', label: 'Leg km', width: '5%', pdf: 5, align: 'right' },
  { key: 'driver', label: 'Driver', width: '9%', pdf: 9 },
  { key: 'events', label: 'Events', width: '5%', pdf: 5, align: 'right' },
  { key: 'signature', label: 'Signature', width: '7%', pdf: 7 },
  { key: 'form', label: 'Form', width: '7%', pdf: 7 },
]
const PURPOSE = { LOADING: 'Loading', UNLOADING: 'Unloading', DELIVERY: 'Delivery', REST: 'Rest', OTHER: 'Other' }
export function detailTables(journeys, { driverOf = j => j.driverName || '—' } = {}) {
  return journeys.map(j => ({
    key: j.id,
    heading: `${j.ref} · ${j.title} · ${j.vehicleLabel} · ${STATUS_TEXT[j.display] ?? j.display}`,
    rows: (j.stops ?? []).map((s, i) => {
      const n = (j.events ?? []).filter(e => e.stopSeq === s.seq && !['STATUS', 'NOTE'].includes(e.type)).length
      return {
        key: `${j.id}-${s.seq}`, seq: i === 0 ? 'A' : i === j.stops.length - 1 ? 'B' : String(i), stop: s.name,
        state: PURPOSE[s.purpose] ?? (i === 0 ? 'Start' : i === j.stops.length - 1 ? 'Destination' : '—'),
        pArr: i === 0 ? '—' : hm(s.plannedArrive), aArr: i === 0 ? '—' : hm(s.actualArrive),
        arr: i === 0 ? '—' : s.status === 'SKIPPED' ? 'Missed' : s.arriveTiming ? `${TIMING[s.arriveTiming]} ${s.arriveDiffMin ? signed(s.arriveDiffMin) : ''}`.trim() : '—',
        pDep: i === j.stops.length - 1 ? '—' : hm(s.plannedDepart), aDep: i === j.stops.length - 1 ? '—' : hm(s.actualDepart),
        dep: i === j.stops.length - 1 ? '—' : s.departTiming ? `${TIMING[s.departTiming]} ${s.departDiffMin ? signed(s.departDiffMin) : ''}`.trim() : '—',
        legKm: i === 0 ? '—' : km(s.legKm), driver: driverOf(j), events: n,
        signature: s.signatureRequired ? (s.signature ? `Signed${s.signature.signedByName ? ` (${s.signature.signedByName})` : ''}` : 'Pending') : '—',
        form: s.formName ? (s.form ? 'Filled' : 'Pending') : '—',
      }
    }),
  }))
}

// ── 4–6. per vehicle / driver / customer ────────────────────────────────────
export const GROUP_COLUMNS = name => [
  { key: 'name', label: name, width: '16%', pdf: 16 },
  { key: 'journeys', label: 'Journeys', width: '7%', pdf: 7, align: 'right' },
  { key: 'completed', label: 'Completed', width: '7%', pdf: 7, align: 'right' },
  { key: 'cancelled', label: 'Cancelled', width: '7%', pdf: 7, align: 'right' },
  { key: 'onTime', label: 'On time', width: '7%', pdf: 7, align: 'right' },
  { key: 'avgDelay', label: 'Avg delay', width: '8%', pdf: 8, align: 'right' },
  { key: 'pKm', label: 'Planned km', width: '8%', pdf: 8, align: 'right' },
  { key: 'aKm', label: 'Driven km', width: '8%', pdf: 8, align: 'right' },
  { key: 'offRoute', label: 'Off route', width: '7%', pdf: 7, align: 'right' },
  { key: 'alerts', label: 'Alerts', width: '7%', pdf: 7, align: 'right' },
  { key: 'cost', label: 'Cost', width: '8%', pdf: 8, align: 'right' },
]
export function groupRows(journeys, keyOf) {
  const groups = new Map()
  for (const j of journeys) {
    const k = keyOf(j) || '—'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(j)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => {
    const done = list.filter(j => j.status === 'Completed')
    const delays = done.map(endDiff).filter(v => v != null)
    return {
      key: name, name, journeys: list.length, completed: done.length,
      cancelled: list.filter(j => j.status === 'Cancelled').length,
      onTime: pct(done.filter(arrivedOnTime).length, done.length),
      avgDelay: delays.length ? signed(Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)) : '—',
      pKm: km(list.reduce((s, j) => s + (j.plannedDistanceKm ?? 0), 0)),
      aKm: km(list.reduce((s, j) => s + (drivenKm(j) ?? 0), 0)),
      offRoute: list.reduce((s, j) => s + offRoute(j), 0),
      alerts: list.reduce((s, j) => s + (j.alertCount ?? 0), 0),
      cost: money(list.reduce((s, j) => s + (j.cost ?? 0), 0)),
    }
  })
}

// ── Journey Analytics (the client's list) ───────────────────────────────────
export function analytics(journeys) {
  const done = journeys.filter(j => j.status === 'Completed')
  const onTime = done.filter(arrivedOnTime).length
  const byRoute = new Map()
  for (const j of journeys) {
    const r = routeOf(j)
    if (!byRoute.has(r)) byRoute.set(r, [])
    byRoute.get(r).push(j)
  }
  const routes = [...byRoute.entries()].map(([route, list]) => {
    const d = list.filter(j => j.status === 'Completed')
    const delays = d.map(endDiff).filter(v => v != null)
    // Planned against driven distance: over the completed journeys only.
    const pKm = d.reduce((s, j) => s + (j.plannedDistanceKm ?? 0), 0)
    const aKm = d.reduce((s, j) => s + (drivenKm(j) ?? 0), 0)
    const off = list.reduce((s, j) => s + offRoute(j), 0)
    return {
      key: route, route, journeys: list.length, completed: d.length,
      onTime: pct(d.filter(arrivedOnTime).length, d.length),
      avgDelay: delays.length ? signed(Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)) : '—',
      avgDelayMin: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
      offRoute: off, offPer100: aKm > 0 ? (Math.round((off / aKm) * 1000) / 10).toFixed(1) : '—',
      pKm: km(pKm), aKm: km(aKm), diff: pKm > 0 && aKm > 0 ? `${aKm >= pKm ? '+' : '-'}${Math.round(Math.abs((aKm - pKm) / pKm) * 100)}%` : '—',
    }
  }).sort((a, b) => (b.avgDelayMin ?? -1e9) - (a.avgDelayMin ?? -1e9))
  const delays = done.map(endDiff).filter(v => v != null)
  const pKm = done.reduce((s, j) => s + (j.plannedDistanceKm ?? 0), 0)
  const aKm = done.reduce((s, j) => s + (drivenKm(j) ?? 0), 0)
  return {
    kpis: {
      journeys: journeys.length, completed: done.length,
      onTimePct: done.length ? Math.round((onTime / done.length) * 100) : null,
      avgDelayMin: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
      offRoute: journeys.reduce((s, j) => s + offRoute(j), 0),
      plannedKm: Math.round(pKm), drivenKm: Math.round(aKm),
      cost: journeys.reduce((s, j) => s + (j.cost ?? 0), 0),
    },
    routes,
  }
}
export const ANALYTICS_COLUMNS = [
  { key: 'route', label: 'Route', width: '26%', pdf: 26 },
  { key: 'journeys', label: 'Journeys', width: '7%', pdf: 7, align: 'right' },
  { key: 'completed', label: 'Completed', width: '7%', pdf: 7, align: 'right' },
  { key: 'onTime', label: 'On time', width: '7%', pdf: 7, align: 'right' },
  { key: 'avgDelay', label: 'Avg delay', width: '9%', pdf: 9, align: 'right' },
  { key: 'offRoute', label: 'Off route', width: '7%', pdf: 7, align: 'right' },
  { key: 'offPer100', label: 'Off route / 100 km', width: '9%', pdf: 9, align: 'right' },
  { key: 'pKm', label: 'Planned km', width: '9%', pdf: 9, align: 'right' },
  { key: 'aKm', label: 'Driven km', width: '9%', pdf: 9, align: 'right' },
  { key: 'diff', label: 'Driven vs planned', width: '10%', pdf: 10, align: 'right' },
]

// ── Journeys' own Download buttons ──────────────────────────────────────────
/** The journey list (one day) as the paper's options. */
export function listExport(journeys, { dayText }) {
  return {
    title: 'Journeys',
    pairs: [['Day', dayText], ['Journeys', String(journeys.length)]],
    tables: [{ key: 'list', columns: STATUS_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: statusRows(journeys) }],
    summary: statusSummary(journeys),
  }
}

const EVENT_COLUMNS = [
  { key: 'at', label: 'Time', width: 12 },
  { key: 'what', label: 'Event', width: 18 },
  { key: 'message', label: 'Details', width: 60 },
]

/** One journey: its facts, its stops planned vs actual, its events. */
export function detailExport(j, { eventLabel = t => t } = {}) {
  const [stops] = detailTables([j])
  return {
    title: `Journey ${j.ref}`,
    pairs: [
      ['Journey', j.title], null, ['Status', STATUS_TEXT[j.display] ?? j.display], ['Priority', j.priority],
      ['Vehicle', j.vehicleLabel], ['Driver', j.driverName || '—'],
      ['Customer', j.customer || '—'], ['Load', j.loadState || '—'],
      ['Planned start', dt(j.plannedStart)], ['Actual start', dt(j.actualStart)],
      ['Planned arrival', dt(j.expectedArrival)], ['Actual arrival', dt(j.actualArrival)],
      ['Planned km', km(j.plannedDistanceKm)], ['Driven km', km(drivenKm(j))],
      ['Approval', j.approvalStatus === 'APPROVED' ? `Approved by ${j.decidedByName ?? '—'}` : j.approvalStatus === 'NOT_REQUIRED' ? 'No approval needed' : j.approvalStatus], ['Cost', money(j.cost?.total ?? j.cost)],
    ],
    tables: [
      { key: 'stops', heading: 'Stops: planned vs actual', columns: DETAIL_COLUMNS.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align })), rows: stops.rows },
      {
        key: 'events', heading: 'What happened',
        columns: EVENT_COLUMNS,
        rows: (j.events ?? []).map(e => ({ key: e.id ?? `${e.type}${e.occurredAt}`, at: dt(e.occurredAt), what: eventLabel(e), message: String(e.message ?? '').replace(/−/g, '-') })),
      },
    ],
  }
}
