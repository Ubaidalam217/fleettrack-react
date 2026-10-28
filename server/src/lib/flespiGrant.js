/**
 * Per-user Flespi ACL tokens: build the ACL from the user's scope, mint, cache,
 * reuse, and revoke.
 *
 * ── One definition of scope ─────────────────────────────────────────────────
 *
 * The device list comes from `scopedWhere('vehicle', scope)` — the SAME filter
 * GET /api/me/vehicles and every other vehicle query use. That is deliberate and
 * it is the whole point: if the Flespi ACL were derived from a second, parallel
 * notion of "which vehicles", the two would drift and the drift would be a
 * privilege leak that no test of either half would catch.
 *
 * ── Methods by role ────────────────────────────────────────────────────────
 *
 *   SUB_USER        ["GET"]          read + MQTT subscribe only
 *   BG_USER and up  ["GET","PUT"]    adds what the vehicle Console needs:
 *                                    metadata save and Poll (settings PUT)
 *
 * PUT does not widen WHICH devices are reachable — `ids` does that — so a BG user
 * can write only to its own BG's devices. Verified against the live account.
 *
 * ── Super Admin ────────────────────────────────────────────────────────────
 *
 * Gets an ACL with `ids` omitted, which covers every device in the account. Not a
 * shortcut: a Super Admin is meant to see devices that exist in Flespi but are not
 * yet registered under Settings > Vehicle, and an id list built from our own
 * vehicle table would hide exactly those — the ones an administrator most needs to
 * notice. It is still an ACL token, never Master.
 */

import crypto from 'node:crypto'
import prisma from '../prisma.js'
import { scopedWhere, ROLES, isSubUser } from './scope.js'
import * as flespi from './flespi.js'
import { __imeiDigits as digits } from './flespi.js'

/** What a role may do to its own devices. */
export function methodsForRole(role) {
  return role === ROLES.SUB_USER ? ['GET'] : ['GET', 'PUT']
}

/**
 * The ACL this account should have right now.
 *
 * Returns `{ acl, deviceIds, methods, unmatchedImeis }`. `deviceIds` is null for a
 * Super Admin, meaning "all devices" — null and [] are emphatically different
 * here, exactly as in the frontend's fleetScope: null reaches everything, [] must
 * reach nothing.
 *
 * [] is still built and returned, because it is the honest description of an
 * account that may see no devices. It is NOT sent to Flespi: `POST /platform/tokens`
 * rejects an empty `ids` array outright ("array items number 0 is less than allowed
 * minimum 1"), so there is no such thing as a token that can reach nothing.
 * ensureGrant() turns that case into a no-token grant instead — see NO_DEVICES.
 */
export async function buildAcl(scope) {
  const methods = methodsForRole(scope.role)

  if (scope.role === ROLES.SUPER_ADMIN) {
    return {
      acl: [{ uri: 'gw/devices', methods }],
      deviceIds: null,
      methods,
      unmatchedImeis: [],
    }
  }

  const vehicles = await prisma.vehicle.findMany({
    where: scopedWhere('vehicle', scope),
    select: { imei: true },
  })

  const byImei = await flespi.deviceMap()

  const deviceIds = []
  const unmatchedImeis = []
  for (const v of vehicles) {
    const id = byImei.get(digits(v.imei))
    if (id === undefined) {
      // A vehicle registered in Settings whose IMEI has no device in the Flespi
      // account. Normal (a tracker not yet added) and not an error — but worth
      // returning so the caller can report it rather than silently narrowing.
      unmatchedImeis.push(v.imei)
    } else if (!deviceIds.includes(id)) {
      deviceIds.push(id)
    }
  }
  deviceIds.sort((a, b) => a - b)

  return {
    acl: [{ uri: 'gw/devices', ids: deviceIds, methods }],
    deviceIds,
    methods,
    unmatchedImeis,
  }
}

/**
 * A stable fingerprint of an ACL.
 *
 * Covers the role's methods and the sorted device ids, so any change to either —
 * a sub-user's assignments, a vehicle added to or removed from their BG, a role
 * change — produces a different hash and forces a fresh token. This is what makes
 * reusing a cached token safe instead of stale.
 */
export function scopeHash({ deviceIds, methods }) {
  const payload = JSON.stringify({
    // `*` rather than null so an all-devices ACL can never collide with an empty
    // one through JSON quirks.
    ids: deviceIds === null ? '*' : deviceIds,
    methods,
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * Seconds-precision expiry matching the caller's JWT.
 *
 * The Flespi token must not outlive the session it belongs to: a token that
 * survives its JWT is a credential the app can no longer see or revoke through
 * normal use. A small safety margin is subtracted so the Flespi side expires
 * first — a client holding a dead Flespi token refreshes cleanly, whereas a live
 * Flespi token behind a dead JWT is an orphan.
 */
export function expiryFor(jwtExpSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const fallback = now + 12 * 3600
  const exp = Number.isFinite(jwtExpSeconds) && jwtExpSeconds > now ? jwtExpSeconds : fallback
  return exp - 60
}

/**
 * There is nothing to mint a token for: the account's scope reaches no Flespi
 * device at all. Either it has no vehicles, or none of its vehicles' IMEIs exist
 * in the Flespi account.
 *
 * `token: null` with this code, rather than an error, because it is not a failure —
 * it is a complete and correct answer to "what may I see". The client needs to tell
 * the two apart: an error means retry, this means show an empty state and stop.
 */
export const NO_DEVICES = 'NO_DEVICES'

/**
 * The token this account should use, minting one only when necessary.
 *
 * Reuse requires all three of: a cached grant, not expired, and the same
 * scopeHash. Any miss revokes the old Flespi token before minting — leaving the
 * old one alive would accumulate tokens in the account that nothing ever deletes,
 * and each is a live credential for a scope the user may no longer have.
 *
 * @returns { token, expiresAt, deviceCount, reused, unmatchedImeis, code }
 *          `token` and `expiresAt` are null when `code` is NO_DEVICES.
 */
export async function ensureGrant(user, scope, jwtExpSeconds) {
  if (!flespi.isConfigured()) {
    const err = new Error('Flespi is not configured on this server')
    err.status = 503
    err.code = 'FLESPI_NOT_CONFIGURED'
    throw err
  }

  const built = await buildAcl(scope)

  /**
   * No reachable device — answer without calling Flespi.
   *
   * Flespi refuses `ids: []`, so the previous behaviour was to attempt the mint,
   * get a 400 back, and surface it as a 502. The client then held no token, never
   * opened MQTT, and sat on "Reconnecting…" forever: an ordinary account with no
   * vehicles looked exactly like an outage.
   *
   * Any grant already on file is revoked first. A user who HAD devices and no
   * longer does must not keep a live token describing the scope they lost.
   */
  if (Array.isArray(built.deviceIds) && built.deviceIds.length === 0) {
    await revokeGrant(user.id)
    return {
      token: null,
      expiresAt: null,
      deviceCount: 0,
      reused: false,
      unmatchedImeis: built.unmatchedImeis,
      code: NO_DEVICES,
    }
  }

  const hash = scopeHash(built)
  const existing = await prisma.flespiGrant.findUnique({ where: { userId: user.id } })

  if (existing && existing.scopeHash === hash && existing.expiresAt > new Date()) {
    // The key is not stored, so it is read back here. A null means somebody
    // deleted the token in the Flespi panel — fall through and mint a new one
    // rather than handing the client a dead credential.
    const key = await flespi.readTokenKey(existing.flespiTokenId)
    if (key) {
      return {
        token: key,
        expiresAt: existing.expiresAt,
        deviceCount: existing.deviceCount,
        reused: true,
        unmatchedImeis: built.unmatchedImeis,
        code: null,
      }
    }
  }

  if (existing) await flespi.deleteToken(existing.flespiTokenId)

  const expire = expiryFor(jwtExpSeconds)
  const created = await flespi.createAclToken({
    // The user id is in the label so an operator looking at the Flespi panel can
    // tell whose token a row is, without it being a credential on its own.
    info: `fleetmax:${user.role}:${user.id}`,
    expire,
    acl: built.acl,
  })

  const expiresAt = new Date(expire * 1000)
  const deviceCount = built.deviceIds === null ? -1 : built.deviceIds.length

  await prisma.flespiGrant.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      flespiTokenId: created.id,
      expiresAt,
      scopeHash: hash,
      deviceCount,
    },
    update: { flespiTokenId: created.id, expiresAt, scopeHash: hash, deviceCount },
  })

  return {
    token: created.key,
    expiresAt,
    deviceCount,
    reused: false,
    unmatchedImeis: built.unmatchedImeis,
    code: null,
  }
}

/**
 * Revoke and forget an account's grant. Safe to call when there is none.
 *
 * Called on logout and whenever something changes the account's fleet. Deliberately
 * never throws: it runs inside handlers whose real job is something else (deleting
 * a vehicle, reassigning a sub-user), and a Flespi hiccup must not fail that work.
 * The worst case is a token that outlives its scope until its own expiry, which is
 * why expiries are short.
 */
export async function revokeGrant(userId) {
  try {
    const grant = await prisma.flespiGrant.findUnique({ where: { userId } })
    if (!grant) return { revoked: false }
    await flespi.deleteToken(grant.flespiTokenId)
    await prisma.flespiGrant.delete({ where: { userId } })
    return { revoked: true, flespiTokenId: grant.flespiTokenId }
  } catch {
    return { revoked: false }
  }
}

/**
 * Revoke the grants of every account matching a Prisma `where`.
 *
 * Only users that actually hold a grant are visited, so the common case (nobody
 * signed in with a live token) costs one indexed query and no Flespi calls.
 */
export async function revokeGrantsWhere(userWhere) {
  const users = await prisma.user.findMany({
    where: { AND: [userWhere, { flespiGrant: { isNot: null } }] },
    select: { id: true },
  })
  let revoked = 0
  for (const u of users) {
    const r = await revokeGrant(u.id)
    if (r.revoked) revoked += 1
  }
  return { revoked }
}

/**
 * Revoke the grants of every account whose fleet may have just changed.
 *
 * Called after any write that can alter which devices someone can see: a vehicle
 * created, moved or deleted. Rather than work out precisely whose scope moved —
 * the same cross-product the server's cascades already make hard to reason about —
 * this takes the BG as the blast radius and drops every grant under it. Those users
 * mint a new token on their next refresh; in exchange, no stale ACL survives.
 *
 * Super Admins are excluded: their ACL is "all devices" and cannot go stale.
 */
export async function revokeGrantsForBg(bgId) {
  if (!bgId) return { revoked: 0 }
  return revokeGrantsWhere({ bgId, role: { not: ROLES.SUPER_ADMIN } })
}

/** Revoke one user's grant plus everyone else's in the given BG(s). */
export async function revokeGrantsAround({ userId, bgIds = [] }) {
  if (userId) await revokeGrant(userId)
  for (const bgId of [...new Set(bgIds.filter(Boolean))]) {
    await revokeGrantsForBg(bgId)
  }
}

/**
 * Revoke before a cascade deletes the accounts themselves.
 *
 * Deleting a BG, group or GGB cascades to its users, and the FlespiGrant row goes
 * with them — but the token at FLESPI would survive until its own expiry, with
 * nothing left in our database pointing at it to clean up. So the Flespi side has
 * to be revoked while the rows still exist.
 */
export const revokeGrantsUnderBg = bgId => revokeGrantsWhere({ bgId })

export const revokeGrantsUnderGroup = groupId =>
  revokeGrantsWhere({ OR: [{ groupId }, { bg: { groupId } }] })

export const revokeGrantsUnderGgb = ggbId =>
  revokeGrantsWhere({ OR: [{ ggbId }, { grp: { ggbId } }, { bg: { ggbId } }] })

export { isSubUser }
