/**
 * POST /api/assistant — the in-app AI assistant, for the self-hosted frontend.
 *
 * The Netlify build answers this through netlify/functions/ai-assistant.mjs. On
 * the VPS there is no Netlify, so the same handler is mounted here unchanged
 * (one copy of the prompt and the Gemini call), behind the normal login. The
 * key is GEMINI_API_KEY in server/.env; without it the handler answers 503 with
 * its generic "unavailable" message and nothing else breaks.
 */

import { Router } from 'express'
import { asyncHandler } from '../lib/http.js'
import { handler } from '../../../netlify/functions/ai-assistant.mjs'

const router = Router()

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const out = await handler({ httpMethod: 'POST', body: JSON.stringify(req.body ?? {}) })
    res.status(out.statusCode).set(out.headers ?? {}).send(out.body)
  })
)

export default router
