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
import { signToken } from '../lib/jwt.js'
import { normalizeEmail } from '../lib/text.js'
import { publicUser } from '../lib/serialize.js'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

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

    res.json({
      token: signToken(user),
      tokenType: 'Bearer',
      user: publicUser(user),
      // Also on the user object; duplicated at the top level because it is the
      // one flag the client has to branch on immediately after a login.
      mustChangePassword: user.mustChangePassword,
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
