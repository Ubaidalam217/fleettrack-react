import { useEffect, useMemo, useState } from 'react'
import { IS_REAL } from '../data/mode'
import { get as apiGet, request } from '../data/http'
import { reminderStatus } from '../data/reminders'
import { listExpenses } from '../data/expenses'
import { useAlerts } from '../data/settings'
import { getAll as getLocalNotifications } from '../services/notificationStore'
import { currentUaeMonth, lastElapsedDay, loadDaywiseMonth, uaeDayStart } from '../utils/daywise'
import { fetchTodayMessages } from '../utils/todayMessages'
import { tripsByVehicle } from '../utils/usageReports'
import {
  SAFETY_WEIGHTS, monthFigures, utilization, safetyScore, violationCounts, liveUptime, fleetScore,
  todayFigures, driveEfficiency, maintenanceFigures, expenseFigures, imeiSet, pctChange,
  ALERT_WEEK_MS, normalizeAlertEvents,
} from '../utils/dashboardStats'

/**
 * Everything the Dashboard's cards show beyond the live status, loaded once
 * for the whole fleet the account sees and cut to the Dashboard's vehicle
 * filter in memory (utils/dashboardStats.js says where each figure comes from).
 *
 * Flespi is on the free plan (50 MiB/min, account-wide), so nothing here reads
 * it per card:
 *   - the month is the Daywise reports' loadDaywiseMonth — the server's
 *     DailyUsage table in real mode, else the shared day cache the sign-in
 *     warm-up has usually filled already;
 *   - last month is asked of the server only (one small request); with no
 *     server, the comparisons that need it say so;
 *   - today is one fleet-wide read shared with Driver Info (todayMessages.js).
 * Server reads (alert events, reminders, expenses) are kept a few minutes.
 */

const REFRESH_MS = 5 * 60 * 1000
const TTL_MS = 5 * 60 * 1000
const cache = new Map() // key -> { at, promise }

function cached(key, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = load()
  cache.set(key, { at: Date.now(), promise })
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key) })
  return promise
}

const prevMonthOf = ({ year, month }) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })

/** Last month from the server, or null when it cannot answer all of it. */
function loadPrevMonth(prev) {
  if (!IS_REAL) return Promise.resolve(null)
  return cached(`prev|${prev.year}-${prev.month}`, async () => {
    const data = await apiGet('/api/reports/daywise', prev)
    if (!data || data.missingDays?.length) return null
    return new Map(data.devices.map(d => [d.deviceId, d]))
  })
}

/**
 * The counted violations from the start of last month to now, as
 * `{ ts, type, deviceId }`. Real mode asks the alert engine's history once per
 * counted type (a type filter keeps ignition on/off noise out of the 2000-row
 * cap); mock mode has only the browser engine's stored alerts.
 */
function loadViolations(fromTs) {
  if (!IS_REAL) {
    const items = getLocalNotifications()
      .filter(n => n.type === 'alert' && SAFETY_WEIGHTS[n.ruleId] != null && n.timestamp / 1000 >= fromTs)
      .map(n => ({ ts: n.timestamp / 1000, type: n.ruleId, deviceId: Number(n.vehicleId) }))
    return Promise.resolve(items)
  }
  return cached(`violations|${fromTs}`, async () => {
    const lists = await Promise.all(Object.keys(SAFETY_WEIGHTS).map(type =>
      request('/api/alert-events', { query: { type, limit: 2000, from: new Date(fromTs * 1000).toISOString() } })
        .catch(() => [])))
    return lists.flat().map(e => ({ ts: Date.parse(e.occurredAt) / 1000, type: e.type, deviceId: Number(e.deviceId) }))
  })
}

/**
 * The last 7 days of alert events, newest first, for Alerts Overview, Alert
 * Markers and AI Insights: one request, the same server list as the bell.
 * The server returns the newest rows up to the cap, so the last 24 h stay
 * whole even when a busy week is cut. Mock mode has no server: null, and those
 * cards keep the browser engine's list.
 */
const ALERT_EVENT_CAP = 2000
function loadAlertEvents() {
  if (!IS_REAL) return Promise.resolve(null)
  return cached('alertEvents', async () => {
    const from = new Date(Date.now() - ALERT_WEEK_MS).toISOString()
    const rows = await request('/api/alert-events', { query: { limit: ALERT_EVENT_CAP, from } })
    const list = Array.isArray(rows) ? rows : []
    return { rows: list, truncated: list.length >= ALERT_EVENT_CAP }
  })
}

const loadReminders = () => (IS_REAL ? cached('reminders', () => reminderStatus()) : Promise.resolve(null))

function loadExpenses(now) {
  if (!IS_REAL) return Promise.resolve(null)
  const start = new Date(Date.UTC(now.year, now.month - 6, 1)).toISOString().slice(0, 10)
  return cached(`expenses|${start}`, () => listExpenses({ from: start }))
}

const PENDING = Object.freeze({ value: undefined, error: null })

/**
 * One loader's result: `{ value, error }`, value undefined while loading.
 * `deps` decide what is loaded; `tick` only asks for a fresh copy, and the
 * previous value stays on screen meanwhile instead of flashing "loading".
 */
function useLoad(load, deps, tick = 0) {
  const [state, setState] = useState({ base: null, key: null, value: undefined, error: null })
  const base = deps.join('|')
  const key = `${base}#${tick}`
  useEffect(() => {
    if (deps.includes('')) return undefined
    let live = true
    load().then(
      value => { if (live) setState({ base, key, value, error: null }) },
      err => { if (live) setState(s => ({ base, key, value: s.base === base ? s.value ?? null : null, error: err?.message || 'Could not load' })) },
    )
    return () => { live = false }
    // `key` stands for deps and tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.base === base ? state : PENDING
}

/**
 * @param {object[]} allVehicles       the live feed's vehicles (the account's whole fleet)
 * @param {object[]} selectedVehicles  the Dashboard filter's vehicles
 */
export function useDashboardStats(allVehicles, selectedVehicles) {
  // A safety score needs something watching for violations: with no active
  // speeding / harsh-driving / idle rule, no events can exist, and 100 would
  // claim a clean record nobody measured.
  const rules = useAlerts()
  const watched = (rules ?? []).some(r => r.status === 'Active' && SAFETY_WEIGHTS[r.type] != null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const now = currentUaeMonth()
  const prev = prevMonthOf(now)
  const allIds = useMemo(() => (allVehicles ?? []).map(v => v.id).sort((a, b) => a - b), [allVehicles])
  const allKey = allIds.join(',')
  const monthKey = `${now.year}-${now.month}`
  const prevStart = uaeDayStart(prev.year, prev.month, 1)

  const month = useLoad(() => loadDaywiseMonth(allIds, now.year, now.month).then(r => r.derived), [allKey, monthKey], tick)
  const prevMonth = useLoad(() => loadPrevMonth(prev), [allKey, monthKey])
  const today = useLoad(() => fetchTodayMessages(allIds), [allKey], tick)
  const violations = useLoad(() => loadViolations(prevStart), [allKey, monthKey], tick)
  const reminders = useLoad(loadReminders, [allKey], tick)
  const alertEvents = useLoad(loadAlertEvents, [allKey], tick)
  const expenses = useLoad(() => loadExpenses(now), [allKey, monthKey])

  // Cutting today into trips is the costly step, so it runs when today's
  // messages change — not on every live update that re-renders the page.
  const todayTrips = useMemo(
    () => (today.value ? tripsByVehicle(today.value, allVehicles ?? [], { tzOffsetSec: -new Date().getTimezoneOffset() * 60 }) : null),
    // allVehicles only supplies names; the ids are allKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today.value, allKey],
  )

  return useMemo(() => {
    const selected = selectedVehicles ?? []
    const ids = selected.map(v => v.id)
    const idSet = new Set(ids)
    // The vehicle filter only narrows server records when it narrows anything.
    const imeis = selected.length < (allVehicles?.length ?? 0) ? imeiSet(selected) : null
    const elapsed = lastElapsedDay(now.year, now.month)
    const prevDays = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate()

    const cur = month.value ? monthFigures(month.value, ids, elapsed) : null
    const last = prevMonth.value ? monthFigures(prevMonth.value, ids, prevDays) : null
    const lastSamePeriod = prevMonth.value ? monthFigures(prevMonth.value, ids, Math.min(elapsed, prevDays)) : null

    const curStart = uaeDayStart(now.year, now.month, 1)
    const events = violations.value?.filter(e => idSet.has(e.deviceId)) ?? null
    const curEvents = events?.filter(e => e.ts >= curStart) ?? null
    const prevEvents = events?.filter(e => e.ts < curStart) ?? null

    const todayStats = todayTrips ? todayFigures(todayTrips, ids) : null

    const safety = watched && cur && curEvents ? safetyScore(curEvents, cur.totalKm) : null
    const safetyPrev = watched && last && prevEvents ? safetyScore(prevEvents, last.totalKm) : null
    const util = utilization(cur)
    const utilPrev = utilization(last)
    const uptime = liveUptime(selected)
    // Trackers that answered at all in the last 24 h (the radar's Response).
    const responded = liveUptime(selected, Date.now() / 1000, 24 * 3600)
    const maintenance = reminders.value ? maintenanceFigures(reminders.value, imeis) : null
    // Narrowed only when the filter narrows anything, like `imeis` above.
    const alertIds = imeis ? idSet : null
    const alerts = alertEvents.value
      ? { events: normalizeAlertEvents(alertEvents.value.rows, alertIds), truncated: alertEvents.value.truncated }
      : null

    return {
      loading: !!allKey && month.value === undefined,
      month: cur,
      monthError: month.error,
      lastMonth: last,
      lastMonthSamePeriod: lastSamePeriod,
      distanceChange: cur && lastSamePeriod ? pctChange(cur.totalKm, lastSamePeriod.totalKm) : null,
      today: todayStats,
      todayError: today.error,
      safety,
      safetyPrev,
      violations: curEvents ? violationCounts(curEvents) : null,
      safetyWatched: watched,
      utilization: util,
      utilizationPrev: utilPrev,
      uptime,
      responded,
      efficiency: driveEfficiency(todayStats),
      maintenance,
      // Real mode only (mock mode keeps the browser engine's list): undefined
      // while loading, null when the server could not be read.
      alerts: alertEvents.value === undefined ? undefined : alerts,
      alertsError: alertEvents.error,
      expenses: expenses.value ? expenseFigures(expenses.value, now, 6, imeis) : null,
      expensesError: expenses.error,
      // Month figures only, so this month and last month compare like for like
      // (uptime is a live reading with no history).
      score: fleetScore({ safety, utilization: util }),
      scorePrev: last ? fleetScore({ safety: safetyPrev, utilization: utilPrev }) : null,
      isReal: IS_REAL,
    }
    // now/prev follow monthKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, prevMonth, todayTrips, today.error, violations, reminders, alertEvents, expenses, selectedVehicles, allVehicles, allKey, monthKey, watched])
}
