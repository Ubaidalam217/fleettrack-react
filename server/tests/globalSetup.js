/**
 * Brings the test database up to the current migrations, once per run.
 *
 * `migrate deploy` rather than `migrate dev`: deploy only applies what already
 * exists in prisma/migrations and never generates a new one, so a suite run can
 * never author a migration as a side effect — which is how an unreviewed
 * migration ends up in the repo.
 *
 * Runs in its own process before any test file, so the schema is in place before
 * the first PrismaClient connects.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config as loadDotenv } from 'dotenv'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default function setup() {
  loadDotenv({ path: path.join(serverRoot, '.env'), quiet: true })

  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Add it to server/.env — the suite truncates ' +
        'every table and must not run against the development database.'
    )
  }

  // Guard against the one mistake that is expensive: a TEST_DATABASE_URL copied
  // from DATABASE_URL and never edited.
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL and DATABASE_URL point at the same database. Refusing to ' +
        'run — the suite would empty your development data.'
    )
  }

  // DATABASE_URL is what the Prisma CLI reads; the app itself goes through env.js,
  // which picks TEST_DATABASE_URL when NODE_ENV=test. Overriding it for this child
  // process only keeps the two from disagreeing.
  //
  // NODE_ENV is forced back to development for the child: the Prisma CLI skips
  // parts of its work under NODE_ENV=test, and Vitest has already set it.
  const childEnv = { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' }

  /**
   * The CLI is invoked as `node node_modules/prisma/build/index.js` rather than
   * through npx.
   *
   * npx resolves through the npm cache, which on this machine lives on a drive the
   * sandbox cannot write to — and a global cache is a shared mutable dependency
   * for something that should only need files already in node_modules. Spawning
   * the entry point directly has neither problem and skips npx's startup.
   */
  const cli = path.join(serverRoot, 'node_modules', 'prisma', 'build', 'index.js')

  const run = (file, args) =>
    execFileSync(file, args, {
      cwd: serverRoot,
      env: childEnv,
      stdio: 'pipe',
      encoding: 'utf8',
    })

  try {
    if (existsSync(cli)) run(process.execPath, [cli, 'migrate', 'deploy'])
    else run('npx', ['prisma', 'migrate', 'deploy'])
  } catch (err) {
    // execFileSync's own message is just "Command failed"; the useful part is
    // Prisma's output, which otherwise disappears with the child process and
    // leaves "tests failed in globalSetup" and nothing else.
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`prisma migrate deploy failed:\n${detail || err.message}`)
  }
}
