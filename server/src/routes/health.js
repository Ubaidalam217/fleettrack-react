/**
 * GET /api/health — unauthenticated.
 *
 * Checks the database, not just the process. A health check that only proves
 * Express is listening will report healthy through an exhausted connection pool
 * or a failed-over database, which is the exact outage a load balancer needs it
 * to catch. `SELECT 1` is the cheapest query that cannot be answered without a
 * live connection.
 */

import { Router } from 'express'
import prisma from '../prisma.js'

const router = Router()

router.get('/', async (_req, res) => {
  const startedAt = process.hrtime.bigint()
  try {
    await prisma.$queryRaw`SELECT 1`
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
    res.json({
      status: 'ok',
      database: { reachable: true, latencyMs: Math.round(ms * 100) / 100 },
      uptimeSeconds: Math.round(process.uptime()),
    })
  } catch (err) {
    // 503 rather than 500: the service is up but not ready, which is the
    // distinction an orchestrator acts on. The reason is included but not the
    // stack — this endpoint is public.
    res.status(503).json({
      status: 'degraded',
      database: { reachable: false, error: err?.message ?? 'unreachable' },
      uptimeSeconds: Math.round(process.uptime()),
    })
  }
})

export default router
