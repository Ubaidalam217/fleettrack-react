/**
 * The Flespi platform client. The Master token lives here and nowhere else.
 *
 * Two jobs:
 *   1. mint / read / delete ACL tokens (POST, GET, DELETE /platform/tokens)
 *   2. map a vehicle's IMEI to its Flespi device id
 *
 * ── The ACL format, verified against the live account ───────────────────────
 *
 *   POST /platform/tokens          (body is an ARRAY)
 *   [{ info, expire, access: { type: 2, acl: [{ uri, ids, methods }] } }]
 *
 *   access.type  1 = Master, 2 = ACL. Not documented; established by creating one.
 *   expire       absolute unix seconds, honoured exactly — so it can match the JWT.
 *   ids          omit to cover every device in the account.
 *   methods      GET | POST | PUT | DELETE.
 *
 * Measured behaviour of `{uri:"gw/devices", ids:[N], methods:["GET"]}`:
 *   - GET /gw/devices/N                 200
 *   - GET /gw/devices/<other>           403
 *   - GET /gw/devices/all               200, silently NARROWED to the allowed ids
 *   - sub-resources (/messages, /telemetry, /settings/x) inherit the entry
 *   - PUT anything                      403
 *   - /platform/*, /gw/channels/*       403
 *
 * MQTT needs no separate entry: delivery on `flespi/...` topics follows the REST
 * ACL. Note it does so SILENTLY — subscribing to a device outside the ACL returns
 * `granted qos=1` and then delivers nothing, so SUBACK cannot be used to detect
 * denial.
 */

import env from '../env.js'

const BASE = 'https://flespi.io'

/**
 * Translate an upstream Flespi status into the status WE should answer with.
 *
 * Reflecting Flespi's status verbatim would be wrong and occasionally misleading:
 * a Flespi 500 is not our client's fault, and a 403 from Flespi means OUR master
 * token was rejected — a server misconfiguration that must not be reported to the
 * caller as "you are forbidden". Both are gateway failures, so 502.
 *
 * 429 passes through, because it is the one upstream status the client should act
 * on itself: Flespi throttles on REST traffic VOLUME per minute, and the right
 * response is for the caller to back off and retry.
 */
function gatewayStatusFor(upstream) {
  if (upstream === 429) return 429
  if (upstream === 504) return 504
  return 502
}

/**
 * A Flespi call failed.
 *
 * `upstreamStatus` is what Flespi said; `status` is what we will answer. Callers
 * that branch on Flespi's own semantics (a token that is already gone) must read
 * upstreamStatus — `status` has been mapped and no longer distinguishes 404.
 */
export class FlespiError extends Error {
  constructor(upstreamStatus, message, path) {
    super(message)
    this.name = 'FlespiError'
    this.upstreamStatus = upstreamStatus
    this.status = gatewayStatusFor(upstreamStatus)
    this.path = path
  }

  get isThrottled() {
    return this.upstreamStatus === 429
  }

  /** Flespi says the object is not there — for tokens, the desired end state. */
  get isMissing() {
    return this.upstreamStatus === 404 || this.upstreamStatus === 400
  }
}

export const isConfigured = () => !!env.FLESPI_TOKEN

function masterHeaders(json = false) {
  const h = { Authorization: `FlespiToken ${env.FLESPI_TOKEN}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

/**
 * One Flespi request with the Master token.
 *
 * A hard timeout matters here: this runs inside our own request handlers, and a
 * Flespi stall would otherwise hold an Express connection open until the client
 * gave up. `timeoutMs` is deliberately short on the login path — see
 * routes/auth.js, which treats a Flespi failure as non-fatal.
 */
async function call(path, { method = 'GET', body, timeoutMs = env.FLESPI_TIMEOUT_MS } = {}) {
  if (!isConfigured()) {
    // Not a gateway failure — nothing was attempted. A plain error so it is not
    // mapped to 502 by gatewayStatusFor(); routes check isConfigured() first and
    // answer 503, so this is only the backstop.
    const err = new Error('FLESPI_TOKEN is not configured on the server')
    err.status = 503
    err.code = 'FLESPI_NOT_CONFIGURED'
    throw err
  }

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: masterHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError'
    throw new FlespiError(
      timedOut ? 504 : 502,
      timedOut ? `Flespi did not respond within ${timeoutMs}ms` : `Cannot reach Flespi: ${err?.message}`,
      path
    )
  }

  const text = await res.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!res.ok) {
    const reason = payload?.errors?.[0]?.reason ?? res.statusText
    throw new FlespiError(res.status, `Flespi ${method} ${path} failed: ${reason}`, path)
  }

  return payload
}

/**
 * Pass one request through to Flespi with the Master token, returning Flespi's
 * own status and body untouched. Used by the /api/flespi/proxy route, whose job is
 * to decide WHETHER a request may go through; this only carries it.
 *
 * Unlike call(), a non-2xx answer is not an error here: a 404 or 429 from Flespi
 * is the response the browser should see, so the caller can react to it exactly
 * as it did when it talked to Flespi directly.
 */
export async function forward(pathWithQuery, { method = 'GET', body, timeoutMs = 60_000 } = {}) {
  if (!isConfigured()) {
    const err = new Error('FLESPI_TOKEN is not configured on the server')
    err.status = 503
    throw err
  }
  let res
  try {
    res = await fetch(`${BASE}${pathWithQuery}`, {
      method,
      headers: masterHeaders(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError'
    throw new FlespiError(
      timedOut ? 504 : 502,
      timedOut ? `Flespi did not respond within ${timeoutMs}ms` : `Cannot reach Flespi: ${err?.message}`,
      pathWithQuery
    )
  }
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || 'application/json',
    text: await res.text(),
  }
}

// ── Tokens ──────────────────────────────────────────────────────────────────

/**
 * Mint an ACL token.
 *
 * @param info     human label, shown in the Flespi panel
 * @param expire   absolute unix seconds
 * @param acl      array of { uri, ids?, methods }
 * @returns { id, key, expire }
 */
export async function createAclToken({ info, expire, acl }) {
  const payload = await call('/platform/tokens', {
    method: 'POST',
    // The array wrapper is required by the API, and the response mirrors it.
    body: [{ info, expire, access: { type: 2, acl } }],
  })
  const t = Array.isArray(payload?.result) ? payload.result[0] : payload?.result
  if (!t?.id || !t?.key) {
    throw new FlespiError(502, 'Flespi created a token but returned no id/key', '/platform/tokens')
  }
  return { id: t.id, key: t.key, expire: t.expire }
}

/**
 * Read an existing token's key back.
 *
 * This is what lets FlespiGrant store only the id: the key is fetched on demand
 * rather than kept in our database. Returns null for a token that no longer
 * exists, which is the normal outcome after someone deletes one in the panel.
 */
export async function readTokenKey(flespiTokenId) {
  try {
    const payload = await call(`/platform/tokens/${flespiTokenId}`)
    const t = Array.isArray(payload?.result) ? payload.result[0] : payload?.result
    return t?.key ?? null
  } catch (err) {
    if (err instanceof FlespiError && err.isMissing) return null
    throw err
  }
}

/**
 * Delete a token. Never throws for an already-gone token.
 *
 * Revocation is called from cleanup paths (logout, scope change) where failing
 * loudly would block the thing the user actually asked for. A token that is
 * already absent is the desired end state, so 404 is success.
 */
export async function deleteToken(flespiTokenId) {
  try {
    await call(`/platform/tokens/${flespiTokenId}`, { method: 'DELETE' })
    return true
  } catch (err) {
    if (err instanceof FlespiError && err.isMissing) return true
    return false
  }
}

// ── IMEI → device id ────────────────────────────────────────────────────────

/**
 * Cached map of normalised IMEI → Flespi device id.
 *
 * Cached because it changes only when a device is added to the Flespi account,
 * which is a manual act, while it is needed on every token mint. The TTL bounds
 * how long a newly-added device stays invisible.
 *
 * `digits` keys rather than raw idents: Flespi reports `configuration.ident` and
 * our Vehicle.imei is stored digits-only, so the two only line up after the same
 * normalisation. Same rule as lib/text.js normalizeImei.
 */
let deviceCache = { at: 0, byImei: new Map() }

const digits = v => String(v ?? '').replace(/\D/g, '')

export async function deviceMap({ force = false } = {}) {
  const fresh = Date.now() - deviceCache.at < env.FLESPI_DEVICE_CACHE_MS
  if (!force && fresh && deviceCache.byImei.size) return deviceCache.byImei

  const payload = await call('/gw/devices/all?fields=id,configuration')
  const rows = Array.isArray(payload?.result) ? payload.result : []

  const byImei = new Map()
  for (const d of rows) {
    const ident = digits(d?.configuration?.ident)
    // A device with no ident cannot be matched to a vehicle; skipping it is
    // correct rather than mapping it to an empty key that every unset IMEI hits.
    if (ident) byImei.set(ident, d.id)
  }

  deviceCache = { at: Date.now(), byImei }
  return byImei
}

/** Every device id in the account — the Super Admin's effective scope. */
export async function allDeviceIds() {
  const map = await deviceMap()
  return [...map.values()].sort((a, b) => a - b)
}

/** Test seam: drop the cache so a test or an admin action re-reads Flespi. */
export function clearDeviceCache() {
  deviceCache = { at: 0, byImei: new Map() }
}

export const __imeiDigits = digits
