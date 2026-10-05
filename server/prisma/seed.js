/**
 * Seeds exactly one account: the Super Admin, from the environment.
 *
 * Nothing else. No demo GGBs, no sample fleet — this database is the real one and
 * a seed that invents organisations leaves rows nobody can account for later. The
 * test fixtures live in tests/factories.js, against a different database.
 *
 *   npm run seed
 *
 * Idempotent: running it again updates the existing row's password rather than
 * failing on the unique email, which is how you recover a lost Super Admin
 * credential without touching the database by hand.
 */

import prisma from '../src/prisma.js'
import env from '../src/env.js'
import { hashPassword } from '../src/lib/password.js'
import { normalizeEmail } from '../src/lib/text.js'

async function main() {
  const email = normalizeEmail(env.SEED_SUPERADMIN_EMAIL)
  const password = env.SEED_SUPERADMIN_PASSWORD

  if (!email || !password) {
    throw new Error(
      'Set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD in server/.env before seeding.'
    )
  }

  const passwordHash = await hashPassword(password)

  const user = await prisma.user.upsert({
    where: { email },
    // Re-seeding resets the password and re-arms the first-login change. It does
    // not touch the role or the scope links, so it cannot be used to quietly
    // promote an existing account by putting its address in the env file.
    update: { passwordHash, mustChangePassword: true, status: 'Active' },
    create: {
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'Active',
      // Set even here: the password is in an env file that somebody typed, and
      // that is not a secret the account owner chose.
      mustChangePassword: true,
      shortName: 'Super Admin',
    },
    select: { id: true, email: true, role: true, mustChangePassword: true },
  })

  // The password is deliberately not echoed — whoever ran this already has it,
  // and a terminal scrollback is not where it should live.
  console.log(`[seed] Super Admin ready: ${user.email} (${user.role})`)
  console.log('[seed] mustChangePassword = true — change it on first login.')
}

main()
  .catch(err => {
    console.error('[seed] failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
