/**
 * The Live Map's attribute filters (client, 2026-11-06): "Add the Asset Type,
 * Asset Group, Device Type, Company and Branch, Validity against vehicle and
 * filter to filter these".
 *
 * What each one reads:
 *   Asset Type   the vehicle type set in Parameters (car, bus, truck…)
 *   Asset Group  the Settings vehicle's Sub Group
 *   Device Type  the Settings vehicle's Device Type
 *   Company      the BG the vehicle is registered under
 *   Branch       the Settings vehicle's branch
 *   Validity     the Settings vehicle's valid-until date
 *
 * A tracker not registered under Settings has none of these, so it only shows
 * while every Settings-side filter is on "All" (or on "Not set").
 */

import { cleanVehicleType, vehicleTypeLabel } from './vehicleTypes'

export const NOT_SET = '__none'

export const EMPTY_FILTERS = { assetType: '', assetGroup: '', deviceType: '', company: '', branch: '', validity: '' }

export const VALIDITY_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring in 30 days' },
  { value: 'expired', label: 'Expired' },
  { value: NOT_SET, label: 'Not set' },
]

const EXPIRING_DAYS = 30

/** "YYYY-MM-DD" against today (local): valid / expiring / expired, or NOT_SET. */
export function validityState(validUntil, now = new Date()) {
  if (!validUntil) return NOT_SET
  const [y, m, d] = String(validUntil).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return NOT_SET
  const end = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((end - today) / 86_400_000)
  if (days < 0) return 'expired'
  return days <= EXPIRING_DAYS ? 'expiring' : 'valid'
}

/**
 * One vehicle's filterable attributes.
 * @param {object} v        a Live Map vehicle (`v.master` from the device)
 * @param {object} profile  settingsProfileForImei(v.ident)
 */
export function vehicleAttributes(v, profile, now) {
  const row = profile?.linked ? profile.vehicle : null
  // Custom types are the client's own words, so "Tanker" and "tanker" are one choice.
  const type = cleanVehicleType(v.master?.vehicleType || row?.vehicleType)
  return {
    assetType:  type.toLowerCase(),
    assetTypeLabel: vehicleTypeLabel(type),
    assetGroup: (row?.subGroup || '').trim(),
    deviceType: (row?.deviceType || '').trim(),
    company:    row?.companyId || '',
    companyName: profile?.linked ? profile.bgName : '',
    // No branch: the client (Business Group) is the branch.
    branch:     row?.branchId || (row?.companyId ? `bg:${row.companyId}` : ''),
    branchName: row ? profile.branchName : '',
    validity:   validityState(row?.validUntil, now),
  }
}

const KEYS = ['assetType', 'assetGroup', 'deviceType', 'company', 'branch', 'validity']

function matchesOne(value, wanted) {
  if (!wanted) return true
  if (wanted === NOT_SET) return !value || value === NOT_SET
  return value === wanted
}

/** Whether a vehicle's attributes pass every chosen filter. */
export function matchesAttributes(attrs, filters) {
  return KEYS.every(k => matchesOne(attrs[k], filters[k]))
}

/** How many filters are set. */
export const activeFilterCount = filters => KEYS.filter(k => filters[k]).length

/**
 * The choices each dropdown offers, from the vehicles on the map: distinct
 * values sorted by label. Branches follow the chosen Company.
 */
export function filterOptions(attrsList, filters) {
  const distinct = (key, labelOf = a => a[key], keep = () => true) => {
    const seen = new Map()
    for (const a of attrsList) if (a[key] && keep(a) && !seen.has(a[key])) seen.set(a[key], labelOf(a))
    return [...seen].map(([value, label]) => ({ value, label })).sort((x, y) => x.label.localeCompare(y.label))
  }
  return {
    assetType:  distinct('assetType', a => a.assetTypeLabel || a.assetType),
    assetGroup: distinct('assetGroup'),
    deviceType: distinct('deviceType'),
    company:    distinct('company', a => a.companyName || a.company),
    branch:     distinct('branch', a => a.branchName || a.branch, a => !filters.company || a.company === filters.company),
    validity:   VALIDITY_OPTIONS,
  }
}
