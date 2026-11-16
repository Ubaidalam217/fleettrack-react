/**
 * Who a Flespi call is made for — the signed-in user whose request it serves,
 * or the server job that made it — so the Device Data Monitor can show which
 * source makes the most Flespi requests (client, 2026-11-16).
 *
 * Carried with AsyncLocalStorage rather than passed down by hand: a Flespi call
 * is made several layers below the route (lib/flespiGrant.js, lib/odometer.js…),
 * and threading a "source" argument through all of them would touch every one.
 * Whatever runs inside a request, or inside runAsJob(), sees its source here.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage()

/** { key, label } of the code running now; a plain "server" when nothing set one. */
export function currentSource() {
  return store.getStore() ?? { key: 'server', label: 'Server (other)' }
}

/** Run `fn` as a background job, e.g. runAsJob('alert-engine', 'Alert engine', tick). */
export function runAsJob(name, label, fn) {
  return store.run({ key: `job:${name}`, label }, fn)
}

/**
 * Express middleware: everything after it, in this request, is the signed-in
 * user's. Mounted after requireAuth, so req.user is set.
 */
export function tagUserSource(req, _res, next) {
  const u = req.user
  if (!u) return next()
  store.run({ key: `user:${u.id}`, label: u.email ?? u.id }, next)
}

/** The same for an unauthenticated route, under one fixed label. */
export function tagSource(key, label) {
  return (_req, _res, next) => store.run({ key, label }, next)
}
