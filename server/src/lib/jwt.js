/**
 * Token issue and verify.
 *
 * The payload carries the user id and nothing else that matters. Role and scope
 * are deliberately NOT trusted from the token at authorisation time — the auth
 * middleware re-reads the user row on every request (see middleware/auth.js).
 * They are included only so a client can decode them for display without a
 * round-trip.
 */

import jwt from 'jsonwebtoken'
import env from '../env.js'

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      // Display hints only. Nothing server-side reads these back.
      role: user.role,
      email: user.email,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  )
}

/** The decoded payload, or null for anything that does not verify. */
export function verifyToken(token) {
  try {
    return jwt.verify(String(token), env.JWT_SECRET)
  } catch {
    return null
  }
}

/** `Authorization: Bearer <token>` → token, or null. Case-insensitive scheme. */
export function bearerFrom(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header ?? '').trim())
  return m ? m[1].trim() : null
}
