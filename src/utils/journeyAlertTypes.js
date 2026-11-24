/**
 * Journey alerts in the bell and on the Notifications page (client
 * 2026-11-21): the server raises them as alert events of type
 * `journey_<event>` (server lib/journeys.js recordEvent) — no alert rule
 * behind them, so they need their own labels here.
 */

export const JOURNEY_ALERT_LABEL = Object.freeze({
  journey_submitted: 'Journey sent for approval',
  journey_approved: 'Journey approved',
  journey_rejected: 'Journey rejected',
  journey_depart_early: 'Journey: early departure',
  journey_depart_on_time: 'Journey: on-time departure',
  journey_depart_late: 'Journey: late departure',
  journey_arrive_early: 'Journey: early arrival',
  journey_arrive_on_time: 'Journey: on-time arrival',
  journey_arrive_late: 'Journey: late arrival',
  journey_not_departed: 'Journey: not departed',
  journey_delayed: 'Journey: running late',
  journey_off_route: 'Journey: off route',
  journey_unplanned_stop: 'Journey: unplanned stop',
  journey_skipped_stop: 'Journey: stop missed',
  journey_no_signal: 'Journey: no signal',
  journey_break_due: 'Journey: break due (HSE)',
  journey_daily_limit: 'Journey: daily driving limit (HSE)',
  journey_force_closed: 'Journey: force closed',
  journey_convoy_separated: 'Journey: convoy separated',
  journey_temp_out_of_range: 'Journey: temperature out of range',
})

export const isJourneyAlert = type => typeof type === 'string' && type.startsWith('journey_')

/** "Journey: late arrival", or a readable fallback for a type added later. */
export function journeyAlertLabel(type) {
  if (!isJourneyAlert(type)) return null
  return JOURNEY_ALERT_LABEL[type] ?? `Journey: ${type.slice(8).replace(/_/g, ' ')}`
}

/** Which family of icon a journey alert takes (alertStyle.js maps it to a lucide icon). */
export function journeyAlertKind(type) {
  if (!isJourneyAlert(type)) return null
  const t = type.slice(8)
  if (/submitted|approved|rejected/.test(t)) return 'approval'
  if (/off_route/.test(t)) return 'route'
  if (/no_signal/.test(t)) return 'signal'
  if (/break_due|daily_limit/.test(t)) return 'hse'
  if (/convoy/.test(t)) return 'convoy'
  if (/temp/.test(t)) return 'temperature'
  if (/unplanned_stop|skipped_stop/.test(t)) return 'stop'
  if (/force_closed/.test(t)) return 'closed'
  if (/depart|arrive|delayed|not_departed/.test(t)) return 'time'
  return 'journey'
}
