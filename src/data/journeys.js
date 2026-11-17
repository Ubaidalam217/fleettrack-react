/**
 * Journey Management (client 2026-11-13/16/17) — the API calls and the
 * labels the screens share. Server only: routes/journeys.js,
 * routeTemplates.js, journeySettings.js.
 */

import { get, post, put, del, request } from './http.js'
import { API_URL } from './mode.js'
import { getToken } from './session.js'

export const listJourneys = (query = {}) => request('/api/journeys', { query, unwrap: false })
export const journeyApprovals = () => request('/api/journeys/approvals', { unwrap: false })
export const journeyOptions = (query = {}) => get('/api/journeys/options', query)
export const journeyAvailability = query => get('/api/journeys/availability', query)
export const routeFromTrip = query => get('/api/journeys/route-from-trip', query)
export const getJourney = id => get(`/api/journeys/${id}`)
export const createJourney = body => request('/api/journeys', { method: 'POST', body, unwrap: false })
export const updateJourney = (id, body) => request(`/api/journeys/${id}`, { method: 'PUT', body, unwrap: false })
export const submitJourney = id => post(`/api/journeys/${id}/submit`)
export const approveJourney = id => post(`/api/journeys/${id}/approve`)
export const rejectJourney = (id, reason) => post(`/api/journeys/${id}/reject`, { reason })
export const cancelJourney = (id, reason) => post(`/api/journeys/${id}/cancel`, { reason })
export const deleteJourney = id => del(`/api/journeys/${id}`)
export const addJourneyNote = (id, text) => post(`/api/journeys/${id}/notes`, { text })
export const signStop = (id, seq, body) => post(`/api/journeys/${id}/stops/${seq}/signature`, body)

export const listRouteTemplates = () => get('/api/route-templates')
export const saveRouteTemplate = body => post('/api/route-templates', body)
export const deleteRouteTemplate = id => del(`/api/route-templates/${id}`)

export const getJourneySettings = (query = {}) => get('/api/journey-settings', query)
export const saveJourneySettings = body => put('/api/journey-settings', body)

/** A stop's signature image as an object URL (the endpoint needs the login token). */
export async function signatureUrl(id, seq) {
  const res = await fetch(`${API_URL}/api/journeys/${id}/stops/${seq}/signature`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) return null
  return URL.createObjectURL(await res.blob())
}

/**
 * Shown states (displayStatus in utils/journeySchedule.js), with their tone:
 * a token in .jms-theme (pages/journeys/jms.css) — semantic colours only as
 * small pills and dots, per the client's 2026-11-17 theme.
 */
export const STATUS_META = Object.freeze({
  Draft:       { label: 'Draft',            tone: 'muted' },
  Pending:     { label: 'Pending approval', tone: 'violet' },
  Rejected:    { label: 'Rejected',         tone: 'bad' },
  Scheduled:   { label: 'Scheduled',        tone: 'info' },
  Started:     { label: 'Started',          tone: 'ok' },
  InProgress:  { label: 'In progress',      tone: 'ok' },
  Delayed:     { label: 'Delayed',          tone: 'warn' },
  Interrupted: { label: 'No signal',        tone: 'bad' },
  Completed:   { label: 'Completed',        tone: 'done' },
  Cancelled:   { label: 'Cancelled',        tone: 'muted' },
})

export const TIMING_META = Object.freeze({
  EARLY:   { label: 'Early',   tone: 'info' },
  ON_TIME: { label: 'On time', tone: 'ok' },
  LATE:    { label: 'Late',    tone: 'bad' },
})

export const EVENT_LABEL = Object.freeze({
  STATUS: 'Status', SUBMITTED: 'Sent for HSE approval', APPROVED: 'Approved by HSE', REJECTED: 'Rejected by HSE',
  CANCELLED: 'Cancelled', NOTE: 'Note', SIGNATURE: 'Signed',
  DEPART_EARLY: 'Early departure', DEPART_ON_TIME: 'On-time departure', DEPART_LATE: 'Late departure',
  ARRIVE_EARLY: 'Early arrival', ARRIVE_ON_TIME: 'On-time arrival', ARRIVE_LATE: 'Late arrival',
  NOT_DEPARTED: 'Not departed', DELAYED: 'Running late', OFF_ROUTE: 'Off route', UNPLANNED_STOP: 'Unplanned stop',
  SKIPPED_STOP: 'Stop missed', NO_SIGNAL: 'No signal', SIGNAL_BACK: 'Signal back',
  BREAK_DUE: 'Break due (HSE)', DAILY_LIMIT: 'Daily driving limit (HSE)',
})

/** The tone of an event on the timeline. */
export function eventTone(type) {
  if (/_LATE$|OFF_ROUTE|NO_SIGNAL|REJECTED|DAILY_LIMIT|NOT_DEPARTED|SKIPPED/.test(type)) return 'bad'
  if (/DELAYED|UNPLANNED|BREAK_DUE/.test(type)) return 'warn'
  if (/_EARLY$/.test(type)) return 'info'
  if (/_ON_TIME$|APPROVED|SIGNATURE|SIGNAL_BACK/.test(type)) return 'ok'
  return 'muted'
}

const UAE_MS = 4 * 3600 * 1000
/** "10:05" in UAE time. */
export const hhmm = v => (v ? new Date(new Date(v).getTime() + UAE_MS).toISOString().slice(11, 16) : '—')
/** "Tue 18 Nov · 10:05" in UAE time. */
export function dayTime(v) {
  if (!v) return '—'
  const d = new Date(new Date(v).getTime() + UAE_MS)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${wd} ${d.getUTCDate()} ${mo} · ${d.toISOString().slice(11, 16)}`
}
/** "2 h 40 min" */
export function duration(min) {
  if (min == null || !Number.isFinite(min)) return '—'
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
}
/** ISO ↔ the value of an <input type="datetime-local">, in UAE time. */
export const toLocalInput = v => (v ? new Date(new Date(v).getTime() + UAE_MS).toISOString().slice(0, 16) : '')
export const fromLocalInput = s => (s ? new Date(Date.parse(`${s}:00Z`) - UAE_MS).toISOString() : null)

/** The UAE date 'YYYY-MM-DD' of today + offsetDays. */
export const uaeDate = (offsetDays = 0) => new Date(Date.now() + UAE_MS + offsetDays * 86_400_000).toISOString().slice(0, 10)
/** A UAE date 'YYYY-MM-DD' as [from, to) ISO strings. */
export function dayRange(date) {
  const start = Date.parse(`${date}T00:00:00Z`) - UAE_MS
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()]
}

/** Today in the UAE as [from, to) ISO strings. */
export function uaeDay(offsetDays = 0) {
  const d = new Date(Date.now() + UAE_MS)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays) - UAE_MS
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()]
}

/** "A", "1", "2", "B" — the letter or number a stop shows on the map and the lists. */
export const stopMark = (i, n) => (i === 0 ? 'A' : i === n - 1 ? 'B' : String(i))
