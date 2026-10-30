/**
 * What the server's alert engine raised â€” the real-mode source for the header
 * bell and the Notifications page.
 *
 * â”€â”€ Shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * One module-level store, like session.js and fleetScope.js: the bell and the
 * page read the same list, so marking an event read in one is instantly true in
 * the other, and navigating between pages does not re-fetch anything.
 *
 *   events       newest first; the latest page plus any older pages loaded
 *   unreadCount  across the account's whole history, not just what is loaded
 *
 * â”€â”€ Polling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * useAlertEventsLoader() (mounted once by App) fetches the newest page every
 * POLL_MS while a real session is READY, and again whenever the tab comes back
 * into view. Refreshing replaces the newest page and keeps the older pages
 * that "Load more" brought in, so a poll never collapses a long scrolled list.
 *
 * â”€â”€ Read state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Marking read is optimistic, then confirmed by a fresh fetch. A poll that was
 * already in flight when the user clicked would land with the old readAt values
 * and un-read the row for 30 seconds, so every response is tagged with the
 * write generation it started under and dropped if a mark-read happened since.
 *
 * Mock mode never touches this module: nothing calls it unless IS_REAL.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { IS_REAL } from './mode.js'
import { request } from './http.js'
import { PHASE, useSession } from './session.js'
import { sendPushNotification } from '../services/pushNotifications'

export const PAGE_SIZE = 50
const POLL_MS = 30_000
/** At most this many desktop notifications per poll; more become one summary. */
const MAX_PUSH = 3

const EMPTY = Object.freeze({
  events: [],
  unreadCount: 0,
  loaded: false,
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null,
})

let state = EMPTY
let generation = 0
/** Ids already seen by this tab, so a desktop notification fires once per event. */
let seen = new Set()
/** False until the first successful fetch, which only records a baseline. */
let baselined = false

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

export function useAlertEvents() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const byNewest = (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)

/**
 * Desktop notifications for events this tab has not seen before.
 *
 * The first load only records a baseline: a backlog of yesterday's alerts is
 * not news, and announcing fifty of them on sign-in would be noise. These are
 * what the browser rule engine used to send; in real mode that engine is
 * silent (see hooks/useNotificationEngine.js) and the server is the source.
 */
function announce(fresh, isFirst) {
  const unseen = fresh.filter(e => !seen.has(e.id))
  unseen.forEach(e => seen.add(e.id))
  if (isFirst) return
  const news = unseen.filter(e => !e.readAt)
  if (!news.length) return
  if (news.length > MAX_PUSH) {
    sendPushNotification(`${news.length} new alerts`, {
      body: news.slice(0, MAX_PUSH).map(e => e.title).join(' Â· '),
      tag: 'fleetmax-alerts',
      severity: news.some(e => e.severity === 'Critical') ? 'critical' : 'warning',
    })
    return
  }
  news.forEach(e => sendPushNotification(e.title, {
    body: e.message,
    tag: `alert-${e.id}`,
    severity: e.severity === 'Critical' ? 'critical' : 'warning',
  }))
}

/** Fetch the newest page and merge it over what is loaded. */
export async function refreshAlertEvents() {
  if (!IS_REAL) return
  const gen = generation
  setState({ loading: true })
  try {
    // unwrap: false â€” `unreadCount` rides beside `data`.
    const payload = await request('/api/alert-events', { query: { limit: PAGE_SIZE }, unwrap: false })
    if (gen !== generation) return
    const fresh = Array.isArray(payload?.data) ? payload.data : []
    const oldest = fresh.length ? Date.parse(fresh[fresh.length - 1].occurredAt) : Infinity
    // Older pages already loaded with "Load more" survive the refresh.
    const kept = fresh.length === PAGE_SIZE
      ? state.events.filter(e => Date.parse(e.occurredAt) < oldest)
      : []
    announce(fresh, !baselined)
    baselined = true
    setState({
      events: [...fresh, ...kept].sort(byNewest),
      unreadCount: Number(payload?.unreadCount) || 0,
      loaded: true,
      loading: false,
      hasMore: kept.length ? state.hasMore : fresh.length === PAGE_SIZE,
      error: null,
    })
  } catch (err) {
    // The list on screen stays; the next poll tries again.
    if (gen === generation) setState({ loading: false, loaded: true, error: err })
  }
}

/** Append the page before the oldest loaded event. */
export async function loadOlderAlertEvents() {
  if (!IS_REAL || state.loadingMore || !state.events.length) return
  const gen = generation
  const before = state.events[state.events.length - 1].occurredAt
  setState({ loadingMore: true })
  try {
    const older = await request('/api/alert-events', { query: { limit: PAGE_SIZE, before } })
    if (gen !== generation) return setState({ loadingMore: false })
    const list = Array.isArray(older) ? older : []
    const have = new Set(state.events.map(e => e.id))
    list.forEach(e => seen.add(e.id))
    setState({
      events: [...state.events, ...list.filter(e => !have.has(e.id))].sort(byNewest),
      hasMore: list.length === PAGE_SIZE,
      loadingMore: false,
    })
  } catch (err) {
    setState({ loadingMore: false, error: err })
  }
}

async function postRead(body) {
  generation += 1
  try {
    await request('/api/alert-events/read', { method: 'POST', body })
  } finally {
    // Success or not, the server's own count is the one to show next.
    refreshAlertEvents()
  }
}

/** Mark some events read. Unknown or already-read ids are ignored. */
export function markAlertEventsRead(ids) {
  if (!IS_REAL) return Promise.resolve()
  const wanted = new Set(ids)
  const now = new Date().toISOString()
  let n = 0
  const events = state.events.map(e => {
    if (!wanted.has(e.id) || e.readAt) return e
    n += 1
    return { ...e, readAt: now }
  })
  if (!n) return Promise.resolve()
  setState({ events, unreadCount: Math.max(0, state.unreadCount - n) })
  return postRead({ ids: [...wanted] })
}

/** Mark everything read â€” including events older than what is loaded. */
export function markAllAlertEventsRead() {
  if (!IS_REAL) return Promise.resolve()
  const now = new Date().toISOString()
  setState({
    events: state.events.map(e => (e.readAt ? e : { ...e, readAt: now })),
    unreadCount: 0,
  })
  return postRead({})
}

export function clearAlertEvents() {
  generation += 1
  seen = new Set()
  baselined = false
  setState(EMPTY)
}

/**
 * Mounted once by App. Polls while a real session is READY and clears on
 * sign-out, so the next account never sees the previous one's alerts.
 *
 * Tied to READY rather than to having a token, for the reason
 * useFleetScopeLoader is: an account behind the change-password gate would get
 * a 428 on every poll.
 */
export function useAlertEventsLoader() {
  const session = useSession()
  const ready = session.phase === PHASE.READY
  const userId = session.user?.id ?? null

  useEffect(() => {
    if (!IS_REAL) return
    if (!ready) {
      clearAlertEvents()
      return
    }
    clearAlertEvents()
    refreshAlertEvents()
    const timer = setInterval(refreshAlertEvents, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAlertEvents()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ready, userId])
}
