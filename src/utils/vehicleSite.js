/**
 * A vehicle's Site (client, 2026-11-13): typed in the vehicle's Parameters and
 * shown in the reports' Site column. Kept as the vehicle custom field named
 * "Site", on the custom-fields endpoint, so setting it never touches the
 * Flespi device.
 */

import { branchNameFor } from '../data/settings'

export const SITE_FIELD = 'Site'
export const MAX_SITE = 80

const isSite = f => String(f?.name ?? '').trim().toLowerCase() === 'site'

/** The Site typed for the vehicle, '' when none. */
export function siteField(customFields) {
  const hit = (customFields ?? []).find(isSite)
  return String(hit?.value ?? '').trim()
}

/**
 * The custom fields with Site set to `site`, in its old place when there was
 * one; a blank `site` removes it. The other fields are left as they are.
 */
export function withSite(customFields, site) {
  const value = String(site ?? '').trim().slice(0, MAX_SITE)
  const rows = (customFields ?? []).map(f => ({ name: String(f.name ?? ''), value: String(f.value ?? '') }))
  const at = rows.findIndex(isSite)
  if (!value) return at < 0 ? rows : rows.filter((_, i) => i !== at)
  if (at < 0) return [...rows, { name: SITE_FIELD, value }]
  rows[at] = { name: rows[at].name.trim() || SITE_FIELD, value }
  return rows
}

/**
 * The reports' Site: the vehicle's own Site when set, else the name of its
 * branch, else ''. A vehicle with no branch (the BG is its branch) has no Site.
 * @param {object|null} vehicle  a Settings vehicle row (customFields, branchId)
 * @param {(branchId: string) => string} [branchName]
 */
export function siteOf(vehicle, branchName = branchNameFor) {
  if (!vehicle) return ''
  const own = siteField(vehicle.customFields)
  if (own) return own
  const branch = vehicle.branchId ? String(branchName(vehicle.branchId) ?? '').trim() : ''
  return branch === '—' ? '' : branch
}
