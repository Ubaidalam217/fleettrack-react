/**
 * Expiry Gate Pass report (client, 2026-11-24): the drivers saved per Business
 * Group, each with a site access card (tag number, tag expiry, ID number,
 * contractor), listed by how close the card is to running out.
 *
 * Pure functions, so the screen, the PDF and the Excel share one set of rows.
 * Dates are calendar dates ("YYYY-MM-DD"), compared as day numbers against
 * today's LOCAL date (the same rule as utils/licenceExpiry.js).
 *
 *   expired  : the date is in the past
 *   expiring : today or later, within the chosen window
 *   valid    : further out
 *   none     : a card on file with no expiry date
 */

import { licenceExpiryState, formatExpiryDate } from './licenceExpiry.js'

/** The status choices of the report. `max` is the window in days for the "expiring" ones. */
export const GATE_PASS_FILTERS = [
  { key: 'attention', label: 'Expired + expiring in 30 days' },
  { key: 'expired', label: 'Expired' },
  { key: 'd7', label: 'Expiring in 7 days', max: 7 },
  { key: 'd15', label: 'Expiring in 15 days', max: 15 },
  { key: 'd30', label: 'Expiring in 30 days', max: 30 },
  { key: 'd60', label: 'Expiring in 60 days', max: 60 },
  { key: 'all', label: 'All' },
]

/** The window the "Expired + expiring" shortcut covers. */
export const ATTENTION_DAYS = 30

export const GATE_PASS_STATE_LABEL = { expired: 'Expired', expiring: 'Expiring', valid: 'Valid', none: 'No expiry' }

/** Does a driver hold a gate pass at all (any of its fields filled)? */
export function hasGatePass(d) {
  return !!(String(d?.gatePassTag ?? '').trim() || d?.gatePassExpiry)
}

/**
 * State and days left of one card against `now`.
 * warnDays: how close counts as expiring (30 unless the report's window is wider).
 * @returns {{ state: 'none'|'expired'|'expiring'|'valid', days: number|null }}
 */
export function gatePassState(expiry, now = new Date(), warnDays = ATTENTION_DAYS) {
  const s = licenceExpiryState(expiry, now)
  if (s.state === 'none') return { state: 'none', days: null }
  if (s.days < 0) return { state: 'expired', days: s.days }
  return { state: s.days <= warnDays ? 'expiring' : 'valid', days: s.days }
}

/** Does a card with `days` left (negative once expired) pass the status filter? */
export function matchesGatePassFilter(days, filterKey) {
  if (filterKey === 'all') return true
  if (days === null) return false
  if (filterKey === 'expired') return days < 0
  if (filterKey === 'attention') return days <= ATTENTION_DAYS
  const f = GATE_PASS_FILTERS.find(x => x.key === filterKey)
  return !!f?.max && days >= 0 && days <= f.max
}

/** Days Left column: "Today", or the number of days (negative once expired). */
export function daysLeftText(days) {
  if (days === null) return '—'
  if (days === 0) return 'Today'
  return String(days)
}

/**
 * The report's rows, sorted by expiry (the oldest, already expired first; a card
 * with no expiry date last), one entry per driver holding a gate pass.
 *
 * @param {object[]} drivers  the Drivers store rows (settings useDrivers)
 * @param {object}  [o]
 * @param {string}  [o.filter='attention']  GATE_PASS_FILTERS key
 * @param {string}  [o.companyId]           one Business Group, or '' for all
 * @param {string}  [o.contractor]          one contractor name (exact, case-insensitive), or ''
 * @param {string}  [o.driverStatus='Active'] 'Active' | 'Inactive' | 'Suspended' | 'all'
 * @param {string}  [o.query]               free text over name, tag, ID, contractor
 * @param {Date}    [o.now]
 */
export function buildGatePassRows(drivers, o = {}) {
  const { filter = 'attention', companyId = '', contractor = '', driverStatus = 'Active', query = '', now = new Date() } = o
  const q = query.trim().toLowerCase()
  const c = contractor.trim().toLowerCase()
  // A wider window picked on the report (60 days) is what counts as expiring on it.
  const warnDays = Math.max(ATTENTION_DAYS, GATE_PASS_FILTERS.find(x => x.key === filter)?.max ?? 0)
  const out = []
  for (const d of drivers ?? []) {
    if (!hasGatePass(d) || d.deletedAt) continue
    if (companyId && d.companyId !== companyId) continue
    if (driverStatus !== 'all' && (d.status || 'Active') !== driverStatus) continue
    if (c && String(d.contractorName ?? '').trim().toLowerCase() !== c) continue
    const { state, days } = gatePassState(d.gatePassExpiry, now, warnDays)
    if (!matchesGatePassFilter(days, filter)) continue
    const row = {
      key: d.id,
      companyId: d.companyId,
      driverName: d.name || '—',
      tagNumber: String(d.gatePassTag ?? '').trim() || '—',
      tagExpiry: formatExpiryDate(d.gatePassExpiry) || '—',
      expiryIso: d.gatePassExpiry || '',
      idNumber: String(d.employeeId ?? '').trim() || '—',
      contractorName: String(d.contractorName ?? '').trim() || '—',
      state,
      status: GATE_PASS_STATE_LABEL[state],
      days,
      daysLeft: daysLeftText(days),
    }
    if (q && ![row.driverName, row.tagNumber, row.idNumber, row.contractorName].some(v => String(v).toLowerCase().includes(q))) continue
    out.push(row)
  }
  // Soonest (or longest overdue) first; no expiry date last; then by name.
  return out.sort((a, b) => {
    if ((a.expiryIso === '') !== (b.expiryIso === '')) return a.expiryIso === '' ? 1 : -1
    return a.expiryIso.localeCompare(b.expiryIso) || a.driverName.localeCompare(b.driverName)
  })
}

/** Group the rows by Business Group, numbering S. NO from 1 in each. */
export function groupGatePassRows(rows, labelOf) {
  const by = new Map()
  for (const r of rows) {
    if (!by.has(r.companyId)) by.set(r.companyId, [])
    by.get(r.companyId).push(r)
  }
  return [...by.entries()]
    .map(([id, list]) => ({
      key: id,
      label: labelOf(id),
      total: `Total Drivers : ${list.length}`,
      rows: list.map((r, i) => ({ ...r, sno: String(i + 1) })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Counts for the closing Report Summary. */
export function gatePassSummary(rows) {
  const n = state => rows.filter(r => r.state === state).length
  const within = max => rows.filter(r => r.days !== null && r.days >= 0 && r.days <= max).length
  return [
    { label: 'Expired', value: String(n('expired')) },
    { label: 'Expiring in 7 days', value: String(within(7)) },
    { label: 'Expiring in 30 days', value: String(within(30)) },
    { label: 'No expiry date', value: String(n('none')) },
    { label: 'Total Drivers', value: String(rows.length) },
  ]
}

/** The distinct contractor names of the drivers that hold a gate pass, for the filter. */
export function contractorOptions(drivers, companyId = '') {
  const seen = new Map()
  for (const d of drivers ?? []) {
    if (!hasGatePass(d) || d.deletedAt || (companyId && d.companyId !== companyId)) continue
    const name = String(d.contractorName ?? '').trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
