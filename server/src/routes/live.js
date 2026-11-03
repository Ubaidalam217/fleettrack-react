/**
 * GET /api/live/stream — live vehicle updates pushed to the website as they
 * arrive from the Flespi webhook (Server-Sent Events over a streamed response).
 *
 * The page opens it with its normal login token (a fetch stream, so the
 * Authorization header goes along). It gets:
 *   event: snapshot   every allowed device's current state, once
 *   event: update     the devices that changed, at most once a second
 *   event: unavailable  the webhook stopped delivering — fall back to polling
 * plus a comment every 25 s so proxies keep the connection open. The data is
 * the caller's own devices only (the same scope as the Flespi proxy), in the
 * same Flespi telemetry shape the polling already parses.
 *
 * 204 when our copy is not live (webhook off): the page simply keeps polling.
 * A stream closes itself after 30 minutes so the page reconnects with a fresh
 * scope (a vehicle assigned or removed meanwhile).
 */

import { Router } from 'express'
import { asyncHandler } from '../lib/http.js'
import { buildAcl } from '../lib/flespiGrant.js'
import { isServing, onTelemetry, telemetryItems } from '../lib/telemetry.js'

const router = Router()

const TICK_MS = 1000
const PING_MS = 25_000
const LIFETIME_MS = 30 * 60 * 1000

router.get(
  '/stream',
  asyncHandler(async (req, res) => {
    if (!isServing()) return res.status(204).end()
    const { deviceIds } = await buildAcl(req.scope) // null = every device (Super Admin)
    const allowed = deviceIds ? new Set(deviceIds) : null

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: pass each event through at once
    })
    res.flushHeaders?.()
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    send('snapshot', { result: telemetryItems(deviceIds) })

    const pending = new Set()
    const off = onTelemetry(rows => {
      for (const r of rows) if (!allowed || allowed.has(r.deviceId)) pending.add(r.deviceId)
    })
    const tick = setInterval(() => {
      if (!isServing()) {
        send('unavailable', {})
        res.end()
        return
      }
      if (!pending.size) return
      const ids = [...pending]
      pending.clear()
      send('update', { result: telemetryItems(ids) })
    }, TICK_MS)
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
    const life = setTimeout(() => res.end(), LIFETIME_MS)

    const cleanup = () => {
      off()
      clearInterval(tick)
      clearInterval(ping)
      clearTimeout(life)
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  })
)

export default router
