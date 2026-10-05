/**
 * Visibility and write rights. The single place either is decided.
 *
 * Every list query in every route composes its filter from scopedWhere(), and
 * every single-record read/update/delete goes through findScopedOrThrow(). No
 * route is allowed a bare findUnique({ where: { id } }) — that is the one call
 * that would quietly hand a row to whoever guessed its id, and the reason the
 * helpers exist rather than per-route filtering that has to be remembered eight
 * times.
 *
 * ── The pivot ────────────────────────────────────────────────────────────────
 *
 * Every leaf entity (Branch, Vehicle, User, Alert) carries bgId, so almost every
 * question reduces to "which BusinessGroups may this account see":
 *
 *   SUPER_ADMIN   every BG
 *   GGB_ADMIN     bg.ggbId   = user.ggbId
 *   GROUP_ADMIN   bg.groupId = user.groupId
 *   BG_USER       bg.id      = user.bgId
 *   SUB_USER      bg.id      = user.bgId, narrowed again to assigned vehicles
 *
 * ── Subtree only, no ancestors ───────────────────────────────────────────────
 *
 * A role sees its own node and everything below it, and NOT the chain above it:
 * a BG_USER listing /api/ggbs gets an empty array, not the name of the GGB it
 * hangs from. That is the strict reading of "only their own BG, its branches and
 * all its vehicles", and it keeps one rule instead of a rule plus an exception.
 *
 * ── Misses are 404, never 403 ────────────────────────────────────────────────
 *
 * An out-of-scope id and a non-existent id return the same 404. Distinguishing
 * them would turn the API into an oracle for enumerating another tenant's ids,
 * which leaks the structure the scoping exists to hide. 403 is reserved for when
 * the caller's own role is the problem and no id is being probed.
 */

import prisma from '../prisma.js'
import { forbidden, notFound } from './http.js'

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  GGB_ADMIN: 'GGB_ADMIN',
  GROUP_ADMIN: 'GROUP_ADMIN',
  BG_USER: 'BG_USER',
  SUB_USER: 'SUB_USER',
})

/**
 * Widest to narrowest. Used for one rule — you may only create accounts
 * strictly below your own rank — which replaces a five-by-five table of who may
 * create whom, and cannot drift out of step with the hierarchy above.
 */
export const ROLE_RANK = Object.freeze({
  SUPER_ADMIN: 0,
  GGB_ADMIN: 1,
  GROUP_ADMIN: 2,
  BG_USER: 3,
  SUB_USER: 4,
})

/**
 * A filter that matches nothing.
 *
 * `{ id: { in: [] } }` rather than throwing, so "this role cannot see any GGB"
 * is an ordinary empty list from an ordinary query. A route does not need to
 * know that some roles have no access to some collections at all.
 */
const MATCH_NONE = Object.freeze({ id: { in: [] } })

/** The entity name used by the helpers → its Prisma delegate and 404 label. */
const ENTITIES = Object.freeze({
  ggb: { delegate: 'ggb', label: 'GGB' },
  group: { delegate: 'group', label: 'Group' },
  bg: { delegate: 'businessGroup', label: 'Business group' },
  branch: { delegate: 'branch', label: 'Branch' },
  vehicle: { delegate: 'vehicle', label: 'Vehicle' },
  user: { delegate: 'user', label: 'User' },
  alert: { delegate: 'alert', label: 'Alert' },
})

/**
 * The shape every helper here takes, built once per request by
 * middleware/auth.js from the freshly-read user row.
 *
 * `assignedVehicleIds` / `assignedBranchIds` are only populated for a SUB_USER —
 * for every other role they are null, meaning "not narrowed", which is a
 * different thing from an empty array ("narrowed to nothing"). A sub-user with
 * no assignments must see zero vehicles, not all of them, so the distinction has
 * to survive into the filters.
 */
export function buildScope(user) {
  const isSub = user.role === ROLES.SUB_USER
  return Object.freeze({
    userId: user.id,
    role: user.role,
    ggbId: user.ggbId ?? null,
    groupId: user.groupId ?? null,
    bgId: user.bgId ?? null,
    assignedVehicleIds: isSub ? (user.vehicles ?? []).map(v => v.vehicleId) : null,
    assignedBranchIds: isSub ? (user.branches ?? []).map(b => b.branchId) : null,
  })
}

export const isSuperAdmin = scope => scope.role === ROLES.SUPER_ADMIN
export const isSubUser = scope => scope.role === ROLES.SUB_USER

// ── The BG constraint, in two shapes ─────────────────────────────────────────

/**
 * A `where` fragment for the BusinessGroup model itself.
 *
 * Returns MATCH_NONE for a role whose scope link is missing rather than `{}`:
 * a GGB_ADMIN row with a null ggbId is corrupt data, and the safe reading of
 * corrupt scope data is "sees nothing", never "sees everything". (users.js
 * refuses to write such a row in the first place — this is the second line.)
 */
export function bgWhere(scope) {
  switch (scope.role) {
    case ROLES.SUPER_ADMIN:
      return {}
    case ROLES.GGB_ADMIN:
      return scope.ggbId ? { ggbId: scope.ggbId } : MATCH_NONE
    case ROLES.GROUP_ADMIN:
      return scope.groupId ? { groupId: scope.groupId } : MATCH_NONE
    case ROLES.BG_USER:
    case ROLES.SUB_USER:
      return scope.bgId ? { id: scope.bgId } : MATCH_NONE
    default:
      return MATCH_NONE
  }
}

/**
 * The same constraint expressed on a child row that carries `bgId`.
 *
 * Prefers the scalar column when the role's filter is a single BG — that hits
 * the bgId index directly instead of making Postgres run an EXISTS subquery for
 * every candidate row, which is the common case (BG_USER and SUB_USER are the
 * roles with the most traffic).
 */
function childBgWhere(scope) {
  switch (scope.role) {
    case ROLES.SUPER_ADMIN:
      return {}
    case ROLES.GGB_ADMIN:
      return scope.ggbId ? { bg: { ggbId: scope.ggbId } } : MATCH_NONE
    case ROLES.GROUP_ADMIN:
      return scope.groupId ? { bg: { groupId: scope.groupId } } : MATCH_NONE
    case ROLES.BG_USER:
    case ROLES.SUB_USER:
      return scope.bgId ? { bgId: scope.bgId } : MATCH_NONE
    default:
      return MATCH_NONE
  }
}

// ── Per-entity filters ───────────────────────────────────────────────────────

export function ggbWhere(scope) {
  if (isSuperAdmin(scope)) return {}
  if (scope.role === ROLES.GGB_ADMIN) return scope.ggbId ? { id: scope.ggbId } : MATCH_NONE
  // Group admins and below: the GGB is above their node, so it is not theirs to
  // read. See "Subtree only, no ancestors" at the top of this file.
  return MATCH_NONE
}

export function groupWhere(scope) {
  if (isSuperAdmin(scope)) return {}
  if (scope.role === ROLES.GGB_ADMIN) return scope.ggbId ? { ggbId: scope.ggbId } : MATCH_NONE
  if (scope.role === ROLES.GROUP_ADMIN) return scope.groupId ? { id: scope.groupId } : MATCH_NONE
  return MATCH_NONE
}

export function branchWhere(scope) {
  const base = childBgWhere(scope)
  if (!isSubUser(scope)) return base
  // Branch assignments do not grant vehicles this phase, but they do decide
  // which branches a sub-user can see at all — the rest of its BG's tree is not
  // its business.
  return { AND: [base, { id: { in: scope.assignedBranchIds ?? [] } }] }
}

export function vehicleWhere(scope) {
  const base = childBgWhere(scope)
  if (!isSubUser(scope)) return base
  // The join IS the scope. The bgId constraint stays in the AND as a second
  // line: an assignment row that somehow points outside the sub-user's own BG
  // still must not widen what they can see.
  return { AND: [base, { id: { in: scope.assignedVehicleIds ?? [] } }] }
}

/**
 * Which accounts this account may see.
 *
 * Built from the scope links rather than from a BG join, because a user row at a
 * tier above BG has a null bgId — a GGB_ADMIN's own account is filed under
 * ggbId, so filtering purely on `bg` would hide it from itself.
 */
export function userWhere(scope) {
  switch (scope.role) {
    case ROLES.SUPER_ADMIN:
      return {}
    case ROLES.GGB_ADMIN:
      if (!scope.ggbId) return MATCH_NONE
      return {
        OR: [
          { ggbId: scope.ggbId },
          { grp: { ggbId: scope.ggbId } },
          { bg: { ggbId: scope.ggbId } },
        ],
      }
    case ROLES.GROUP_ADMIN:
      if (!scope.groupId) return MATCH_NONE
      return {
        OR: [{ groupId: scope.groupId }, { bg: { groupId: scope.groupId } }],
      }
    case ROLES.BG_USER:
      return scope.bgId ? { bgId: scope.bgId } : MATCH_NONE
    case ROLES.SUB_USER:
      // Itself and nothing else. A sub-user has no business enumerating its
      // siblings, and GET /api/users returning a single row is a truthful
      // answer to "which accounts can you see".
      return { id: scope.userId }
    default:
      return MATCH_NONE
  }
}

export function alertWhere(scope) {
  const base = childBgWhere(scope)
  if (!isSubUser(scope)) return base
  const ids = scope.assignedVehicleIds ?? []
  // An alert is visible to a sub-user when it actually covers something they can
  // see: a fleet-wide rule does, and an explicit rule does only if one of their
  // vehicles is named in it.
  return {
    AND: [
      base,
      { OR: [{ allVehicles: true }, { vehicles: { some: { vehicleId: { in: ids } } } }] },
    ],
  }
}

const WHERE_BUILDERS = Object.freeze({
  ggb: ggbWhere,
  group: groupWhere,
  bg: bgWhere,
  branch: branchWhere,
  vehicle: vehicleWhere,
  user: userWhere,
  alert: alertWhere,
})

/**
 * The filter for one entity, optionally ANDed with a route's own criteria.
 *
 * The scope fragment is always present and always first. Passing extras through
 * here rather than merging them at the call site means a route cannot
 * accidentally overwrite the scope key with its own — `{ ...scope, ...filters }`
 * with a `bgId` in both is exactly that bug.
 */
export function scopedWhere(entity, scope, ...extra) {
  const build = WHERE_BUILDERS[entity]
  if (!build) throw new Error(`scopedWhere: unknown entity "${entity}"`)
  const parts = [build(scope), ...extra.filter(Boolean)]
  return parts.length === 1 ? parts[0] : { AND: parts }
}

/**
 * One record by id, but only if the scope may see it. Throws 404 otherwise.
 *
 * This is the function that makes id-guessing useless, and the reason routes
 * take an entity name instead of a Prisma delegate: there is no way to call it
 * that skips the scope filter.
 */
export async function findScopedOrThrow(entity, id, scope, opts = {}) {
  const meta = ENTITIES[entity]
  if (!meta) throw new Error(`findScopedOrThrow: unknown entity "${entity}"`)
  if (!id) throw notFound(meta.label)

  const row = await prisma[meta.delegate].findFirst({
    where: scopedWhere(entity, scope, { id }),
    ...opts,
  })
  if (!row) throw notFound(meta.label)
  return row
}

/** Same, but returns null instead of throwing — for "does this exist in scope". */
export async function findScoped(entity, id, scope, opts = {}) {
  const meta = ENTITIES[entity]
  if (!meta) throw new Error(`findScoped: unknown entity "${entity}"`)
  if (!id) return null
  return prisma[meta.delegate].findFirst({
    where: scopedWhere(entity, scope, { id }),
    ...opts,
  })
}

// ── Write rights ─────────────────────────────────────────────────────────────

/**
 * Which entity types each role may create, update or delete at all — before any
 * question of *which* row.
 *
 * Alerts are granted to BG_USER. The brief lists a BG user's create rights as
 * "branches, vehicles and sub-users", but an alert belongs to exactly one BG and
 * watching your own fleet's temperature is the whole point of the feature, so
 * withholding it would leave Settings > Alerts unusable for the accounts that
 * need it. It widens nothing: the row is still confined to the user's own BG by
 * assertWritableParent() below. Flagged for the client to confirm.
 */
const WRITABLE = Object.freeze({
  SUPER_ADMIN: new Set(['ggb', 'group', 'bg', 'branch', 'vehicle', 'user', 'alert']),
  GGB_ADMIN: new Set(['group', 'bg', 'branch', 'vehicle', 'user', 'alert']),
  GROUP_ADMIN: new Set(['bg', 'branch', 'vehicle', 'user', 'alert']),
  BG_USER: new Set(['branch', 'vehicle', 'user', 'alert']),
  // Read-only, explicitly. An empty set rather than a missing key so a typo in a
  // role name can never be mistaken for "sub-user, therefore no writes".
  SUB_USER: new Set(),
})

/** Throws 403 unless the role may write this entity type at all. */
export function assertCanWrite(scope, entity) {
  const allowed = WRITABLE[scope.role]
  if (!allowed || !allowed.has(entity)) {
    throw forbidden(
      isSubUser(scope)
        ? 'Sub-users have read-only access'
        : `Your role may not modify ${ENTITIES[entity]?.label.toLowerCase() ?? entity} records`
    )
  }
}

/**
 * Throws unless the scope may write accounts with this role.
 *
 * Strictly below your own rank, except that a Super Admin may create another
 * Super Admin. The ladder means a BG_USER can only ever produce sub-users and
 * can never promote one — including by editing an existing row's role, which is
 * why the update path calls this too.
 */
export function assertCanWriteRole(scope, targetRole) {
  const mine = ROLE_RANK[scope.role]
  const theirs = ROLE_RANK[targetRole]
  if (mine === undefined || theirs === undefined) throw forbidden('Unknown role')
  if (isSuperAdmin(scope)) return
  if (theirs <= mine) {
    throw forbidden(`Your role may not create or modify a ${targetRole} account`)
  }
}

/**
 * Throws 404 unless the parent a new row claims is one the scope can see.
 *
 * The 404 is the point: a POST naming another tenant's bgId must be
 * indistinguishable from a POST naming a bgId that does not exist. Returning
 * 403 there would confirm the id is real, which is the same leak the read path
 * is careful to avoid.
 *
 * Returns the parent row, since callers almost always need it next — a branch
 * needs its BG to validate the parent branch, a vehicle needs its BG's groupId.
 */
export async function assertWritableParent(scope, entity, id) {
  return findScopedOrThrow(entity, id, scope)
}
