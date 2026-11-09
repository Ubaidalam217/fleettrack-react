/**
 * Loading for the Charts page: the messages behind every chart, and the
 * alerts. Both are fetched for the WHOLE scoped fleet and filtered in memory, so
 * changing the BG / group / vehicle filter never fetches anything.
 *
 * Messages come from fetchDaywiseMonth — the Daywise reports' fetch — one month
 * at a time. It shares their day cache (IndexedDB for finished days, memory for
 * recent ones) and their in-flight requests, and the app's sign-in warm-up has
 * usually fetched the current month already. Months are loaded one after the
 * other, never together, so the page stays inside Flespi's per-minute limit.
 */

import { useEffect, useState } from 'react'
import { fetchDaywiseMonth } from '../../utils/daywise'
import { IS_REAL } from '../../data/mode'
import { fetchAlertEventsInRange } from '../../data/alertEvents'
import { getAll as getLocalNotifications } from '../../services/notificationStore'
import { accumulate, emptyStats, monthsCovering } from './chartsData'

/** A computed period is reused this long — the same as the reports' recent-day cache. */
const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 8
const statsCache = new Map() // key -> { at, promise }

function remember(cache, key, promise) {
  cache.set(key, { at: Date.now(), promise })
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key) })
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
  return promise
}

function cached(cache, key) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.at < TTL_MS ? hit.promise : null
}

function loadStats(ids, windows) {
  const key = `${ids.join(',')}|${windows.key}`
  const hit = cached(statsCache, key)
  if (hit) return hit
  const promise = (async () => {
    const stats = new Map(ids.map(id => [id, emptyStats(windows.days)]))
    let capped = false
    for (const { year, month } of monthsCovering(windows.prev.from, windows.cur.to)) {
      const res = await fetchDaywiseMonth(ids, year, month)
      if (res.capped) capped = true
      for (const [id, msgs] of res.byDevice) {
        const s = stats.get(id)
        if (s) accumulate(s, msgs, windows)
      }
    }
    return { stats, capped }
  })()
  return remember(statsCache, key, promise)
}

/**
 * Per-vehicle stats for both windows. The computation is not cancelled when
 * the page changes period or unmounts: it finishes into the cache, and the page
 * only stops listening — the same choice loadDaywiseMonth makes.
 */
export function useChartStats(ids, windows) {
  const idsKey = ids.join(',')
  const wKey = windows?.key ?? ''
  const [state, setState] = useState({ key: '', stats: null, capped: false, error: null })

  useEffect(() => {
    if (!idsKey || !windows) return undefined
    let live = true
    const key = `${idsKey}|${wKey}`
    loadStats(idsKey.split(',').map(Number), windows).then(
      ({ stats, capped }) => { if (live) setState({ key, stats, capped, error: null }) },
      () => {
        if (live) {
          setState({
            key, stats: null, capped: false,
            error: 'The chart data could not be loaded. Please try again in a minute.',
          })
        }
      },
    )
    return () => { live = false }
    // `windows` is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, wKey])

  const current = state.key === `${idsKey}|${wKey}`
  return {
    stats: current ? state.stats : null,
    capped: current && state.capped,
    error: current ? state.error : null,
    loading: !!idsKey && !!windows && !current,
  }
}

/**
 * Alerts in both windows, as `{ ts, type, deviceId }`.
 *
 * Real mode reads the server alert engine's history. Mock mode has no server
 * engine; its alerts are the ones the browser's own notification engine raised
 * and stored (the Notifications page shows the same list), keyed by rule.
 */
async function loadAlerts(ids, windows) {
  if (IS_REAL) {
    const { events, truncated } = await fetchAlertEventsInRange({
      fromTs: windows.prev.from, toTs: windows.cur.to, deviceIds: ids,
    })
    return {
      items: events.map(e => ({ ts: Date.parse(e.occurredAt) / 1000, type: e.type, deviceId: Number(e.deviceId) })),
      truncated,
    }
  }
  const items = getLocalNotifications()
    .filter(n => n.type === 'alert' && n.ruleId && Number.isFinite(n.timestamp))
    .map(n => ({ ts: n.timestamp / 1000, type: n.ruleId, deviceId: Number(n.vehicleId) }))
  return { items, truncated: false }
}

export function useChartAlerts(ids, windows) {
  const idsKey = ids.join(',')
  const wKey = windows?.key ?? ''
  const [state, setState] = useState({ key: '', items: null, truncated: false, error: false })

  useEffect(() => {
    if (!idsKey || !windows) return undefined
    let live = true
    const key = `${idsKey}|${wKey}`
    loadAlerts(idsKey.split(',').map(Number), windows).then(
      ({ items, truncated }) => { if (live) setState({ key, items, truncated, error: false }) },
      () => { if (live) setState({ key, items: null, truncated: false, error: true }) },
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, wKey])

  const current = state.key === `${idsKey}|${wKey}`
  return {
    items: current ? state.items : null,
    truncated: current && state.truncated,
    error: current && state.error,
    loading: !!idsKey && !!windows && !current,
  }
}
