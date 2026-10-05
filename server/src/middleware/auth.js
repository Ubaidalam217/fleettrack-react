/**
 * Who is calling, and what they can see.
 *
 * The user row is re-read from the database on every request rather than being
 * trusted from the token's claims. It costs one indexed primary-key lookup and
 * it is what makes a deactivated account, a changed role or a narrowed sub-user
 * assignment take effect immediately instead of whenever that account's token
 * happens to expire — up to JWT_EXPIRES_IN later, during which a just-revoked
 * sub-user would keep seeing its old vehicle list.
 */

import prisma from '../prisma.js'
import { bearerFrom, verifyToken } from '../lib/jwt.js'
import { buildScope, ROLES } from '../lib/scope.js'
import { asyncHandler, forbidden, unauthorized } from '../lib/http.js'

/** Everything the scope builder and the profile serialiser need, and no hash. */
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  shortName: true,
  mobile: true,
  ggbId: true,
  groupId: true,
  bgId: true,
  createdAt: true,
  updatedAt: true,
}

/**
 * Verifies the bearer token and attaches `req.user` + `req.scope`.
 *
 * Every failure mode answers 401 with the same wording. "No such account",
 * "wrong password" and "account disabled" are all information about who exists,
 * and the login route is equally careful for the same reason.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearerFrom(req.headers.authorization)
  if (!token) throw unauthorized('Missing bearer token')

  const payload = verifyToken(token)
  if (!payload?.sub) throw unauthorized('Invalid or expired token')

  const user = await prisma.user.findUnique({
    where: { id: String(payload.sub) },
    select: {
      ...USER_SELECT,
      // Only a sub-user's scope reads these, but selecting them unconditionally
      // keeps one query shape — and for every other role the two joins are
      // empty, so there is nothing to fetch.
      vehicles: { select: { vehicleId: true } },
      branches: { select: { branchId: true } },
    },
  })

  if (!user) throw unauthorized('Invalid or expired token')
  if (user.status !== 'Active') throw forbidden('This account is inactive')

  req.user = user
  req.scope = buildScope(user)
  next()
})

/**
 * Blocks every route except change-password while mustChangePassword is set.
 *
 * Mounted once in app.js after requireAuth rather than being remembered on each
 * route, because a first-login account that can still read the API has not
 * really been forced to do anything. 428 Precondition Required is the status the
 * frontend can branch on without string-matching the message.
 */
export const requirePasswordChanged = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    const err = new Error('Password change required before using the API')
    err.status = 428
    err.code = 'PASSWORD_CHANGE_REQUIRED'
    return next(err)
  }
  next()
}

/** Restricts a route to an explicit set of roles. Scope filters still apply. */
export const requireRole = (...roles) => {
  const allowed = new Set(roles)
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    if (!allowed.has(req.user.role)) {
      return next(forbidden('Your role may not perform this action'))
    }
    next()
  }
}

/** Shorthand used by the write routes that are closed to sub-users outright. */
export const denySubUsers = (req, _res, next) => {
  if (req.user?.role === ROLES.SUB_USER) {
    return next(forbidden('Sub-users have read-only access'))
  }
  next()
}

export { USER_SELECT }
