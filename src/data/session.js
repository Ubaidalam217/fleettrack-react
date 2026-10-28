/**
 * Who is signed in, in real mode. The token lives here and nowhere else.
 *
 * ── Where the token is kept, and why ────────────────────────────────────────
 *
 * A module variable, mirrored into sessionStorage.
 *
 *  - A module variable is what every request reads, so the common path never
 *    touches storage.
 *  - sessionStorage rather than localStorage: it is cleared when the tab closes,
 *    so a 12-hour token is not left behind on a shared or kiosk machine, and it
 *    is per-tab, so one tab signing out cannot yank the session out from under
 *    another tab mid-request.
 *  - The mirror exists so a page refresh does not force a re-login, which during
 *    development means a reload every time Vite hot-restarts.
 *
 * This is NOT XSS-proof — any script on the page can read sessionStorage. The
 * real fix is an httpOnly, SameSite cookie issued by the API, which needs a
 * same-site deployment to be workable; that lands with the DigitalOcean deploy in
 * Phase 5. Until then this is the honest trade-off and it is written down rather
 * than assumed.
 */

import { useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { configureHttp, request } from './http.js'

/**
 * The auth endpoints answer with their fields at the top level — { token, user,
 * mustChangePassword } — not wrapped in { data }. They are therefore read with
 * unwrap: false, explicitly, rather than relying on request()'s fallback for a
 * payload that happens to have no `data` key. That fallback is real, but depending
 * on it means adding a `data` field to a response later would silently return the
 * wrong object here.
 */
const authPost = (path, body) => request(path, { method: 'POST', body, unwrap: false })
const authGet = path => request(path, { unwrap: false })

const TOKEN_KEY = 'fleetmax.token'
const USER_KEY = 'fleetmax.user'

/**
 * Session phases. `mustChangePassword` is a phase rather than a flag on the user
 * because it changes which screen the whole app renders, and a boolean read from
 * two places is how a user ends up seeing the dashboard behind the gate.
 */
export const PHASE = Object.freeze({
  LOADING: 'loading',
  ANON: 'anon',
  MUST_CHANGE_PASSWORD: 'must-change-password',
  READY: 'ready',
})

let state = {
  phase: IS_REAL ? PHASE.LOADING : PHASE.READY,
  token: null,
  user: null,
  /** Set when a session ends because the server rejected it, not by a click. */
  expiredNotice: null,
}

const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = () => state

/** Read the whole session. Re-renders on any change. */
export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const getToken = () => state.token
export const getUser = () => state.user

// ── Storage ─────────────────────────────────────────────────────────────────

function readStored() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY)
    const user = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null')
    return token ? { token, user } : null
  } catch {
    // Private mode or a locked-down browser: no stored session is a valid answer.
    return null
  }
}

function writeStored(token, user) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(USER_KEY, JSON.stringify(user ?? null))
  } catch {
    /* in-memory session still works for this tab */
  }
}

function clearStored() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
  } catch {
    /* nothing to clear */
  }
}

// ── Transitions ─────────────────────────────────────────────────────────────

function phaseFor(user) {
  return user?.mustChangePassword ? PHASE.MUST_CHANGE_PASSWORD : PHASE.READY
}

/**
 * Drop the session.
 *
 * `notice` is only set when the server ended it (a 401), so the login screen can
 * say "your session expired" instead of appearing for no reason. A deliberate
 * sign-out passes nothing.
 */
export function logout(notice = null) {
  clearStored()
  setState({ phase: PHASE.ANON, token: null, user: null, expiredNotice: notice })
}

export async function login(email, password) {
  const data = await authPost('/api/auth/login', { email, password })
  // The token has to be live before any follow-up call, and setState is what the
  // http layer's getToken() reads.
  writeStored(data.token, data.user)
  setState({
    phase: phaseFor(data.user),
    token: data.token,
    user: data.user,
    expiredNotice: null,
  })
  return data.user
}

export async function changePassword(currentPassword, newPassword) {
  const data = await authPost('/api/auth/change-password', { currentPassword, newPassword })
  // The response carries a fresh token: the old one's payload still claims
  // mustChangePassword, and keeping it would leave a stale copy of the profile
  // in play for the rest of the session.
  writeStored(data.token, data.user)
  setState({ phase: PHASE.READY, token: data.token, user: data.user, expiredNotice: null })
  return data.user
}

/** Re-read the profile from the server — used on boot to validate a stored token. */
export async function refreshMe() {
  const data = await authGet('/api/auth/me')
  const user = { ...data.user, mustChangePassword: data.mustChangePassword }
  writeStored(state.token, user)
  setState({ phase: phaseFor(user), user })
  return user
}

/**
 * Restores a stored session on page load, or settles on ANON.
 *
 * Validates the token against /api/auth/me rather than trusting it: a token in
 * sessionStorage may be expired, or the account may have been deactivated or had
 * its role changed since. Booting straight into the app on an unverified token
 * means the first real request is the one that discovers the problem, which shows
 * up as a dashboard that flashes and then bounces to login.
 */
export async function restore() {
  if (!IS_REAL) return
  const stored = readStored()
  if (!stored) {
    setState({ phase: PHASE.ANON })
    return
  }

  setState({ token: stored.token, user: stored.user })
  try {
    await refreshMe()
  } catch (err) {
    // 428 is not a failure — the gate handler has already moved the phase, and
    // the stored session is good. Anything else means the token is unusable.
    if (err?.status !== 428) logout()
  }
}

// ── Wire the http layer ─────────────────────────────────────────────────────
// Done here, at import time, so no component has to remember to do it. http.js
// holds only the callbacks, which is what keeps the two modules acyclic.

configureHttp({
  getToken: () => state.token,
  onUnauthorized: () => {
    // Guard against a stampede: a page firing six parallel requests on a dead
    // token would otherwise call this six times and clear an already-clear
    // session, re-notifying every listener each time.
    if (state.phase !== PHASE.ANON) {
      logout('Your session has expired. Please sign in again.')
    }
  },
  onPasswordChangeRequired: () => {
    if (state.phase === PHASE.READY) setState({ phase: PHASE.MUST_CHANGE_PASSWORD })
  },
})

/**
 * The display shape the existing chrome expects.
 *
 * Header, Sidebar and the dashboard greeting all read `{ name, email, role }`
 * from services/authUser.js. Producing that shape here means those three
 * components need no knowledge of the API at all — see authUser.js, which routes
 * through this in real mode.
 */
export const ROLE_LABELS = Object.freeze({
  SUPER_ADMIN: 'Super Admin',
  GGB_ADMIN: 'GGB Admin',
  GROUP_ADMIN: 'Group Admin',
  BG_USER: 'BG User',
  SUB_USER: 'Sub User',
})

/** "ahmed.khan42@x.com" → "Ahmed Khan" — the same derivation authUser.js uses. */
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/\d+/g, '')
  const words = local.split(/[._-]+/).filter(Boolean)
  if (words.length === 0) return 'there'
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function displayProfile(user = state.user) {
  if (!user) return null
  return {
    email: user.email ?? '',
    // shortName is what the operator typed on the form; the email derivation is
    // the fallback for accounts created without one (the seeded Super Admin has
    // a shortName, a bare BG user may not).
    name: user.shortName?.trim() || nameFromEmail(user.email),
    role: ROLE_LABELS[user.role] ?? user.role ?? '',
    /** The raw enum, for permission checks. */
    roleKey: user.role ?? null,
    scope: user.scope ?? null,
  }
}
