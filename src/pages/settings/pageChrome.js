/**
 * The bits every Settings page needs once the data is real: who may write, whether
 * the data has arrived, and how to turn a thrown ApiError into something the user
 * can act on.
 *
 * Shared rather than copied eight times, because all three have exactly one
 * correct answer and eight copies is eight chances to get one of them subtly
 * different — most dangerously `canWrite`, where a page that forgot the check
 * shows a sub-user buttons that 403.
 *
 * Plain .js with no components, and the <PageNotice> component in its own .jsx —
 * the convention this module already follows elsewhere (FormKit.jsx + formStyles.js,
 * subuserSchema.js). Mixing a component with exported helpers in one file breaks
 * Fast Refresh for the whole file.
 */

import { IS_REAL } from '../../data/mode'
import { useSession } from '../../data/session'
import { useSettingsStatus, refreshAll } from '../../data/settings'
import { canWritePage, isReadOnly } from '../../data/permissions'
import { ApiError } from '../../data/http'

/**
 * Picks the wording that matches what a delete will actually do.
 *
 * The two modes genuinely differ, and not cosmetically: the mock store's
 * removeReseller() just drops the row and leaves its groups and BGs behind, while
 * the server cascades and takes every group, BG, branch, vehicle, account and
 * alert under it. A single note would be a lie in one mode — and the dangerous
 * direction is telling someone their data is "left in place" immediately before
 * deleting all of it.
 */
export const modeNote = (realText, mockText) => (IS_REAL ? realText : mockText)

/**
 * Access and load state for one Settings page.
 *
 * @param pageId one of the node ids in components/sidebar/settingsNav.js
 */
export function usePageAccess(pageId) {
  const session = useSession()
  const status = useSettingsStatus()

  const roleKey = IS_REAL ? (session.user?.role ?? null) : null

  return {
    roleKey,
    canWrite: canWritePage(roleKey, pageId),
    readOnly: isReadOnly(roleKey),
    /**
     * True only on the FIRST load. A refresh after a mutation also sets
     * status.loading, and showing a skeleton then would make every save blink the
     * whole table out and back — the rows are still on screen and still correct.
     */
    loading: IS_REAL && status.loading && !status.loaded,
    error: status.error,
    retry: refreshAll,
  }
}

/**
 * Turns a rejected mutation into a toast plus inline field errors.
 *
 * The server returns `details` as { field: message } using ITS field names, so the
 * map below translates them back to the frontend's — otherwise a duplicate BG
 * email would highlight nothing, because the form has no input called `email`…
 * except it does, which is exactly why the ones that differ are easy to miss.
 *
 * Returns true when the error was shown against a field, so a caller can skip the
 * toast and let the form speak for itself.
 */
const FIELD_MAP = {
  // server → frontend
  plateNo: 'vehicleNumber',
  fleetNo: 'vehicleId',
  bgId: 'companyId',
  ggbId: 'resellerId',
  parentBranchId: 'parentBranchId',
  shortName: 'name',
  minTemp: 'minTemp',
  maxTemp: 'maxTemp',
  vehicleIds: 'vehicleIds',
}

export function apiFieldErrors(err) {
  if (!(err instanceof ApiError) || !err.details) return null
  const out = {}
  for (const [key, message] of Object.entries(err.details)) {
    out[FIELD_MAP[key] ?? key] = message
  }
  return Object.keys(out).length ? out : null
}

/**
 * The standard failure handling for a page's submit/delete.
 *
 * `setErrors` is optional — a delete has no form to annotate, so it just toasts.
 */
export function handleApiError(err, { push, setErrors } = {}) {
  const fields = apiFieldErrors(err)
  if (fields && setErrors) setErrors(prev => ({ ...prev, ...fields }))

  const message =
    err instanceof ApiError
      ? err.message
      : (err?.message ?? 'Something went wrong')

  // Toast even when a field was annotated: a 409 on a field that is scrolled out
  // of view would otherwise look like the Save button simply did nothing.
  push?.(message, { tone: 'error' })
  return fields
}
