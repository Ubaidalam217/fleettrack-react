/**
 * Client-side checks for an alert rule, one validator per type.
 *
 * Each mirrors cleanParams() / assertConsistent() in server/src/routes/alerts.js
 * — same ranges, same field keys — so the form catches what the server would
 * reject and puts the message under the same input the server's 400 names.
 * The server stays the authority; this is the fast path.
 *
 * Plain .js with no components, so Alerts.jsx stays Fast-Refresh friendly and
 * the rules can be tested without rendering anything.
 */

// '' is unset. Parsed apart from 0, which is a real temperature, and negatives
// are ordinary for a reefer — so neither falsiness nor a sign check will do.
export function toNum(v) {
  const s = String(v ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** An error message when `v` is not a number in [min, max], else null. */
function rangeError(v, min, max, unit) {
  const n = toNum(v)
  if (n === null) return 'Required'
  if (Number.isNaN(n)) return 'Must be a number'
  if (n < min || n > max) return `Between ${min} and ${max} ${unit}`
  return null
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function only(key, message) {
  return message ? { [key]: message } : {}
}

function validateTemperature(s) {
  const out = {}
  const min = toNum(s.minTemp)
  const max = toNum(s.maxTemp)

  if (Number.isNaN(min)) out.minTemp = 'Must be a number'
  if (Number.isNaN(max)) out.maxTemp = 'Must be a number'
  if (Object.keys(out).length) return out

  if (min === null && max === null) {
    out.minTemp = 'Set a minimum, a maximum, or both.'
  } else if (min !== null && max !== null && max < min) {
    out.maxTemp = 'Maximum must be greater than or equal to the minimum.'
  }
  return out
}

function validateGeofences(s) {
  if (s.allGeofences) return {}
  return (s.geofenceIds ?? []).length
    ? {}
    : { geofenceIds: 'Select at least one geofence, or tick All geofences.' }
}

function validateNight(s) {
  const out = {}
  if (!HHMM.test(s.from ?? '')) out.from = 'Enter a time'
  if (!HHMM.test(s.to ?? '')) out.to = 'Enter a time'
  if (!out.from && !out.to && s.from === s.to) out.to = 'Must differ from the start time'
  return { ...out, ...only('minSpeedKmh', rangeError(s.minSpeedKmh, 1, 200, 'km/h')) }
}

const VALIDATORS = {
  overspeed:      s => only('speedKmh', rangeError(s.speedKmh, 10, 300, 'km/h')),
  idle:           s => only('minutes', rangeError(s.minutes, 1, 1440, 'minutes')),
  offline:        s => only('minutes', rangeError(s.minutes, 1, 1440, 'minutes')),
  geofence_enter: validateGeofences,
  geofence_exit:  validateGeofences,
  temperature:    validateTemperature,
  night_driving:  validateNight,
  license_expiry: s => only('days', rangeError(s.days, 1, 365, 'days')),
}

/** { field: message } for the type's own settings; {} when they are fine. */
export function validateAlertSettings(type, settings) {
  return VALIDATORS[type]?.(settings ?? {}) ?? {}
}

// ── Email recipients ────────────────────────────────────────────────────────

/** Deliberately loose: the server's zod .email() is the real check. */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/

export const MAX_RECIPIENTS = 20

export const isEmail = v => EMAIL.test(String(v ?? '').trim())

/**
 * Splits typed text into recipients. Commas, semicolons, spaces and newlines
 * all separate, because addresses get pasted from mail clients in every one of
 * those forms. Returns the valid addresses (lower-cased, as the server stores
 * them) and whatever did not parse, so the input can keep the bad part.
 */
export function parseEmails(text) {
  const valid = []
  const invalid = []
  for (const part of String(text ?? '').split(/[\s,;]+/)) {
    if (!part) continue
    if (isEmail(part)) valid.push(part.toLowerCase())
    else invalid.push(part)
  }
  return { valid, invalid }
}
