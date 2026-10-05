/**
 * POST /api/auth/login
 * POST /api/auth/change-password
 * GET  /api/auth/me
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../prisma.js'
import { asyncHandler, unauthorized, badRequest } from '../lib/http.js'
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from '../lib/password.js'
import { signToken, verifyToken } from '../lib/jwt.js'
import { buildScope } from '../lib/scope.js'
import { ensureGrant } from '../lib/flespiGrant.js'
import { isConfigured as isFlespiConfigured } from '../lib/flespi.js'
import { normalizeEmail } from '../lib/text.js'
import { publicUser } from '../lib/serialize.js'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

/**
 * Mint the caller's Flespi grant for the login response, or return null.
 *
 * Wrapped in a catch-all because it is the one place a third-party call sits on the
 * authentication path. A sub-user whose Flespi token cannot be minted should still
 * get into the app and see an explicable "no live data" state, not a failed login.
 *
 * The scope is built from the row we just authenticated, including the assignment
 * joins — the same shape middleware/auth.js builds — so a sub-user's ACL is its
 * assigned vehicles and nothing wider.
 */
async function grantForLogin(user, jwt) {
  if (!isFlespiConfigured()) return null
  try {
    const withJoins = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, role: true, ggbId: true, groupId: true, bgId: true,
        vehicles: { select: { vehicleId: true } },
        branches: { select: { branchId: true } },
      },
    })
    const scope = buildScope(withJoins)
    const payload = verifyToken(jwt)
    const grant = await ensureGrant(withJoins, scope, payload?.exp ?? null)
    return {
      token: grant.token,
      expiresAt: grant.expiresAt.toISOString(),
      deviceCount: grant.deviceCount,
      unmatchedImeis: grant.unmatchedImeis,
    }
  } catch (err) {
    // Logged, not thrown. The client has a working session and a documented
    // fallback; losing live data for one request is not worth failing the login.
    console.warn('[auth] could not mint a Flespi grant at login:', err?.message)
    return null
  }
}

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').transform(normalizeEmail),
  password: z.string().min(1, 'Password is required'),
})

/**
 * Login.
 *
 * Every failure — unknown email, wrong password, deactivated account — answers
 * the same 401 with the same text. Distinguishing them turns the endpoint into
 * an account-existence oracle, which is the first thing credential stuffing
 * wants. Rate limiting is applied where this router is mounted (app.js).
 */
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body

    const user = await prisma.user.findUnique({ where: { email } })

    // Compared even when there is no such user, against a hash that cannot
    // match. Returning early on an unknown email makes the response
    // measurably faster than a wrong password for a real one, and that timing
    // difference is itself the oracle this endpoint is trying not to be.
    const ok = await verifyPassword(
      password,
      user?.passwordHash ?? '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
    )

    if (!user || !ok || user.status !== 'Active') {
      throw unauthorized('Invalid email or password')
    }

    const token = signToken(user)

    res.json({
      token,
      tokenType: 'Bearer',
      user: publicUser(user),
      // Also on the user object; duplicated at the top level because it is the
      // one flag the client has to branch on immediately after a login.
      mustChangePassword: user.mustChangePassword,
      /**
       * The caller's limited Flespi token, so the Live Map has live data from the
       * first render instead of after a second round trip.
       *
       * BEST EFFORT, and null on any failure. Authentication must not depend on a
       * third party being reachable: if Flespi is down or unconfigured, signing in
       * still works and the client falls back to POST /api/flespi/token, which is
       * the same call it uses for refresh anyway. Making login await a mandatory
       * Flespi call would mean a Flespi outage locked everyone out of the app.
       */
      flespi: await grantForLogin(user, token),
    })
  })
)

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `New password must be at least ${PASSWORD_MIN_LENGTH} characters`),
  })
  .refine(v => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  })

/**
 * Change own password, and clear the first-login flag.
 *
 * Mounted on this router *before* requirePasswordChanged is applied in app.js —
 * an account that must change its password has to be able to reach exactly this
 * one endpoint and nothing else.
 *
 * The current password is required even though the caller already holds a valid
 * token: a token lifted from a logged-in browser must not be enough to lock the
 * real owner out of their own account.
 */
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, passwordHash: true },
    })
    if (!user) throw unauthorized('Invalid or expired token')

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      // 400 rather than 401: the token is fine, the supplied password is not, and
      // a 401 here would make a client think its session had expired.
      throw badRequest('Current password is incorrect', {
        currentPassword: 'Incorrect password',
      })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    })

    res.json({
      // A fresh token so the client's cached copy of the profile — the old one
      // claims mustChangePassword — cannot outlive the change.
      token: signToken(updated),
      tokenType: 'Bearer',
      user: publicUser(updated),
      mustChangePassword: false,
    })
  })
)

/**
 * The current account, its role and its scope.
 *
 * Reachable while mustChangePassword is set, so a client can render "you must
 * change your password" with the user's name on it.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      user: publicUser(req.user),
      role: req.user.role,
      scope: {
        ggbId: req.user.ggbId ?? null,
        groupId: req.user.groupId ?? null,
        bgId: req.user.bgId ?? null,
        ...(req.user.role === 'SUB_USER'
          ? {
              vehicleIds: req.scope.assignedVehicleIds,
              branchIds: req.scope.assignedBranchIds,
            }
          : {}),
      },
      mustChangePassword: req.user.mustChangePassword,
    })
  })
)

export default router
