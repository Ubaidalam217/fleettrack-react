/**
 * The HTTP boundary. Every real-mode request goes through request().
 *
 * Responsibilities, all in one place so no caller has to remember them:
 *  - prefix the base URL and attach the bearer token
 *  - unwrap the backend's { data } / { error } envelope
 *  - turn a failure into an ApiError carrying status + per-field details
 *  - raise the two session-level conditions (401, 428) as app-wide signals
 */

import { API_URL } from './mode.js'

/**
 * A failed request, with everything a form needs to render it.
 *
 * `details` is the backend's { field: message } map — see middleware/errors.js on
 * the server. Carrying it on the error (rather than making callers re-read the
 * response) is what lets a page do `catch (e) { setErrors(e.details) }` and get
 * "Already in use" under the right input.
 */
export class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message || 'Request failed')
    this.name = 'ApiError'
    this.status = status
    this.details = details ?? null
    this.code = code ?? null
  }

  /** Not-found and out-of-scope are the same 404 — see the server's notFound(). */
  get isMissing() {
    return this.status === 404
  }

  get isForbidden() {
    return this.status === 403
  }

  /** Duplicate email / IMEI. */
  get isConflict() {
    return this.status === 409
  }
}

// ── Session signals ─────────────────────────────────────────────────────────
// http.js must not import session.js: session.js calls request() to log in, and
// the cycle would leave one of them half-initialised at module load. So the two
// session-level conditions are published as callbacks that session.js registers.
// That also keeps this module testable without a session at all.

let getToken = () => null
let onUnauthorized = () => {}
let onPasswordChangeRequired = () => {}

export function configureHttp(handlers) {
  if (handlers.getToken) getToken = handlers.getToken
  if (handlers.onUnauthorized) onUnauthorized = handlers.onUnauthorized
  if (handlers.onPasswordChangeRequired) onPasswordChangeRequired = handlers.onPasswordChangeRequired
}

/**
 * One API call.
 *
 * @param path    e.g. '/api/vehicles' — always starts with a slash
 * @param options { method, body, query, auth, unwrap }
 *                `auth: false`   for login, which has no token yet.
 *                `unwrap: false` to get the whole response envelope.
 *
 * ── On `unwrap` ─────────────────────────────────────────────────────────────
 *
 * By default this returns `payload.data`, because almost every endpoint answers
 * `{ data }` and every caller would otherwise write `.data` itself.
 *
 * But a few endpoints put meaningful fields BESIDE `data` — /api/me/vehicles
 * returns `{ data, count, role }`, and the `role` is what tells the Live Map
 * whether to apply a filter at all. Unwrapping silently discarded it, and the
 * symptom was a Super Admin seeing one vehicle instead of the whole account: the
 * role read as undefined, so the "no filter for a Super Admin" branch never ran.
 *
 * So the option is explicit at the call site rather than being inferred. A
 * convenience that quietly drops fields is only convenient until it isn't.
 */
export async function request(
  path,
  { method = 'GET', body, query, auth = true, unwrap = true } = {}
) {
  let url = `${API_URL}${path}`

  if (query) {
    // Undefined and '' are dropped rather than sent: `?bgId=` would reach the
    // server as an empty string and fail its min(1) validation, when what the
    // caller meant was "no filter".
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects on a network-level failure, and its own message is always
    // the useless "Failed to fetch" — so the original is deliberately discarded in
    // favour of one that names the actual likely cause.
    throw new ApiError(
      0,
      `Cannot reach the FleetmaX API at ${API_URL}. Is the server running?`,
      null,
      'NETWORK'
    )
  }

  // 204 and an empty body are both legitimate successes with nothing to parse.
  const text = await res.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (res.ok) {
    if (!unwrap) return payload
    return payload?.data !== undefined ? payload.data : payload
  }

  const error = payload?.error ?? {}
  const apiError = new ApiError(
    res.status,
    error.message || `${method} ${path} failed (${res.status})`,
    error.details,
    error.code
  )

  /**
   * 428 — the account is still on the password it was handed. Raised before 401
   * so the gate wins: an account in this state has a perfectly valid token and
   * bouncing it to the login screen would be a loop it could never escape.
   */
  if (res.status === 428 || error.code === 'PASSWORD_CHANGE_REQUIRED') {
    onPasswordChangeRequired()
    throw apiError
  }

  /**
   * 401 — no token, expired, or the account is gone. The session is dead, so
   * every caller gets bounced to login rather than each one handling it.
   *
   * 403 deliberately does NOT log out: it means "you are who you say you are and
   * you may not do this", which is an error to show in place, not a session
   * failure. Logging out on 403 would eject a sub-user from the app for clicking
   * a button they should not have been shown.
   */
  if (res.status === 401) {
    onUnauthorized()
  }

  throw apiError
}

export const get = (path, query) => request(path, { query })
export const post = (path, body) => request(path, { method: 'POST', body })
export const put = (path, body) => request(path, { method: 'PUT', body })
export const del = path => request(path, { method: 'DELETE' })

/**
 * The message to show a user for any thrown error.
 *
 * Centralised because a raw ApiError message is written for a developer in a few
 * cases, and because a non-ApiError (a bug in our own code) must not render as
 * "undefined" in a toast.
 */
export function errorMessage(err, fallback = 'Something went wrong') {
  if (err instanceof ApiError) return err.message
  if (err?.message) return err.message
  return fallback
}
