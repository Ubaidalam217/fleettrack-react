import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTodayMessages } from '../utils/todayMessages'
import { fetchFleetMessages, isAbortError } from '../utils/replay'
import { fetchAlertEventsInRange } from '../data/alertEvents'
import {
  normalizeHeatOptions, heatRange, heatRangeProblem, heatVehicleIds, maxHeatDays,
  pickVehicles, joinMessages, eventsFor, presenceCells, eventCells, durationText, heatCaption,
} from '../utils/heatmap'

/**
 * The Live Map's heat map (client, 2026-11-12, corrected 2026-11-13: "Heatmap
 * is not report feature, its map feature and should show specific device data
 * if selected one and other vehicle and their data should hide").
 *
 * Holds the options (per user, in this browser), works out whose heat to draw
 * and loads it, keeping Flespi reads small:
 *
 *   today        the shared fleet-wide read (utils/todayMessages.js, cached
 *                five minutes, the Dashboard's too): choosing vehicles only
 *                filters it, so no request of its own
 *   past days    only the chosen vehicles, one request per day, kept an hour;
 *                capped in vehicle-days (utils/heatmap.js HEAT_VEHICLE_DAYS)
 *   events       our own server's alert events, no Flespi read at all
 *
 * Narrowing (all → one vehicle, a search, a status tab) never reads again: the
 * wider read already holds those vehicles.
 */

const REFRESH_MS = 5 * 60 * 1000
const PAST_TTL_MS = 60 * 60 * 1000
const EVENTS_TTL_MS = 60 * 1000
const MAX_CACHED = 6
/** Ticking several vehicles in a row is one read, not one per tick. */
const IDS_SETTLE_MS = 600
const HEAT_FIELDS = 'timestamp,position.latitude,position.longitude,position.speed,engine.ignition.status'

/** What the list and the caption call a vehicle: as the Live Map does. */
export const vehicleLabel = v => (v ? v.master?.plateNo || v.name || v.ident || `Device ${v.id}` : '')

const keyOf = ids => [...ids].sort((a, b) => a - b).join(',')
const splitIds = key => (key ? key.split(',').map(Number) : [])
const readStore = key => { try { return localStorage.getItem(key) } catch { return null } }
const writeStore = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private window */ } }
const loadOpts = key => {
  try { return normalizeHeatOptions(JSON.parse(readStore(key) || 'null')) } catch { return normalizeHeatOptions(null) }
}

// ── Reads, shared across mounts while fresh ──
const cache = new Map() // key -> { expiresAt, promise, settled, controller }

function remember(key, ttl, load) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit
  for (const [k, e] of cache) if (e.expiresAt <= now) cache.delete(k)
  // A handful of periods at most: a week of the fleet is tens of thousands of messages.
  while (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
  const entry = { expiresAt: now + ttl, settled: false, controller: new AbortController(), promise: null }
  entry.promise = load(entry.controller.signal).then(
    value => { entry.settled = true; return value },
    err => { entry.settled = true; if (cache.get(key) === entry) cache.delete(key); throw err },
  )
  cache.set(key, entry)
  return entry
}

/** Nobody waits for this read any more: stop it, unless it already came back (then it stays cached). */
function release(key, entry) {
  if (entry.settled) return
  entry.controller.abort()
  if (cache.get(key) === entry) cache.delete(key)
}

function useSettled(value, ms) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (settled === value) return
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms, settled])
  return settled
}

const truncatedIn = byDevice => [...byDevice.values()].some(e => e?.truncated)

/**
 * @param {object}   p
 * @param {string}   p.userId    whose saved options
 * @param {object[]} p.fleet     every vehicle on the account (the live feed)
 * @param {object[]} p.listed    the vehicles in the list and on the map now
 * @param {number|null} p.focusId the selected vehicle
 */
export function useLiveHeat({ userId, fleet, listed, focusId }) {
  const onKey = `fm.liveMap.heat.${userId}`
  const optKey = `fm.liveMap.heatOpts.${userId}`
  const [on, setOnState] = useState(() => readStore(onKey) === '1')
  const [opts, setOpts] = useState(() => loadOpts(optKey))
  // The session can name the user after the first render.
  const loadedFor = useRef(onKey)
  useEffect(() => {
    if (loadedFor.current === onKey) return
    loadedFor.current = onKey
    setOnState(readStore(onKey) === '1')
    setOpts(loadOpts(optKey))
  }, [onKey, optKey])

  // "Now", moved every few minutes while the heat is on: today keeps growing.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(new Date()), REFRESH_MS)
    return () => clearInterval(t)
  }, [on])

  const setOn = useCallback(value => {
    if (value) setNow(new Date())
    setOnState(value)
    writeStore(onKey, value ? '1' : '0')
  }, [onKey])
  const update = useCallback(patch => setOpts(prev => {
    const next = normalizeHeatOptions({ ...prev, ...patch })
    writeStore(optKey, JSON.stringify(next))
    return next
  }), [optKey])

  // ── Whose heat ──
  const fleetKey = keyOf(fleet.map(v => v.id))
  const listedKey = keyOf(listed.map(v => v.id))
  const fleetIds = useMemo(() => splitIds(fleetKey), [fleetKey])
  const listedIds = useMemo(() => splitIds(listedKey), [listedKey])
  const customKey = opts.customIds.join(',')
  const { ids, by } = useMemo(
    () => heatVehicleIds({ scope: opts.scope, customIds: splitIds(customKey), focusId, listedIds, knownIds: fleetIds }),
    [opts.scope, customKey, focusId, listedIds, fleetIds],
  )
  const idsKey = keyOf(ids)
  const loadIdsKey = useSettled(idsKey, IDS_SETTLE_MS)

  const labels = useMemo(() => new Map(fleet.map(v => [v.id, vehicleLabel(v)])), [fleet])
  const labelOf = useCallback(id => labels.get(id) ?? `Device ${id}`, [labels])

  // ── Which period ──
  const range = useMemo(() => heatRange(opts.period, { now, from: opts.from, to: opts.to }), [opts.period, opts.from, opts.to, now])
  const problem = on ? heatRangeProblem(range, { vehicleCount: ids.length, show: opts.show, now }) : null
  const kind = opts.show === 'events' ? 'events' : 'messages'
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const withToday = !!range && range.toTs >= todayStart
  // rangeId names the period; rangeKey also moves with "now" while it includes today.
  const rangeId = range ? `${kind}|${range.fromTs}|${withToday ? 'today' : range.toTs}` : null
  const rangeKey = range ? `${rangeId}|${withToday ? now.getTime() : ''}` : null
  const todayFleetKey = withToday && kind === 'messages' ? fleetKey : ''

  // ── Load ──
  const [load, setLoad] = useState({ status: 'idle', rangeId: null, data: null, error: null, progress: null })
  const loadedRef = useRef(null) // { rangeKey, covered: Set }
  useEffect(() => {
    if (!on || problem || !range) return
    const loadIds = splitIds(loadIdsKey)
    if (!loadIds.length) return
    const had = loadedRef.current
    // A wider read of the same period already holds these vehicles.
    if (had && had.rangeKey === rangeKey && loadIds.every(id => had.covered.has(id))) return

    let live = true
    const held = []
    setLoad(s => ({ ...s, status: 'loading', error: null, progress: null }))
    const onStatus = text => { if (live) setLoad(s => ({ ...s, progress: text })) }

    let promise
    if (kind === 'events') {
      const key = `ev|${range.fromTs}|${range.toTs}|${loadIdsKey}`
      const entry = remember(key, withToday ? EVENTS_TTL_MS : PAST_TTL_MS,
        () => fetchAlertEventsInRange({ fromTs: range.fromTs, toTs: range.toTs, deviceIds: loadIds }))
      held.push([key, entry])
      promise = entry.promise.then(r => ({ events: r.events, truncated: r.truncated, covered: new Set(loadIds) }))
    } else {
      const parts = []
      if (range.fromTs < todayStart) {
        const pastTo = Math.min(range.toTs, todayStart - 1)
        const key = `msg|${range.fromTs}|${pastTo}|${loadIdsKey}`
        const entry = remember(key, PAST_TTL_MS,
          signal => fetchFleetMessages(loadIds, range.fromTs, pastTo, { fields: HEAT_FIELDS, signal, onStatus }))
        held.push([key, entry])
        parts.push(entry.promise.then(m => ({ byVehicle: pickVehicles(m, loadIds), truncated: truncatedIn(m) })))
      }
      if (withToday) {
        const fleetNow = splitIds(todayFleetKey)
        parts.push(fetchTodayMessages(fleetNow).then(m => ({ byVehicle: pickVehicles(m, fleetNow), truncated: truncatedIn(m) })))
      }
      promise = Promise.all(parts).then(got => ({
        byVehicle: joinMessages(...got.map(g => g.byVehicle)),
        truncated: got.some(g => g.truncated),
        // Today alone is the whole fleet's read; past days hold only these vehicles.
        covered: new Set(range.fromTs < todayStart ? loadIds : splitIds(todayFleetKey)),
      }))
    }

    promise
      .then(data => {
        if (!live) return
        loadedRef.current = { rangeKey, covered: data.covered }
        setLoad({ status: 'ready', rangeId, data, error: null, progress: null })
      })
      .catch(err => {
        if (!live || isAbortError(err)) return
        setLoad(s => ({ ...s, status: 'error', error: err?.message || String(err), progress: null }))
      })
    return () => {
      live = false
      held.forEach(([key, entry]) => release(key, entry))
    }
  // range is read through rangeKey / rangeId (same numbers); kind / withToday are in them too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, problem, rangeKey, loadIdsKey, todayFleetKey])

  // ── What to draw ── (the view's sub-mode and the event kinds only re-colour)
  const typesKey = opts.types ? opts.types.join(',') : '*'
  const result = useMemo(() => {
    if (!on || problem || !load.data || load.rangeId !== rangeId) return null
    if (kind === 'events') {
      const kept = eventsFor(load.data.events, { ids, types: typesKey === '*' ? null : typesKey.split(',').filter(Boolean) })
      const r = eventCells(kept)
      return { cells: r.cells, total: r.total, totalText: `${r.total} event${r.total === 1 ? '' : 's'}`, unplaced: r.unplaced, truncated: load.data.truncated }
    }
    const mode = opts.show === 'stops' ? opts.stopMode : opts.presenceMode
    const r = presenceCells(pickVehicles(load.data.byVehicle, ids), { mode })
    return { cells: r.cells, total: r.totalSec, totalText: durationText(r.totalSec), unplaced: 0, truncated: load.data.truncated }
  }, [on, problem, load, rangeId, kind, ids, typesKey, opts.show, opts.stopMode, opts.presenceMode])

  const status = !on ? 'off'
    : problem ? 'problem'
      : !ids.length ? 'none'
        : result && load.status !== 'error' ? (load.status === 'loading' ? 'refreshing' : 'ready')
          : load.status === 'error' ? 'error' : 'loading'

  // ── The other vehicles hide while the heat is narrowed ── (an empty custom pick hides nothing yet)
  const narrowed = on && by !== 'all' && ids.length > 0
  const shown = useMemo(() => (narrowed ? new Set(ids) : null), [narrowed, ids])
  const showsMarker = useCallback(id => !shown || shown.has(id), [shown])

  const [fitTick, setFitTick] = useState(0)
  const requestFit = useCallback(() => setFitTick(n => n + 1), [])

  return {
    on, setOn, opts, update,
    ids, by, narrowed, showsMarker, labelOf, listedCount: listedIds.length,
    range, problem, maxDays: maxHeatDays(ids.length),
    status, error: load.error, progress: load.progress, result,
    caption: heatCaption({ ids, labelOf, ...opts }),
    fitTick, requestFit,
  }
}
