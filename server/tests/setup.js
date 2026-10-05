/**
 * Per-file test setup: assert we are on the test database, and clean up after.
 */

import { afterAll, beforeAll } from 'vitest'
import prisma from '../src/prisma.js'
import env from '../src/env.js'

beforeAll(() => {
  // env.js already refuses to run with NODE_ENV=test and no TEST_DATABASE_URL.
  // This is the second check, on the value actually handed to Prisma — the one
  // that would do the damage if the two ever came apart.
  if (!env.isTest) throw new Error(`Tests must run with NODE_ENV=test (got ${env.NODE_ENV})`)
  if (env.databaseUrl !== env.TEST_DATABASE_URL) {
    throw new Error('Prisma is not pointed at TEST_DATABASE_URL. Refusing to run.')
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
