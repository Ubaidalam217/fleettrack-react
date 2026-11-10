/**
 * Alert notifications on the phones signed in to the mobile app (client,
 * 2026-11-10), sent with Firebase Cloud Messaging's HTTP v1 API.
 *
 * Off until FCM_SERVICE_ACCOUNT_FILE points at the Firebase project's
 * service-account JSON. The OAuth token is made here from that key (an RS256
 * JWT exchanged at Google's token endpoint), so no Firebase SDK is needed.
 *
 * Who gets an event: every active account with a registered phone that can see
 * the event in the app — the same rule GET /api/alert-events uses
 * (scopedWhere('alertEvent')), so a push never shows what the bell would not.
 * An account whose User settings › Notification leaves out "Mobile" gets none.
 * A token FCM calls unregistered is deleted.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import prisma from '../prisma.js'
import env from '../env.js'
import { buildScope, ROLES, scopedWhere, vehiclesInBranches } from './scope.js'

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

let account // { project_id, client_email, private_key } once read
let cached = null // { token, exp }

function loadAccount() {
  if (account !== undefined) return account
  account = null
  if (!env.FCM_SERVICE_ACCOUNT_FILE) return account
  try {
    const json = JSON.parse(fs.readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, 'utf8'))
    if (json.project_id && json.client_email && json.private_key) account = json
    else console.error('[fleetmax] push: the service-account file lacks project_id, client_email or private_key')
  } catch (err) {
    console.error(`[fleetmax] push: cannot read the service-account file: ${err.message}`)
  }
  return account
}

export const isConfigured = () => !!loadAccount()

/** For tests: forget the key and the cached token. */
export function __resetPush() {
  account = undefined
  cached = null
}

const b64url = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

async function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp - 60 > now) return cached.token
  const acct = loadAccount()
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: acct.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(acct.private_key).toString('base64url')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error(`token request failed (${res.status}): ${data.error_description || data.error || 'no token'}`)
  cached = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) }
  return cached.token
}

/**
 * One message to one phone. Returns 'sent', 'gone' (token no longer valid) or
 * 'failed'. `data` values must be strings (FCM's rule).
 */
export async function sendToToken(token, { title, body, data = {} }) {
  const acct = loadAccount()
  if (!acct) return 'failed'
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        // The app makes this channel (high importance, sound) on start.
        android: { priority: 'HIGH', notification: { channel_id: 'alerts', sound: 'default' } },
      },
    }),
  })
  if (res.ok) return 'sent'
  const err = await res.json().catch(() => ({}))
  const code = err?.error?.details?.find?.(d => d.errorCode)?.errorCode ?? err?.error?.status
  if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT' && /token/i.test(err?.error?.message ?? ''))) return 'gone'
  console.error(`[fleetmax] push failed (${res.status}): ${err?.error?.message ?? 'unknown error'}`)
  return 'failed'
}

/** "Mobile" ticked in the account's notification setting, or no setting at all. */
function wantsMobile(userSetting) {
  const list = userSetting && typeof userSetting === 'object' ? userSetting.notification : undefined
  return !Array.isArray(list) || list.includes('Mobile')
}

/** Every account with a phone that should hear about `events`, with its scope. */
async function recipients() {
  const users = await prisma.user.findMany({
    where: { status: 'Active', pushDevices: { some: {} } },
    select: {
      id: true, role: true, ggbId: true, groupId: true, bgId: true, userSetting: true,
      vehicles: { select: { vehicleId: true } },
      branches: { select: { branchId: true } },
      pushDevices: { select: { token: true } },
    },
  })
  const out = []
  for (const u of users) {
    if (!wantsMobile(u.userSetting)) continue
    const branchVehicleIds = u.role === ROLES.SUB_USER && u.branches.length
      ? await vehiclesInBranches(u.bgId, u.branches.map(b => b.branchId))
      : []
    out.push({ id: u.id, scope: buildScope(u, { branchVehicleIds }), tokens: u.pushDevices.map(d => d.token) })
  }
  return out
}

/**
 * Sends each new event to the phones whose accounts can see it. Events already
 * marked read (a within-grace record, a reminder with in-app off) are skipped,
 * as the bell skips them. Never throws: a push failure must not touch alerting.
 */
export async function pushEvents(events) {
  const due = events.filter(e => !e.readAt)
  if (!due.length || !isConfigured()) return { sent: 0 }
  let sent = 0
  try {
    const people = await recipients()
    for (const e of due) {
      const body = e.message || e.title
      const data = {
        kind: 'alert', eventId: String(e.id), type: String(e.type ?? ''),
        ...(e.deviceId != null ? { deviceId: String(e.deviceId) } : {}),
      }
      for (const p of people) {
        const visible = await prisma.alertEvent.count({ where: { AND: [{ id: e.id }, scopedWhere('alertEvent', p.scope)] } })
        if (!visible) continue
        for (const token of p.tokens) {
          const result = await sendToToken(token, { title: e.title, body, data })
          if (result === 'sent') sent++
          else if (result === 'gone') await prisma.pushDevice.deleteMany({ where: { token } })
        }
      }
    }
  } catch (err) {
    console.error(`[fleetmax] push: ${err.message}`)
  }
  return { sent }
}
