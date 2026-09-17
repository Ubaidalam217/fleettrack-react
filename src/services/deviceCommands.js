// Device action dispatch + audit trail.
//
// Teltonika units expose their actions through Flespi's *settings* API, not the
// commands API. `POST /gw/devices/{id}/commands` rejects `getgps` outright
// ("command definition 'getgps' is not found") because on this protocol it is a
// mode-2 ("action") setting rather than a protocol command. The call that works,
// confirmed end-to-end against device 8416779:
//
//   PUT /gw/devices/{id}/settings/{name}   body: {"address": "connection"}
//
// `address` is mandatory and must be one the setting declares — every action
// lists "connection", most also allow "sms" (which needs gsm_numbers set up, so
// we never use it).
//
// Delivery is asynchronous, and this is the part worth being careful about: the
// PUT returns 200 with `pending: {}` the instant Flespi *queues* the action —
// including for a device that is powered off, where it will sit in the queue
// until the unit next dials in. Treating that 200 as success would report
// "done" for something that has not happened. Confirmation is `pending`
// clearing back to null while `updated` advances past its previous value, which
// is what awaitDelivery() below watches for.

import { BASE_URL, HEADERS } from '../hooks/flespiConfig'
import { getCurrentUser } from './authUser'

/** Action reached the device and was acknowledged. */
export const DELIVERED = 'delivered'
/** Accepted by Flespi but still queued — device is offline. */
export const QUEUED = 'queued'

// How long to wait for the queue to drain before calling it offline. A
// connected unit acknowledged in well under two seconds during testing; 10s is
// slack for a slow GPRS link, short enough that the UI is not left hanging.
const CONFIRM_TIMEOUT_MS  = 10_000
const CONFIRM_INTERVAL_MS = 1_000

/** Actions this build is allowed to send. See the probe report for why this
 *  list is short: output/immobiliser actions are withheld until the client
 *  confirms relays are physically fitted, and anything touching connectivity is
 *  withheld because these units also report to a government endpoint. */
export const ACTIONS = {
  poll: {
    setting: 'getgps',
    address: 'connection',
    label:   'Poll',
    // Shown in the confirmation dialog.
    detail:  'Asks the device to take a GPS fix and report its position immediately.',
  },
}

function settingUrl(deviceId, setting) {
  return `${BASE_URL}/gw/devices/${deviceId}/settings/${setting}`
}

async function flespiJson(url, init) {
  const res  = await fetch(url, init)
  let body   = null
  try { body = await res.json() } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const reason = body?.errors?.[0]?.reason || res.statusText
    const err = new Error(`Flespi ${res.status}: ${reason}`)
    err.status = res.status
    throw err
  }
  return body
}

/** Reads one setting's current record, or null if Flespi returns nothing. */
async function readSetting(deviceId, setting) {
  const body = await flespiJson(settingUrl(deviceId, setting), { headers: HEADERS })
  return body?.result?.[0] ?? null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Poll a freshly-dispatched action until the device acknowledges it.
 *
 * `baselineUpdated` is the setting's `updated` stamp from before the PUT — an
 * action that has never run reports 0, and one that ran earlier reports its
 * last execution, so comparing against it is what distinguishes *this*
 * dispatch from a stale acknowledgement.
 */
async function awaitDelivery(deviceId, setting, baselineUpdated) {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS

  while (Date.now() < deadline) {
    await sleep(CONFIRM_INTERVAL_MS)

    let record
    try {
      record = await readSetting(deviceId, setting)
    } catch {
      // A read failure mid-confirmation says nothing about the queued action —
      // keep waiting rather than reporting a delivery that may still land.
      continue
    }

    if (record && record.pending == null && (record.updated ?? 0) > baselineUpdated) {
      return { status: DELIVERED, updated: record.updated }
    }
  }

  return { status: QUEUED, updated: null }
}

/**
 * Dispatch a device action and report what actually happened to it.
 *
 * @param {number} deviceId
 * @param {string} actionKey  key into ACTIONS
 * @returns {Promise<{status: 'delivered'|'queued', updated: number|null}>}
 * @throws if Flespi refuses the request outright (auth, unknown setting, …)
 */
export async function sendDeviceAction(deviceId, actionKey) {
  const action = ACTIONS[actionKey]
  if (!action) throw new Error(`Unknown action "${actionKey}"`)

  // Baseline first: without it a device that ran this action previously would
  // look like an instant success on the very first poll.
  let baselineUpdated = 0
  try {
    baselineUpdated = (await readSetting(deviceId, action.setting))?.updated ?? 0
  } catch { /* fall back to 0 — worst case we accept a stale ack */ }

  await flespiJson(settingUrl(deviceId, action.setting), {
    method:  'PUT',
    headers: HEADERS,
    body:    JSON.stringify({ address: action.address }),
  })

  return awaitDelivery(deviceId, action.setting, baselineUpdated)
}

// ── Audit log ──────────────────────────────────────────────────────────────
// Every dispatch is recorded locally with who sent it and when. localStorage
// only: there is no backend to post to, and the point is that an operator can
// answer "who polled that vehicle" after the fact.

const AUDIT_KEY = 'ft-command-audit'
const AUDIT_MAX = 300

export function readAuditLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Append one entry. Newest first, capped so the key cannot grow without bound.
 *
 * @param {{deviceId:number, vehicle:string, action:string, outcome:string, detail?:string}} entry
 */
export function logCommand(entry) {
  const user = getCurrentUser()
  const row  = {
    ts:     Date.now(),
    user:   user?.email || 'unknown',
    name:   user?.name  || 'Unknown',
    ...entry,
  }
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify([row, ...readAuditLog()].slice(0, AUDIT_MAX)))
  } catch { /* private mode / quota — the command itself still went out */ }
  return row
}
