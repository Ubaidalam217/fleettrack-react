/**
 * Environment, loaded and validated once.
 *
 * Everything the server reads from the outside world arrives through this
 * module. Validation happens at import time and a bad value is a hard crash on
 * boot rather than an undefined read somewhere in a request handler at 3am —
 * which matters most for JWT_SECRET, where `undefined` would not fail loudly,
 * it would quietly sign tokens that anyone can forge.
 *
 * Deployment target is DigitalOcean (Phase 5), so there is no hardcoded host,
 * port, origin or credential anywhere below — only defaults that are safe for a
 * developer machine.
 */

import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..')

// server/.env, regardless of the cwd the process was started from — `npm test`
// from the repo root and `npm start` from server/ must read the same file.
loadDotenv({ path: path.join(serverRoot, '.env'), quiet: true })

/** Comma- or whitespace-separated list → trimmed, de-duped array. */
const csv = z
  .string()
  .default('')
  .transform(v =>
    [...new Set(v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean))]
  )

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Only read when NODE_ENV=test, and required there. A separate variable
   * rather than "point DATABASE_URL at the test database when testing" because
   * the test suite truncates every table it touches — one mistyped export
   * should not be able to empty the development database.
   */
  TEST_DATABASE_URL: z.string().optional(),

  /**
   * 32 chars minimum. Short secrets are the one JWT misconfiguration that still
   * verifies correctly in every test and fails only against someone trying.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  /**
   * CORS allowlist. Empty means "no browser origin is allowed", which is the
   * correct default for a fresh deployment — a missing variable must not mean
   * `*` once the thing is on the public internet.
   */
  FRONTEND_ORIGINS: csv,

  /** The one account the seed creates. Placeholders live in .env.example. */
  SEED_SUPERADMIN_EMAIL: z.string().email().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().min(8).optional(),

  /**
   * Handed to every newly created BG user and sub-user, together with
   * mustChangePassword = true. Env-driven so a deployment can rotate it without
   * a code change; the frontend shows the same constant on its forms.
   */
  DEFAULT_USER_PASSWORD: z.string().min(8).default('Aa@123456'),

  /**
   * 12 is the production figure. The test suite overrides it to 4 — the suite
   * hashes ~20 passwords per run and bcrypt cost is deliberately, measurably
   * slow, so leaving it at 12 adds minutes that prove nothing about scoping.
   */
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  // Thrown, not process.exit: a test importing this module should see the
  // reason, and a supervisor restarting the process should see it in the log.
  throw new Error(`Invalid server environment:\n${issues}`)
}

const raw = parsed.data

const isTest = raw.NODE_ENV === 'test'

if (isTest && !raw.TEST_DATABASE_URL) {
  throw new Error(
    'NODE_ENV=test requires TEST_DATABASE_URL. Refusing to run the suite ' +
      'against DATABASE_URL — the suite truncates every table.'
  )
}

export const env = Object.freeze({
  ...raw,
  isTest,
  isProduction: raw.NODE_ENV === 'production',
  /** The URL any Prisma client in this process should actually connect to. */
  databaseUrl: isTest ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
  bcryptRounds: isTest ? 4 : raw.BCRYPT_ROUNDS,
})

export default env
