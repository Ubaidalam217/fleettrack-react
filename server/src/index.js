/**
 * Process entry: start listening, and stop cleanly.
 */

import env from './env.js'
import prisma from './prisma.js'
import { createApp } from './app.js'

const app = createApp()

const server = app.listen(env.PORT, () => {
  console.log(`[fleetmax] API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  console.log(
    env.FRONTEND_ORIGINS.length
      ? `[fleetmax] CORS allowlist: ${env.FRONTEND_ORIGINS.join(', ')}`
      : '[fleetmax] CORS allowlist is empty — no browser origin may call this API'
  )
})

/**
 * Graceful shutdown.
 *
 * Closing the HTTP server before disconnecting Prisma, so an in-flight request
 * finishes against a live connection instead of failing on a pool that was pulled
 * out from under it. The timeout is the backstop for a hung connection: a process
 * that will not exit is worse than one that exits abruptly, because a supervisor
 * cannot restart it.
 */
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[fleetmax] ${signal} received, shutting down`)

  const forceExit = setTimeout(() => {
    console.error('[fleetmax] shutdown timed out, exiting')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  server.close(async () => {
    await prisma.$disconnect().catch(() => {})
    clearTimeout(forceExit)
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// A rejection nobody handled has already left some request in an unknown state.
// Logging and exiting lets the supervisor restart into a known one; swallowing it
// leaves the process running with corrupt state, which is harder to diagnose.
process.on('unhandledRejection', reason => {
  console.error('[fleetmax] unhandled rejection', reason)
  shutdown('unhandledRejection')
})
