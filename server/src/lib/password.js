/**
 * Password hashing.
 *
 * bcryptjs rather than the native `bcrypt`: same algorithm and same $2a/$2b hash
 * format, but no node-gyp build step — which matters for a project developed on
 * Windows and deployed to a Linux droplet, where a native binding has to be
 * rebuilt on each and silently isn't when node_modules gets copied.
 */

import bcrypt from 'bcryptjs'
import env from '../env.js'

/**
 * What a newly created BG user or sub-user is handed, paired everywhere with
 * mustChangePassword = true. Env-driven (DEFAULT_USER_PASSWORD, default
 * Aa@123456) so a deployment can rotate it without a code change.
 */
export const DEFAULT_PASSWORD = env.DEFAULT_USER_PASSWORD

export const hashPassword = plain => bcrypt.hash(String(plain), env.bcryptRounds)

/**
 * Tolerant of a null/garbage hash on purpose: it returns false rather than
 * throwing, so a row with a corrupt hash fails the login instead of returning a
 * 500 that tells an attacker the account exists.
 */
export async function verifyPassword(plain, hash) {
  if (!hash || typeof hash !== 'string') return false
  try {
    return await bcrypt.compare(String(plain), hash)
  } catch {
    return false
  }
}

/**
 * Minimum shape for a password the user chooses themselves.
 *
 * Length only, deliberately. Character-class rules ("one upper, one digit, one
 * symbol") measurably push people toward Password1! and are not what the client
 * asked for; the length floor is the part that actually buys anything. Note the
 * default handed-out password satisfies this, so a fresh account can always log
 * in before changing it.
 */
export const PASSWORD_MIN_LENGTH = 8
