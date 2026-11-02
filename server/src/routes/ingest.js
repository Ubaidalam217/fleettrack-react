/**
 * POST /api/ingest/flespi — the webhook a Flespi HTTP Stream posts to.
 *
 * Flespi sends a JSON array of device messages per request (and retries a
 * batch that is not answered 2xx, keeping it meanwhile). Authenticated by a
 * shared secret, INGEST_TOKEN, sent as `Authorization: Bearer <token>` or as
 * `?token=` (whichever the stream is configured with). The endpoint is off
 * until INGEST_TOKEN is set.
 *
 * It answers as soon as the batch is queued (lib/telemetry.js writes it a
 * moment later in bulk), and answers 503 when the queue is full so Flespi
 * holds the messages and tries again — nothing is dropped.
 *
 * GET /api/ingest/flespi/status — counts for checking the stream works
 * (same token).
 */

import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import env from '../env.js'
import { canAccept, ingest, telemetryStats } from '../lib/telemetry.js'

const router = Router()

function tokenOk(req) {
  const want = env.INGEST_TOKEN
  if (!want) return false
  const header = String(req.get('authorization') ?? '')
  const got = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token ?? '')
  const a = Buffer.from(got)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

router.use((req, res, next) => {
  if (!env.INGEST_TOKEN) return res.status(404).json({ error: { message: 'Not found' } })
  if (!tokenOk(req)) return res.status(401).json({ error: { message: 'Bad ingest token' } })
  next()
})

router.post('/flespi', (req, res) => {
  if (!canAccept()) {
    res.set('Retry-After', '5')
    return res.status(503).json({ error: { message: 'Busy, retry' } })
  }
  const body = req.body
  const messages = Array.isArray(body) ? body : Array.isArray(body?.messages) ? body.messages : body && typeof body === 'object' ? [body] : []
  const { accepted, skipped } = ingest(messages)
  res.json({ data: { accepted, skipped } })
})

router.get('/flespi/status', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ data: telemetryStats() })
})

export default router
