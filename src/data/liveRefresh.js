/**
 * Live refresh — how often the Live Map redraws from the live feed (client
 * requirement 14.6).
 *
 * "Live" (0) redraws on every tracker message, as the map always did. 10/30/60
 * hold the list, the markers and the status counts still and redraw them once
 * per tick — with the newest data the feed has by then, so nothing is lost,
 * only redrawn less often (useThrottledValue below). A vehicle reporting for
 * the first time, or joining the list, is shown at once rather than at the next
 * tick (vehiclesGained), so a freshly opened map does not sit on "No Data".
 *
 * Where it is kept: with the API, on the account itself (user.userSetting
 * .liveRefreshSec, saved by PUT /api/me/live-refresh), so it follows the user to
 * every browser. The demo build has no account to save to and keeps it in this
 * browser's localStorage instead.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { request } from './http.js'
import { useSession, refreshMe } from './session.js'

export const LIVE_REFRESH_OPTIONS = [
  { sec: 0,  label: 'Live',         note: 'Every update, as it arrives' },
  { sec: 10, label: 'Every 10 s',   note: 'Calmer map, near real time' },
  { sec: 30, label: 'Every 30 s',   note: 'Good for a wall screen' },
  { sec: 60, label: 'Every minute', note: 'Lightest on slow machines' },
]

const VALID = new Set(LIVE_REFRESH_OPTIONS.map(o => o.sec))
const KEY = 'fm.liveRefreshSec'

export const normalizeLiveRefresh = v => (VALID.has(Number(v)) ? Number(v) : 0)

/** The short form for the LIVE badge: null for Live, '30s' otherwise. */
export const liveRefreshTag = sec => (sec ? `${sec}s` : null)

// ── Demo build: this browser only ───────────────────────────────────────────

const listeners = new Set()

function readLocal() {
  try { return normalizeLiveRefresh(localStorage.getItem(KEY)) } catch { return 0 }
}

let local = readLocal()

const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getLocal = () => local

/** The signed-in user's setting, in seconds (0 = Live). */
export function useLiveRefreshSec() {
  const { user } = useSession()
  const stored = useSyncExternalStore(subscribe, getLocal, getLocal)
  return IS_REAL ? normalizeLiveRefresh(user?.userSetting?.liveRefreshSec) : stored
}

/** Saves the setting. Throws (an http.js error) if the server refuses it. */
export async function saveLiveRefreshSec(sec) {
  const value = normalizeLiveRefresh(sec)
  if (IS_REAL) {
    await request('/api/me/live-refresh', { method: 'PUT', body: { liveRefreshSec: value } })
    await refreshMe()
    return
  }
  local = value
  try { localStorage.setItem(KEY, String(value)) } catch { /* private window: this visit only */ }
  listeners.forEach(fn => fn())
}

const reported = list => list.reduce((n, v) => n + (v?.lastTs != null ? 1 : 0), 0)

/**
 * True when `next` holds a vehicle `prev` did not show: a new one in the list,
 * or one with its first report. Those are shown at once, not at the next tick.
 */
export function vehiclesGained(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false
  return next.length !== prev.length || reported(next) > reported(prev)
}

/**
 * `value`, redrawn at most once every `ms` milliseconds (0 = every change).
 *
 * Each tick shows whatever `value` is by then, so the newest data always wins
 * and nothing in between is lost to the screen for longer than one tick.
 * `urgent(shown, value)` returning true shows `value` straight away instead.
 */
export function useThrottledValue(value, ms, urgent = null) {
  const [shown, setShown] = useState(value)
  const latest = useRef(value)
  useEffect(() => { latest.current = value })

  useEffect(() => {
    if (!ms) return
    setShown(latest.current)
    const t = setInterval(() => setShown(latest.current), ms)
    return () => clearInterval(t)
  }, [ms])

  if (!ms) return value
  if (value !== shown && urgent?.(shown, value)) {
    setShown(value)
    return value
  }
  return shown
}
