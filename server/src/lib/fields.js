/**
 * Shared zod field builders.
 *
 * Mostly here for one rule: an HTML form submits a cleared input as "", and a
 * nullable foreign key stored as "" is a key that matches nothing and satisfies
 * no constraint. Every optional field below collapses "" to null at the edge, so
 * nothing downstream has to remember which of the two it is looking at.
 */

import { z } from 'zod'
import { normalizeEmail, normalizeImei } from './text.js'

/** Required, trimmed, non-empty. */
export const requiredText = (label, max = 200) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`)

/**
 * Optional free text: omitted, "", null and undefined all arrive as null.
 *
 * ── Why `.default(null)` and not a union with z.undefined() ──
 *
 * In Zod 4, `z.union([z.string(), z.undefined()]).transform(fn)` is a schema whose
 * key is still REQUIRED — the transform wraps the union into a pipe that reports
 * "expected nonoptional, received undefined" when the key is absent. Including
 * z.undefined() in the union only permits undefined as an explicit *value*; it
 * does not make the property optional. (Zod 3 behaved the other way, which is how
 * this reads as obviously fine.)
 *
 * `.default(null)` is what actually makes the key optional, and it has the better
 * output besides: an omitted key becomes `null` rather than `undefined`, so Prisma
 * writes NULL on a create and clears the column on an update instead of silently
 * leaving the previous value in place.
 *
 * Every optional helper below follows the same pattern for the same reason.
 */
export const optionalText = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform(v => {
      const s = String(v ?? '').trim()
      return s === '' ? null : s
    })
    .refine(v => v === null || v.length <= max, `Must be ${max} characters or fewer`)

/** Required email, lower-cased. */
export const requiredEmail = (label = 'Email') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .transform(normalizeEmail)
    .refine(v => z.string().email().safeParse(v).success, `${label} must be a valid email address`)

/** Optional email, lower-cased, "" → null. */
export const optionalEmail = () =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform(v => {
      const s = normalizeEmail(v)
      return s === '' ? null : s
    })
    .refine(
      v => v === null || z.string().email().safeParse(v).success,
      'Must be a valid email address'
    )

/** A nullable foreign key: omitted or "" → null. */
export const optionalId = () =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform(v => {
      const s = String(v ?? '').trim()
      return s === '' ? null : s
    })

/** A required foreign key. */
export const requiredId = label =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)

/**
 * IMEI. Stripped to digits, then length-checked.
 *
 * 15 digits is the IMEI standard, but the range is left at 10-20: the client's
 * Flespi account already carries identifiers that are not strictly conformant,
 * and rejecting a device that is demonstrably reporting would be the validation
 * being wrong rather than the data.
 */
export const imeiField = () =>
  z
    .string({ error: 'IMEI is required' })
    .transform(normalizeImei)
    .refine(v => v.length > 0, 'IMEI is required')
    .refine(v => /^\d{10,20}$/.test(v), 'IMEI must be 10-20 digits')

/** A list of ids, de-duped, with "" entries dropped. */
export const idList = () =>
  z
    .array(z.string())
    .default([])
    .transform(v => [...new Set(v.map(s => String(s).trim()).filter(Boolean))])

export const statusField = () => z.enum(['Active', 'Inactive']).default('Active')

/**
 * A boolean that is honest about strings.
 *
 * NOT z.coerce.boolean(), which is `Boolean(value)` and therefore parses the
 * string "false" as **true** — the single most dangerous coercion in a validation
 * layer, because the field it guards here decides whether an alert covers one
 * vehicle or the entire fleet. JSON clients send real booleans and would be fine
 * either way; a form-encoded or query-string caller would silently get the
 * opposite of what it asked for.
 */
export const booleanField = (fallback = false) =>
  z
    .union([z.boolean(), z.string(), z.null(), z.undefined()])
    .default(fallback)
    .transform(v => {
      if (typeof v === 'boolean') return v
      if (v === null || v === undefined) return fallback
      const s = v.trim().toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(s)) return true
      if (['false', '0', 'no', 'off', ''].includes(s)) return false
      return null // caught by the refine below
    })
    .refine(v => typeof v === 'boolean', 'Must be true or false')

/**
 * An opaque JSON blob (the sub-user tabs, an alert's notify flags).
 *
 * Deliberately not given a shape. These are the frontend's own state objects and
 * their contents change whenever a tab gains a control; a schema here would mean
 * a backend release for every one of those, to validate data the server never
 * branches on. Rejecting a non-object is the part that matters — it is what stops
 * a string or an array landing in a jsonb column that every reader expects to be
 * a map.
 */
export const jsonObject = () =>
  z
    .union([z.record(z.string(), z.unknown()), z.null()])
    // .default(null) for the same reason as optionalText — see the note there.
    // Without it every sub-user tab blob would be mandatory on every create.
    .default(null)
    .transform(v => (v === undefined ? null : v))

/**
 * Same, for the tabs that are arrays rather than maps.
 *
 * `z.unknown()` alone does NOT make the key optional in Zod 4 (it did in Zod 3):
 * `z.object({ x: z.unknown() }).safeParse({})` fails.
 */
export const jsonValue = () =>
  z
    .unknown()
    .default(null)
    .transform(v => (v === undefined ? null : v))

/** A temperature bound in °C. "" → null, so a one-sided rule is expressible. */
export const optionalNumber = () =>
  z
    .union([z.number(), z.string(), z.null()])
    .default(null)
    .transform(v => {
      if (v === null || v === undefined) return null
      if (typeof v === 'number') return Number.isFinite(v) ? v : null
      const s = v.trim()
      if (s === '') return null
      const n = Number(s)
      return Number.isFinite(n) ? n : NaN
    })
    .refine(v => v === null || Number.isFinite(v), 'Must be a number')
