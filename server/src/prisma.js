/**
 * The one PrismaClient for this process.
 *
 * A module-level singleton rather than a client per request: each client holds
 * its own connection pool, and one-per-request exhausts Postgres' max
 * connections under the lightest load. The datasource URL is passed explicitly
 * instead of being read from DATABASE_URL by Prisma itself, so env.js stays the
 * single place that decides which database this process talks to — that is what
 * routes the test suite to TEST_DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client'
import env from './env.js'

export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
  // Queries are logged in development only. In test they would bury the
  // assertion output; in production they would log every value in every WHERE,
  // which for this schema includes email addresses.
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

export default prisma
