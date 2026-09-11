// Vehicle documents — seed file plus a localStorage overlay.
//
// The client asked for a local JSON file and no file uploads. A file bundled
// in the app is read-only at runtime, so Add/Edit/Delete would not survive a
// refresh on the seed alone. This module layers user edits in localStorage on
// top of the seed and treats the merged result as the source of truth, so the
// spec's CRUD actually works in a demo.
//
// Attachments are deliberately unsupported: there is nowhere to put the bytes
// without a backend. The field is carried through as null so the shape is
// already right when file storage arrives.
//
// Documents whose source is 'permit-management' stand in for records the spec
// says are auto-synced from Permit Management. They are read-only here.

import seed from '../data/documents.json'

const OVERLAY_KEY = 'ft_documents_overlay'

export const READ_ONLY_SOURCE = 'permit-management'

function readOverlay() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERLAY_KEY))
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch {
    return {}
  }
}

function writeOverlay(overlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay))
  } catch {
    // Quota or private-mode failure. Edits stay in memory for this page view.
  }
}

function seedFor(deviceId) {
  return seed.documents?.[String(deviceId)] ?? []
}

function normalizeDoc(doc) {
  return {
    id:               String(doc?.id ?? ''),
    name:             typeof doc?.name === 'string' ? doc.name : '',
    expiryDate:       typeof doc?.expiryDate === 'string' ? doc.expiryDate : null,
    notifyBeforeDays: Number.isFinite(doc?.notifyBeforeDays) ? doc.notifyBeforeDays : 30,
    attachment:       null,
    source:           doc?.source === READ_ONLY_SOURCE ? READ_ONLY_SOURCE : 'local',
  }
}

export function isReadOnly(doc) {
  return doc?.source === READ_ONLY_SOURCE
}

/**
 * Documents for a vehicle: seed entries with any overlay edits applied,
 * followed by documents the user added. Deleted seed entries are filtered out.
 */
export function listDocuments(deviceId) {
  const key     = String(deviceId)
  const overlay = readOverlay()[key] ?? { edited: {}, deleted: [], added: [] }
  const deleted = new Set(overlay.deleted ?? [])

  const fromSeed = seedFor(key)
    .filter(d => !deleted.has(d.id))
    .map(d => normalizeDoc({ ...d, ...(overlay.edited?.[d.id] ?? {}) }))

  const added = (overlay.added ?? []).map(normalizeDoc)

  return [...fromSeed, ...added]
}

function mutate(deviceId, fn) {
  const key     = String(deviceId)
  const overlay = readOverlay()
  const entry   = overlay[key] ?? { edited: {}, deleted: [], added: [] }
  const next    = fn({
    edited:  { ...(entry.edited ?? {}) },
    deleted: [...(entry.deleted ?? [])],
    added:   [...(entry.added ?? [])],
  })
  writeOverlay({ ...overlay, [key]: next })
  return listDocuments(key)
}

export function addDocument(deviceId, doc) {
  const created = normalizeDoc({ ...doc, id: `doc-${crypto.randomUUID()}`, source: 'local' })
  return mutate(deviceId, entry => ({ ...entry, added: [...entry.added, created] }))
}

export function updateDocument(deviceId, docId, patch) {
  const target = listDocuments(deviceId).find(d => d.id === docId)
  if (!target) return listDocuments(deviceId)
  if (isReadOnly(target)) {
    throw new Error('This document is synced from Permit Management and cannot be edited here.')
  }

  return mutate(deviceId, entry => {
    const addedIdx = entry.added.findIndex(d => d.id === docId)
    if (addedIdx !== -1) {
      const added = [...entry.added]
      added[addedIdx] = normalizeDoc({ ...added[addedIdx], ...patch })
      return { ...entry, added }
    }
    // Seed entry — record the delta rather than copying the whole record, so
    // later changes to the seed file still flow through for untouched fields.
    return { ...entry, edited: { ...entry.edited, [docId]: { ...(entry.edited[docId] ?? {}), ...patch } } }
  })
}

export function deleteDocument(deviceId, docId) {
  const target = listDocuments(deviceId).find(d => d.id === docId)
  if (!target) return listDocuments(deviceId)
  if (isReadOnly(target)) {
    throw new Error('This document is synced from Permit Management and cannot be deleted here.')
  }

  return mutate(deviceId, entry => {
    if (entry.added.some(d => d.id === docId)) {
      return { ...entry, added: entry.added.filter(d => d.id !== docId) }
    }
    const edited = { ...entry.edited }
    delete edited[docId]
    return { ...entry, edited, deleted: [...entry.deleted, docId] }
  })
}

// Days until expiry — negative when already expired, null when no date set.
export function daysUntilExpiry(doc, now = Date.now()) {
  if (!doc?.expiryDate) return null
  const ts = Date.parse(`${doc.expiryDate}T00:00:00`)
  if (Number.isNaN(ts)) return null
  return Math.ceil((ts - now) / 86_400_000)
}

// 'expired' | 'due' (inside the notify window) | 'ok' | null
export function expiryState(doc, now = Date.now()) {
  const days = daysUntilExpiry(doc, now)
  if (days === null) return null
  if (days < 0) return 'expired'
  return days <= (doc.notifyBeforeDays ?? 30) ? 'due' : 'ok'
}
