/**
 * Vehicle types (client, 2026-11-13): the built-in list plus the client's own.
 * "Other (custom)…" in the type select opens a text box for the name; a name
 * any visible vehicle already uses is offered from then on, so every vehicle
 * spells "Tanker" the same way. Built-ins keep their lowercase keys (the map
 * marker art is keyed on them); a custom type is stored as typed.
 */

import { VEHICLE_TYPES } from '../services/vehicleMaster'

/** The select value that opens the custom name box. Never stored. */
export const OTHER_TYPE = '__other__'

export const MAX_CUSTOM_TYPE = 40

/** Trimmed, inner spaces collapsed, at most MAX_CUSTOM_TYPE characters. */
export const cleanVehicleType = t => String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_CUSTOM_TYPE)

const keyOf = t => cleanVehicleType(t).toLowerCase()

/** What a type reads as: built-ins capitalised, custom ones as typed, '' when not set. */
export function vehicleTypeLabel(t) {
  const clean = cleanVehicleType(t)
  if (!clean) return ''
  return VEHICLE_TYPES.includes(clean) ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean
}

/**
 * The type select's values: the built-ins ('' first), then every other type in
 * `used`, once each ignoring case (first spelling wins), sorted by name.
 * @param {string[]} used  types already set on the vehicles the user can see
 */
export function vehicleTypeOptions(used = []) {
  const seen = new Set(VEHICLE_TYPES.map(keyOf))
  const custom = []
  for (const t of used) {
    const clean = cleanVehicleType(t)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    custom.push(clean)
  }
  return [...VEHICLE_TYPES, ...custom.sort((a, b) => a.localeCompare(b))]
}

/**
 * A typed name as it will be stored: the existing option's spelling when it
 * matches one ignoring case ("CAR" → "car", so the car marker art still applies),
 * otherwise the cleaned name.
 */
export function canonicalVehicleType(t, options = VEHICLE_TYPES) {
  const key = keyOf(t)
  if (!key) return ''
  return options.find(o => keyOf(o) === key) ?? cleanVehicleType(t)
}
