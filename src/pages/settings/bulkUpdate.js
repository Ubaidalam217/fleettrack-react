/**
 * Bulk Object Update (BulkAction.jsx): which cells of a row changed, and which
 * endpoint each goes to. Kept out of the page so it stays a component-only
 * module (Fast Refresh).
 */

import { siteField } from '../../utils/vehicleSite'

export const MAX_ROWS_PER_SAVE = 100
/** Saved with PATCH /api/vehicles/:id/details — never touches the Flespi device. */
export const DETAIL_KEYS = ['branchId', 'make', 'model', 'vehicleType', 'mobileNo', 'validUntil']
/** Saved with the full vehicle update, which also renames the tracker in Flespi. */
export const NAME_KEYS = ['vehicleNumber', 'vehicleId']

/** A saved vehicle's value for a column: Site is kept in its custom fields. */
export const cellValue = (row, key) => (key === 'site' ? siteField(row.customFields) : row[key])

/** The cells of one row that differ from the saved vehicle; `odometer` counts once typed. */
export function changedCells(row, edit) {
  if (!edit) return {}
  const out = {}
  for (const [k, v] of Object.entries(edit)) {
    if (k === 'odometer') { if (String(v ?? '').trim() !== '') out.odometer = v; continue }
    if (String(v ?? '').trim() !== String(cellValue(row, k) ?? '').trim()) out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out
}
