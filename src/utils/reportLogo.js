/**
 * The account logo at the left of every report header (client, 2026-11-13).
 *
 * It is the nearest logo up the signed-in account's own chain — Branch →
 * Business Group → Group → GGB, from GET /api/me/logos — or the one picked in
 * the report's Logo option, remembered per user in this browser. FleetmaxX
 * stays on the right. A Super Admin has no chain, so its reports show
 * FleetmaxX only, as does an account with no logo above it.
 *
 * Module state rather than page state, so the on-screen papers and the four
 * PDF/Excel builders read one answer without every report page passing it on.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { IS_REAL, API_URL } from '../data/mode.js'
import { get } from '../data/http.js'
import { getUser, useSession } from '../data/session.js'

const KIND_LABEL = { branch: 'Branch', bg: 'Business Group', group: 'Group', ggb: 'GGB' }

/** "Business Group – Al Habtoor Logistics" */
export const logoLabel = l => `${KIND_LABEL[l.kind] ?? l.kind} – ${l.name}`
export const logoId = l => `${l.kind}:${l.id}`
export const NO_LOGO = 'none'

const prefKey = userId => `fleetmax.reportLogo.${userId}`

function readPref(userId) {
  try { return localStorage.getItem(prefKey(userId)) } catch { return null }
}

let state = { userId: null, logos: [], pick: null, loaded: false }
let pending = null
const listeners = new Set()
const emit = () => listeners.forEach(fn => fn())
const subscribe = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const snapshot = () => state

/** Loads the signed-in account's logos, once per user. Resolves to the state. */
export function ensureReportLogos() {
  const user = getUser()
  const userId = user?.id ?? null
  if (!IS_REAL || !userId || user.role === 'SUPER_ADMIN') {
    if (state.userId !== userId || state.logos.length) {
      state = { userId, logos: [], pick: null, loaded: true }
      emit()
    }
    return Promise.resolve(state)
  }
  if (state.userId === userId && state.loaded) return Promise.resolve(state)
  if (pending?.userId === userId) return pending.promise
  const promise = get('/api/me/logos')
    .then(rows => (rows ?? []).map(r => ({ ...r, url: `${API_URL}${r.url}` })))
    // No logo is the safe reading of a failed fetch: FleetmaxX alone, as before.
    .catch(() => [])
    .then(logos => {
      if (getUser()?.id === userId) {
        state = { userId, logos, pick: readPref(userId), loaded: true }
        emit()
      }
      if (pending?.promise === promise) pending = null
      return state
    })
  pending = { userId, promise }
  return promise
}

/** The logo to show now: the remembered pick if it is still there, else the nearest. */
export function chosenLogo(s = state) {
  if (!s.logos.length || s.pick === NO_LOGO) return null
  return s.logos.find(l => logoId(l) === s.pick) ?? s.logos[0]
}

/** pick: a logoId() or NO_LOGO. */
export function setReportLogo(pick) {
  state = { ...state, pick }
  try { localStorage.setItem(prefKey(state.userId), pick) } catch { /* private window: this page only */ }
  emit()
}

/** After a logo is uploaded or removed in Settings: read the chain again. */
export function resetReportLogos() {
  state = { userId: null, logos: [], pick: null, loaded: false }
  pending = null
  emit()
}

/** { logos, choice, pick, setPick } for the signed-in account. */
export function useReportLogo() {
  const session = useSession()
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  const userId = session.user?.id ?? null
  useEffect(() => { ensureReportLogos() }, [userId, session.phase])
  if (s.userId !== userId) return { logos: [], choice: null, pick: NO_LOGO, setPick: setReportLogo }
  const choice = chosenLogo(s)
  return { logos: s.logos, choice, pick: choice ? logoId(choice) : NO_LOGO, setPick: setReportLogo }
}

// ── For the PDF and Excel builders ─────────────────────────────────────────

const images = new Map() // url → Promise<{ dataUrl, w, h } | null>

// Long side the logo is downsampled to. It is drawn at most ~120pt wide, so
// this is ~4x oversampled — plenty for print, small in the file.
const LOGO_PX = 480

/**
 * The image at `url` as a JPEG data URL flattened onto white, with its pixel
 * size, as reportExport.loadLogo() does for FleetmaxX: jsPDF embeds a
 * transparent PNG as a raw bitmap, and the page is white anyway.
 */
function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const bmp = await createImageBitmap(await res.blob())
        const scale = Math.min(1, LOGO_PX / Math.max(bmp.width, bmp.height))
        const w = Math.max(1, Math.round(bmp.width * scale))
        const h = Math.max(1, Math.round(bmp.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(bmp, 0, 0, w, h)
        bmp.close?.()
        return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), w, h }
      } catch {
        images.delete(url)
        return null
      }
    })())
  }
  return images.get(url)
}

/** The chosen account logo for a PDF or Excel file, or null for none. */
export async function loadAccountLogo() {
  await ensureReportLogos()
  const c = chosenLogo()
  return c ? loadImage(c.url) : null
}

/** (w, h) scaled to fit inside maxW × maxH. */
export function fitLogo(img, maxW, maxH) {
  const s = Math.min(maxW / img.w, maxH / img.h)
  return { w: img.w * s, h: img.h * s }
}

/**
 * Draws the account logo in the box at (x, y), left-aligned and vertically
 * centred, and returns the width it took (0 for none).
 */
export function drawAccountLogo(doc, img, x, y, maxW, maxH) {
  if (!img) return 0
  const { w, h } = fitLogo(img, maxW, maxH)
  doc.addImage(img.dataUrl, 'JPEG', x, y + (maxH - h) / 2, w, h, 'account-logo', 'FAST')
  return w
}

/**
 * Excel: a row above the title with the account logo at the left and
 * FleetmaxX (`fleetmax`, a JPEG data URL of the 863×273 artwork) over the
 * last column. Adds nothing without an account logo, so those sheets stay as
 * they were. Returns the number of rows added (0 or 1).
 */
export function addExcelLogoRow(wb, ws, { account, fleetmax, lastCol }) {
  if (!account) return 0
  const row = ws.addRow([])
  row.height = 36
  const H = 40
  const a = fitLogo(account, 200, H)
  ws.addImage(wb.addImage({ base64: account.dataUrl, extension: 'jpeg' }), { tl: { col: 0.1, row: 0.1 }, ext: { width: a.w, height: a.h } })
  if (fleetmax) {
    ws.addImage(wb.addImage({ base64: fleetmax, extension: 'jpeg' }), {
      tl: { col: Math.max(1, lastCol - 1), row: 0.25 }, ext: { width: 110, height: 110 * (273 / 863) },
    })
  }
  return 1
}
