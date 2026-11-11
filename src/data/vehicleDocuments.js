/**
 * Vehicle documents (client spec 12) — permit, insurance, registration,
 * certificate… with an optional scanned copy, kept on the server
 * (server/src/routes/vehicleDocuments.js) so every user of the BG sees the
 * same list and the expiry alert can read it.
 *
 * Server only: mock mode has nowhere to keep them. The lists are cached per
 * vehicle and shared, so the Alerts tab sees a document the Documents tab has
 * just added without a second request.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { API_URL, IS_REAL } from './mode.js'
import { del, get, post, put } from './http.js'
import { getToken } from './session.js'

/** The types the server accepts (VEHICLE_DOC_TYPES there). */
export const VEHICLE_DOC_TYPES = ['Permit', 'Insurance', 'Registration', 'Certificate', 'Other']
export const MAX_DOC_BYTES = 5 * 1024 * 1024
export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'

const base = vehicleId => `/api/vehicles/${vehicleId}/documents`

// vehicleId → { docs: [] | null, error: Error | null }
const cache = new Map()
const listeners = new Set()
const EMPTY = { docs: null, error: null }
const notify = () => listeners.forEach(fn => fn())

/** Fetches a vehicle's list again and tells every hook showing it. */
export async function reloadVehicleDocuments(vehicleId) {
  if (!IS_REAL || !vehicleId) return []
  try {
    const docs = await get(base(vehicleId))
    cache.set(vehicleId, { docs, error: null })
    notify()
    return docs
  } catch (error) {
    cache.set(vehicleId, { docs: cache.get(vehicleId)?.docs ?? [], error })
    notify()
    throw error
  }
}

/**
 * `{ docs, error }` for a registered vehicle (its Settings id). `docs` is null
 * while the first load runs, and [] for no vehicle or in mock mode.
 */
export function useVehicleDocuments(vehicleId) {
  const state = useSyncExternalStore(
    fn => { listeners.add(fn); return () => listeners.delete(fn) },
    () => cache.get(vehicleId) ?? EMPTY,
  )
  useEffect(() => {
    if (IS_REAL && vehicleId) reloadVehicleDocuments(vehicleId).catch(() => { /* shown through state.error */ })
  }, [vehicleId])
  if (!IS_REAL || !vehicleId) return { docs: [], error: null }
  return state
}

const after = vehicleId => async result => { await reloadVehicleDocuments(vehicleId).catch(() => {}); return result }

/** body: { docType, name, number, issueDate, expiryDate, notifyBeforeDays, note, fileName?, data? (base64) } */
export const addVehicleDocument = (vehicleId, body) => post(base(vehicleId), body).then(after(vehicleId))
/** As add; the file stays unless `data` is sent or `removeFile` is true. */
export const updateVehicleDocument = (vehicleId, docId, body) => put(`${base(vehicleId)}/${docId}`, body).then(after(vehicleId))
export const deleteVehicleDocument = (vehicleId, docId) => del(`${base(vehicleId)}/${docId}`).then(after(vehicleId))

async function fileBlob(vehicleId, docId) {
  const res = await fetch(`${API_URL}${base(vehicleId)}/${docId}/file`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(`Could not get the file (${res.status})`)
  return res.blob()
}

/** Shows the scanned copy in a new tab (fetched with the login token). */
export async function openVehicleDocument(vehicleId, doc) {
  const url = URL.createObjectURL(await fileBlob(vehicleId, doc.id))
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Saves the scanned copy under its own file name. */
export async function downloadVehicleDocument(vehicleId, doc) {
  const url = URL.createObjectURL(await fileBlob(vehicleId, doc.id))
  const a = document.createElement('a')
  a.href = url
  a.download = doc.fileName || 'document'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
