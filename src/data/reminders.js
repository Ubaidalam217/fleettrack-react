/**
 * Maintenance and renewal reminders (client, 2026-11-10, after the reference
 * system): Settings › Master › Reminder Rule, Reports › Reminder Status and
 * Acknowledgement History. Server only — routes/reminders.js.
 */

import { get, post, put, del } from './http.js'

/** Mirror of REMINDER_TYPES in server/src/lib/reminders.js; any other text is accepted too. */
export const REMINDER_TYPES = Object.freeze({
  Service: [
    'Oil Change', 'Oil Filter', 'Air Filter', 'Fuel Filter', 'Antifreeze', 'Coolant Flush', 'Battery',
    'Brakes Front', 'Brakes Rear', 'Tires Change', 'Tire Rotation', 'Transmission Service', 'Windshield Wipers',
    'Cleaning', 'Repair', 'General Service', '100k Service', 'Device SIM Card',
  ],
  Renewal: [
    'Insurance', 'Registration', 'Inspection', 'Road Tax', 'Vehicle License', 'Fitness Certificate',
    'Roadworthy Certificate', 'Tank Certificate', 'Speed Limit Certificate',
  ],
})
export const isRenewal = type => REMINDER_TYPES.Renewal.includes(type)

export const REMINDER_STATUS = Object.freeze({
  overdue:   { label: 'Overdue',   color: '#ef4444' },
  due:       { label: 'Due',       color: '#d97706' },
  upcoming:  { label: 'Upcoming',  color: '#0ea5e9' },
  completed: { label: 'Completed', color: '#16a34a' },
})

export const listReminderRules = (query = {}) => get('/api/reminder-rules', query)
export const addReminderRule = body => post('/api/reminder-rules', body)
export const updateReminderRule = (id, body) => put(`/api/reminder-rules/${id}`, body)
export const deleteReminderRule = id => del(`/api/reminder-rules/${id}`)

export const reminderStatus = (query = {}) => get('/api/reminders/status', query)
export const markReminderDone = body => post('/api/reminders/ack', body)
export const reminderHistory = (query = {}) => get('/api/reminders/acks', query)
/** { [vehicleId]: { odometer, engineHours } } now, from the tracker and the server's hour count. */
export const vehicleMeters = ids => get('/api/reminders/meters', { vehicleIds: ids.join(',') })

/** "Every 6 months", "Every 10,000 km", … for a rule, joined with " or ". */
export function ruleSummary(r) {
  const n = v => Number(v).toLocaleString('en-US')
  const parts = []
  if (r.byDuration && r.every) {
    if (!r.recurring) parts.push(`At ${n(r.every)} month${r.every === 1 ? '' : 's'}`)
    else {
      const unit = { Daily: 'day', Weekly: 'week', Monthly: 'month' }[r.frequency] ?? 'month'
      parts.push(`Every ${n(r.every)} ${unit}${r.every === 1 ? '' : 's'}`)
    }
  } else if (r.byDuration) parts.push('By expiry date')
  if (r.byDistance && r.everyKm) parts.push(`${r.recurring ? 'every' : 'at'} ${n(r.everyKm)} km`)
  if (r.byEngineHours && r.everyHours) parts.push(`${r.recurring ? 'every' : 'at'} ${n(r.everyHours)} engine h`)
  const s = parts.join(' or ')
  return s ? s[0].toUpperCase() + s.slice(1) : '—'
}
