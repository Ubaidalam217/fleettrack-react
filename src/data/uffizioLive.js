/**
 * The Uffizio vehicles' live rows (GET /api/live/uffizio), shared by every
 * caller of useUffizioLive(): one request a minute for the whole list while
 * any page needs it, none while the tab is hidden. The server's own data
 * moves every ~2 minutes (the Uffizio poll), so a minute is plenty.
 *
 * Real mode only: mock / demo mode has no Uffizio feed and gets [].
 */

import { useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { request } from './http.js'
import { getToken } from './session.js'
import { normalizeMaster } from '../services/vehicleMaster'
import { uffizioToLive } from '../utils/uffizioLive'

const POLL_MS = 60_000
const RETRY_MS = 3 * 60_000
const GRACE_MS = 300

let snapshot = { vehicles: [], loaded: false, error: null }
const listeners = new Set()
let refCount = 0
let timer = null
let teardown = null
let running = false

function publish(patch) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(l => l())
}

function schedule(ms) {
  if (timer) clearTimeout(timer)
  timer = running ? setTimeout(pollOnce, ms) : null
}

async function pollOnce() {
  timer = null
  if (!running) return
  if (typeof document !== 'undefined' && document.hidden) return schedule(POLL_MS)
  if (!getToken()) return schedule(POLL_MS)
  try {
    const rows = await request('/api/live/uffizio')
    const base = normalizeMaster(null)
    const now = Date.now() / 1000
    publish({ vehicles: (Array.isArray(rows) ? rows : []).map(r => uffizioToLive(r, base, now)), loaded: true, error: null })
    schedule(POLL_MS)
  } catch (err) {
    // An older server without the endpoint (404), or a network error: keep
    // what we had and try again later. Never blocks the Flespi vehicles.
    publish({ loaded: true, error: err?.message ?? String(err) })
    schedule(RETRY_MS)
  }
}

function onVisible() {
  if (running && typeof document !== 'undefined' && !document.hidden) schedule(0)
}

function subscribe(cb) {
  listeners.add(cb)
  refCount += 1
  if (teardown) { clearTimeout(teardown); teardown = null }
  if (IS_REAL && !running) {
    running = true
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    schedule(0)
  }
  return () => {
    listeners.delete(cb)
    refCount -= 1
    if (refCount === 0) {
      teardown = setTimeout(() => {
        if (refCount !== 0) return
        running = false
        if (timer) { clearTimeout(timer); timer = null }
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      }, GRACE_MS)
    }
  }
}

const getSnapshot = () => snapshot
const EMPTY = { vehicles: [], loaded: true, error: null }

/**
 * { vehicles, loaded, error } — the Uffizio vehicles in the live-store shape
 * (utils/uffizioLive.js). `enabled` false: nothing is fetched.
 */
export function useUffizioLive(enabled = true) {
  const snap = useSyncExternalStore(enabled ? subscribe : noopSubscribe, enabled ? getSnapshot : getEmpty)
  return snap
}
const noopSubscribe = () => () => {}
const getEmpty = () => EMPTY

/** Ask for a fresh read now (e.g. after the Uffizio card polled). */
export function refreshUffizioLive() {
  if (running) schedule(0)
}
