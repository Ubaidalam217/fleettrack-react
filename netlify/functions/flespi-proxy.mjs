/**
 * Flespi proxy for the Netlify demo — the browser's only way to Flespi.
 *
 * WHY THIS EXISTS: the client asked for ONE Flespi key. The demo used to ship a
 * read-only Flespi token inside the public JS bundle; now no Flespi token reaches
 * the browser at all. The key lives only in this function's environment
 * (Netlify env var FLESPI_TOKEN, marked secret, functions scope) and every request
 * from the page is forwarded here with it added.
 *
 * The demo is READ-ONLY, exactly as the old bundled token was: only GET, and only
 * under gw/devices. Anything else is refused before Flespi is contacted, so the
 * key's wider powers can never be reached from the internet through this door.
 *
 * Route: netlify.toml sends /flespi/* here; the original path arrives in
 * event.path (or after the function name when called directly).
 */

const FLESPI = 'https://flespi.io'
const TIMEOUT_MS = 25_000
const ALLOWED = /^\/gw\/devices\/[A-Za-z0-9,]+(?:\/[A-Za-z0-9_.,%-]+)*$/

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
})

/** "/flespi/gw/devices/all" or "/.netlify/functions/flespi-proxy/gw/devices/all" → "/gw/devices/all" */
function flespiPath(eventPath = '') {
  const p = eventPath.replace(/^\/\.netlify\/functions\/flespi-proxy/, '').replace(/^\/flespi/, '')
  return p.startsWith('/') ? p : `/${p}`
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { errors: [{ reason: 'The demo is read-only.' }] })
  }

  const key = process.env.FLESPI_TOKEN
  if (!key) return json(503, { errors: [{ reason: 'Live tracking is not configured.' }] })

  const path = flespiPath(event.path)
  if (!ALLOWED.test(path)) return json(404, { errors: [{ reason: 'Not found.' }] })

  const query = event.rawQuery ? `?${event.rawQuery}` : ''
  let res
  try {
    res = await fetch(`${FLESPI}${path}${query}`, {
      headers: { Authorization: `FlespiToken ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return json(502, { errors: [{ reason: 'Flespi is unreachable right now.' }] })
  }

  return {
    statusCode: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
    body: await res.text(),
  }
}
