/**
 * /api/users — login accounts at every tier, plus sub-user assignment.
 *
 * One router for all roles because the row is one table: what differs between a
 * BG user and a sub-user is which scope link is set and which joins are
 * populated, not the lifecycle.
 *
 * Two rules worth stating up front:
 *
 *  - You may only create or modify an account at a role strictly below your own
 *    (ROLE_RANK in lib/scope.js). That is what stops a BG user minting a second
 *    BG user, and what stops it promoting one of its own sub-users — the same
 *    check runs on update, where the escalation would otherwise live.
 *
 *  - A sub-user cannot write here at all, including to its own row. It changes
 *    its password through /api/auth/change-password and nothing else. Letting an
 *    account edit its own `role` or `bgId` is the shortest path out of a scope
 *    that every other check in this codebase is built to hold.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, badRequest, conflict, forbidden } from '../lib/http.js'
import {
  idList,
  jsonObject,
  jsonValue,
  optionalId,
  optionalText,
  requiredEmail,
  statusField,
} from '../lib/fields.js'
import { DEFAULT_PASSWORD, hashPassword, PASSWORD_MIN_LENGTH } from '../lib/password.js'
import { publicUser } from '../lib/serialize.js'
import {
  assertCanWrite,
  assertCanWriteRole,
  assertWritableParent,
  findScopedOrThrow,
  ROLES,
  scopedWhere,
} from '../lib/scope.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const roleField = z.enum([
  ROLES.SUPER_ADMIN,
  ROLES.GGB_ADMIN,
  ROLES.GROUP_ADMIN,
  ROLES.BG_USER,
  ROLES.SUB_USER,
])

/** The sub-user tab blobs. Carried verbatim; nothing server-side reads them. */
const tabFields = {
  userSetting: jsonObject(),
  authentication: jsonValue(),
  sso: jsonValue(),
  screenAccess: jsonObject(),
  myAccount: jsonObject(),
}

const createSchema = z.object({
  email: requiredEmail('Email'),
  role: roleField,
  /**
   * Optional. Omitted means DEFAULT_USER_PASSWORD (Aa@123456) — the value the
   * operator is expected to hand over. Either way mustChangePassword is set, so
   * there is no path that produces an account whose first password is permanent.
   */
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .optional(),
  shortName: optionalText(120),
  mobile: optionalText(40),
  status: statusField(),

  // Exactly one of these must match the role — see assertScopeLinks().
  ggbId: optionalId(),
  groupId: optionalId(),
  bgId: optionalId(),

  // Sub-users only; ignored (and rejected if non-empty) for other roles.
  vehicleIds: idList(),
  branchIds: idList(),

  ...tabFields,
})

/**
 * Update.
 *
 * No `password` and no `email`. The password has its own endpoints (the owner's
 * /api/auth/change-password, an admin's POST :id/reset-password) so that a
 * profile edit can never silently re-hash a credential. The email is the login
 * username and the BG's email of record; changing it is an account migration, not
 * a field edit, and the frontend's form renders it read-only for the same reason.
 */
const updateSchema = z.object({
  role: roleField,
  shortName: optionalText(120),
  mobile: optionalText(40),
  status: statusField(),
  ggbId: optionalId(),
  groupId: optionalId(),
  bgId: optionalId(),
  ...tabFields,
})

const listQuerySchema = z.object({
  bgId: z.string().trim().min(1).optional(),
  role: roleField.optional(),
})

const assignmentSchema = z.object({ ids: idList() })

const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .optional(),
})

const USER_INCLUDE = {
  vehicles: { select: { vehicleId: true } },
  branches: { select: { branchId: true } },
}

/** Throws 409 if the email is taken. Comparison is on the normalised value. */
async function assertEmailFree(email, exceptId = null) {
  const clash = await prisma.user.findFirst({
    where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw conflict('That email address is already used by another account', {
      email: 'Already in use',
    })
  }
}

/**
 * Validates the scope links against the role, and that the caller can see the
 * parent each one names.
 *
 * Returns the triple to write — with the irrelevant two forced to null rather
 * than whatever the client happened to send. A BG user row carrying a leftover
 * ggbId would be read by bgWhere() as a BG user (bgId wins the switch) but would
 * confuse every later reader of the row, and a role change would turn the stale
 * value live.
 */
async function assertScopeLinks(scope, role, body) {
  switch (role) {
    case ROLES.SUPER_ADMIN:
      return { ggbId: null, groupId: null, bgId: null }

    case ROLES.GGB_ADMIN: {
      if (!body.ggbId) throw badRequest('A GGB admin needs a GGB', { ggbId: 'Required' })
      const ggb = await assertWritableParent(scope, 'ggb', body.ggbId)
      return { ggbId: ggb.id, groupId: null, bgId: null }
    }

    case ROLES.GROUP_ADMIN: {
      if (!body.groupId) throw badRequest('A group admin needs a group', { groupId: 'Required' })
      const group = await assertWritableParent(scope, 'group', body.groupId)
      return { ggbId: null, groupId: group.id, bgId: null }
    }

    case ROLES.BG_USER:
    case ROLES.SUB_USER: {
      if (!body.bgId) {
        throw badRequest('This role needs a business group', { bgId: 'Required' })
      }
      const bg = await assertWritableParent(scope, 'bg', body.bgId)
      return { ggbId: null, groupId: null, bgId: bg.id }
    }

    default:
      throw badRequest('Unknown role', { role: 'Invalid' })
  }
}

/**
 * Narrows a list of vehicle ids to the ones in `bgId`, or throws.
 *
 * Checked against the sub-user's own BG rather than the caller's scope: the rule
 * is "a sub-user can only be assigned vehicles from its own BG", and a Super
 * Admin — who can see every vehicle — must not be able to hand a sub-user a
 * vehicle from a different tenant. The error names the offending ids so the form
 * can point at them.
 */
async function resolveAssignableVehicles(bgId, ids) {
  if (!ids.length) return []
  const rows = await prisma.vehicle.findMany({
    where: { id: { in: ids }, bgId },
    select: { id: true },
  })
  if (rows.length !== ids.length) {
    const found = new Set(rows.map(r => r.id))
    throw badRequest('Vehicles must belong to the sub-user’s own business group', {
      vehicleIds: `Not in this business group: ${ids.filter(id => !found.has(id)).join(', ')}`,
    })
  }
  return rows.map(r => r.id)
}

/** Same for branches. */
async function resolveAssignableBranches(bgId, ids) {
  if (!ids.length) return []
  const rows = await prisma.branch.findMany({
    where: { id: { in: ids }, bgId },
    select: { id: true },
  })
  if (rows.length !== ids.length) {
    const found = new Set(rows.map(r => r.id))
    throw badRequest('Branches must belong to the sub-user’s own business group', {
      branchIds: `Not in this business group: ${ids.filter(id => !found.has(id)).join(', ')}`,
    })
  }
  return rows.map(r => r.id)
}

// ── Read ─────────────────────────────────────────────────────────────────────

router.get(
  '/',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { bgId, role } = req.validatedQuery
    const rows = await prisma.user.findMany({
      where: scopedWhere('user', req.scope, bgId ? { bgId } : null, role ? { role } : null),
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      include: USER_INCLUDE,
    })
    res.json({ data: rows.map(publicUser) })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await findScopedOrThrow('user', req.params.id, req.scope, {
      include: USER_INCLUDE,
    })
    res.json({ data: publicUser(row) })
  })
)

// ── Write ────────────────────────────────────────────────────────────────────

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    assertCanWriteRole(req.scope, req.body.role)
    await assertEmailFree(req.body.email)

    const links = await assertScopeLinks(req.scope, req.body.role, req.body)

    const isSub = req.body.role === ROLES.SUB_USER
    if (!isSub && (req.body.vehicleIds.length || req.body.branchIds.length)) {
      // A BG user already sees every vehicle in its BG; an assignment list on one
      // would be stored and then never read, which reads on screen as a
      // restriction that is not actually in force.
      throw badRequest('Only sub-users take vehicle or branch assignments', {
        vehicleIds: 'Not applicable to this role',
      })
    }

    const vehicleIds = isSub ? await resolveAssignableVehicles(links.bgId, req.body.vehicleIds) : []
    const branchIds = isSub ? await resolveAssignableBranches(links.bgId, req.body.branchIds) : []

    const row = await prisma.user.create({
      data: {
        email: req.body.email,
        passwordHash: await hashPassword(req.body.password ?? DEFAULT_PASSWORD),
        // Always, on every create. An account's first password was handed to it
        // by somebody else, so it is not a secret yet whichever way it was set.
        mustChangePassword: true,
        role: req.body.role,
        status: req.body.status,
        shortName: req.body.shortName,
        mobile: req.body.mobile,
        ...links,
        userSetting: req.body.userSetting ?? undefined,
        authentication: req.body.authentication ?? undefined,
        sso: req.body.sso ?? undefined,
        screenAccess: req.body.screenAccess ?? undefined,
        myAccount: req.body.myAccount ?? undefined,
        vehicles: { create: vehicleIds.map(vehicleId => ({ vehicleId })) },
        branches: { create: branchIds.map(branchId => ({ branchId })) },
      },
      include: USER_INCLUDE,
    })

    res.status(201).json({
      data: publicUser(row),
      // Echoed only when the server chose it, so an operator knows what to hand
      // over. Never the hash, and never a password the caller supplied itself.
      ...(req.body.password ? {} : { defaultPassword: DEFAULT_PASSWORD }),
    })
  })
)

router.put(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    const existing = await findScopedOrThrow('user', req.params.id, req.scope)

    // Both sides of a role change: you must outrank what it is now AND what it is
    // becoming. Checking only the target would let a BG user demote a peer to
    // sub-user and then own it.
    assertCanWriteRole(req.scope, existing.role)
    assertCanWriteRole(req.scope, req.body.role)

    const links = await assertScopeLinks(req.scope, req.body.role, req.body)

    // Moving a sub-user to another BG while it still holds assignments would
    // leave it pointing at vehicles it is no longer allowed to see. Rather than
    // silently dropping them, refuse and let the caller clear them first.
    if (existing.bgId && links.bgId && existing.bgId !== links.bgId) {
      const held = await prisma.subuserVehicle.count({ where: { userId: existing.id } })
      if (held) {
        throw badRequest(
          'Clear this account’s vehicle assignments before moving it to another business group',
          { bgId: 'Account still has vehicle assignments' }
        )
      }
    }

    const row = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: req.body.role,
        status: req.body.status,
        shortName: req.body.shortName,
        mobile: req.body.mobile,
        ...links,
        userSetting: req.body.userSetting ?? undefined,
        authentication: req.body.authentication ?? undefined,
        sso: req.body.sso ?? undefined,
        screenAccess: req.body.screenAccess ?? undefined,
        myAccount: req.body.myAccount ?? undefined,
        // Role changed away from sub-user: the assignments are meaningless on the
        // new role and would be read by nothing, so they go rather than linger.
        ...(req.body.role !== ROLES.SUB_USER
          ? { vehicles: { deleteMany: {} }, branches: { deleteMany: {} } }
          : {}),
      },
      include: USER_INCLUDE,
    })

    res.json({ data: publicUser(row) })
  })
)

/**
 * Put the account back on the default password with mustChangePassword set.
 *
 * Separate from PUT so a profile edit cannot reset a credential as a side effect,
 * and so the response can carry the password to hand over exactly once.
 */
router.post(
  '/:id/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    const existing = await findScopedOrThrow('user', req.params.id, req.scope)
    assertCanWriteRole(req.scope, existing.role)

    const password = req.body.password ?? DEFAULT_PASSWORD
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    })

    res.json({ data: { id: existing.id, mustChangePassword: true, password } })
  })
)

/**
 * Replace a sub-user's vehicle assignment wholesale.
 *
 * A PUT of the full set rather than add/remove endpoints, because the frontend's
 * panel is a checkbox list whose state is the whole set — and because two
 * concurrent "add" calls from the same panel would otherwise interleave into a
 * set neither operator chose.
 */
router.put(
  '/:id/vehicles',
  validate(assignmentSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    const existing = await findScopedOrThrow('user', req.params.id, req.scope)
    assertCanWriteRole(req.scope, existing.role)

    if (existing.role !== ROLES.SUB_USER) {
      throw forbidden('Only sub-users take vehicle assignments')
    }

    const vehicleIds = await resolveAssignableVehicles(existing.bgId, req.body.ids)

    // One transaction: a half-applied replacement is a sub-user that can see
    // nothing (deletes landed, creates did not), which looks exactly like a
    // permissions bug to whoever is logged in as them at the time.
    const row = await prisma.$transaction(async tx => {
      await tx.subuserVehicle.deleteMany({ where: { userId: existing.id } })
      if (vehicleIds.length) {
        await tx.subuserVehicle.createMany({
          data: vehicleIds.map(vehicleId => ({ userId: existing.id, vehicleId })),
        })
      }
      return tx.user.findUnique({ where: { id: existing.id }, include: USER_INCLUDE })
    })

    res.json({ data: publicUser(row) })
  })
)

/** Same for branches. Stored, but not a grant of the branch's vehicles. */
router.put(
  '/:id/branches',
  validate(assignmentSchema),
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    const existing = await findScopedOrThrow('user', req.params.id, req.scope)
    assertCanWriteRole(req.scope, existing.role)

    if (existing.role !== ROLES.SUB_USER) {
      throw forbidden('Only sub-users take branch assignments')
    }

    const branchIds = await resolveAssignableBranches(existing.bgId, req.body.ids)

    const row = await prisma.$transaction(async tx => {
      await tx.subuserBranch.deleteMany({ where: { userId: existing.id } })
      if (branchIds.length) {
        await tx.subuserBranch.createMany({
          data: branchIds.map(branchId => ({ userId: existing.id, branchId })),
        })
      }
      return tx.user.findUnique({ where: { id: existing.id }, include: USER_INCLUDE })
    })

    res.json({ data: publicUser(row) })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    assertCanWrite(req.scope, 'user')
    const existing = await findScopedOrThrow('user', req.params.id, req.scope)
    assertCanWriteRole(req.scope, existing.role)

    // The rank rule already covers this for every role except Super Admin, which
    // outranks nothing and would otherwise be able to delete the only account
    // that can create another one.
    if (existing.id === req.scope.userId) {
      throw forbidden('You cannot delete your own account')
    }

    await prisma.user.delete({ where: { id: existing.id } })
    res.json({ data: { id: existing.id } })
  })
)

export default router
