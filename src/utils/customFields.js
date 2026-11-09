/**
 * Vehicle custom fields (client, 2026-11-09): free name → value pairs kept
 * against a vehicle, shown from the Live Map's "Vehicle information".
 * The server applies the same rules (routes/vehicles.js).
 */

export const MAX_CUSTOM_FIELDS = 100
export const MAX_NAME = 80
export const MAX_VALUE = 1000

/** Row errors keyed `${index}.name` / `${index}.value`; {} when the rows can be saved. */
export function validateCustomFields(rows) {
  const errors = {}
  const seen = new Set()
  rows.forEach((r, i) => {
    const name = r.name.trim()
    const value = r.value.trim()
    if (!name && !value) return
    if (!name) { errors[`${i}.name`] = 'Give this field a name'; return }
    if (name.length > MAX_NAME) { errors[`${i}.name`] = `Up to ${MAX_NAME} characters`; return }
    if (value.length > MAX_VALUE) { errors[`${i}.value`] = `Up to ${MAX_VALUE} characters`; return }
    const key = name.toLowerCase()
    if (seen.has(key)) { errors[`${i}.name`] = 'This name is already used above'; return }
    seen.add(key)
  })
  return errors
}

/** The rows as they will be stored: trimmed, blank ones dropped. */
export const cleanCustomFields = rows => rows
  .map(r => ({ name: r.name.trim(), value: r.value.trim() }))
  .filter(r => r.name || r.value)

/**
 * Field names used on the fleet's vehicles, most used first — offered while
 * typing so every vehicle spells "Contract End Date" the same way.
 * @returns {{ name: string, count: number }[]}
 */
export function fieldNameSuggestions(vehicles) {
  const byKey = new Map()
  for (const v of vehicles) {
    for (const f of v.customFields ?? []) {
      const name = String(f.name ?? '').trim()
      if (!name) continue
      const key = name.toLowerCase()
      const hit = byKey.get(key)
      if (hit) hit.count += 1
      else byKey.set(key, { name, count: 1 })
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const URL = /https?:\/\/[^\s<>"']+/
const PHONE = /\+?\d[\d\s-]{5,}\d/
const PHONE_FIELD = /phone|mobile|tel\b|cell|whatsapp|contact no/i

/**
 * A value split into text and links: e-mails, web addresses, and phone
 * numbers — a number is only a phone when the field is called one or it starts
 * with "+", so a contract number never turns into a call link.
 * @returns {{ type: 'text'|'email'|'url'|'phone', text: string, href?: string }[]}
 */
export function valueParts(value, fieldName = '') {
  const parts = []
  const phoneOk = PHONE_FIELD.test(fieldName)
  const re = new RegExp(`(${EMAIL.source})|(${URL.source})|(${PHONE.source})`, 'g')
  let last = 0
  for (const m of String(value ?? '').matchAll(re)) {
    const [text, email, url, phone] = m
    const digits = phone ? phone.replace(/\D/g, '') : ''
    const isPhone = phone && digits.length >= 7 && digits.length <= 15 && (phoneOk || phone.startsWith('+'))
    if (!email && !url && !isPhone) continue
    if (m.index > last) parts.push({ type: 'text', text: value.slice(last, m.index) })
    if (email) parts.push({ type: 'email', text, href: `mailto:${text}` })
    else if (url) parts.push({ type: 'url', text, href: text })
    else parts.push({ type: 'phone', text, href: `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}` })
    last = m.index + text.length
  }
  if (last < String(value ?? '').length) parts.push({ type: 'text', text: String(value).slice(last) })
  return parts
}
