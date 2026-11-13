/**
 * The driver history the reports attribute past trips by (GET
 * /api/drivers/history; utils/driverHistory.js has the rule). Loaded with the
 * Settings data in real mode and again after every Settings write, so a
 * driver swapped, removed or given another tag shows in the next report.
 *
 * null means "no history": mock mode, a server older than the endpoint, or not
 * loaded yet. The reports then fall back to today's assignment, as before.
 */

import { useSyncExternalStore } from 'react'
import { createDriverHistory } from '../utils/driverHistory.js'

let current = null
const listeners = new Set()

/** Replace the history with a fresh payload ({ drivers, assignments, tags }), or null. */
export function setDriverHistory(payload) {
  current = payload ? createDriverHistory(payload) : null
  listeners.forEach(fn => fn())
}

/** The current lookup (utils/driverHistory.js createDriverHistory), or null. */
export const getDriverHistory = () => current

const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The history lookup, re-rendering when it is reloaded. */
export function useDriverHistory() {
  return useSyncExternalStore(subscribe, getDriverHistory, getDriverHistory)
}
