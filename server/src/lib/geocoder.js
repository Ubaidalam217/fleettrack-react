/**
 * Reverse geocoding with a shared Postgres cache (the GeocodeCache table).
 *
 * The browser used to call Nominatim directly and cache in its own
 * localStorage, so every new machine — the client's included — re-did a
 * fleet-day's ~2,000 lookups at 1 per second. Here the cache is shared by
 * every user, and the throttle is process-wide, so the public Nominatim's
 * 1 request/second policy holds no matter how many people generate reports at
 * once.
 *
 * The geocoder is configurable (env GEOCODER_*): pointing it at a self-hosted
 * Nominatim/Photon with no interval and a few lanes is what turns "fill in the
 * addresses" from minutes into seconds.
 */

import env from '../env.js'
import prisma from '../prisma.js'

/** Same rounding as the frontend's geocodeKey(): 4 dp, ~11 m. */
export function geocodeKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`
}

// ── process-wide throttle ────────────────────────────────────────────────────
//
// Up to GEOCODER_CONCURRENCY lookups run at once, and no two START closer than
// GEOCODER_MIN_INTERVAL_MS apart. With the defaults (1 lane, 1100 ms) that is
// Nominatim's policy exactly.

let active = 0
let lastStart = 0
const waiting = []

function pump() {
  while (active < env.GEOCODER_CONCURRENCY && waiting.length) {
    const wait = lastStart + env.GEOCODER_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) {
      setTimeout(pump, wait)
      return
    }
    lastStart = Date.now()
    active += 1
    const { task, resolve, reject } = waiting.shift()
    task().then(resolve, reject).finally(() => {
      active -= 1
      pump()
    })
  }
}

function throttled(task) {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject })
    pump()
  })
}

/**
 * One lookup against the configured geocoder.
 *
 * @returns {Promise<string|null>} the address, or null when the geocoder
 *          answered but has nothing for the point
 * @throws  on a network error, timeout or non-2xx — never cached
 */
async function lookup(lat, lng) {
  // accept-language=en: without it Nominatim answers in the local script, which
  // for this fleet's region means Arabic in every row of the report.
  const url = `${env.GEOCODER_URL.replace(/\/+$/, '')}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0&accept-language=en`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Nominatim's usage policy requires an identifying User-Agent.
      'User-Agent': 'FleetmaX-tracking-backend/1.0',
    },
    signal: AbortSignal.timeout(env.GEOCODER_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Geocoder answered ${res.status}`)
  const json = await res.json()
  return typeof json?.display_name === 'string' ? json.display_name : null
}

/**
 * Addresses for many points: cache first, then up to `resolve` live lookups
 * for the points the cache does not have, stopping early at `budgetMs`.
 *
 * @param {{lat:number,lng:number}[]} points  in the order the caller wants them resolved
 * @param {{resolve?: number, budgetMs?: number}} [opts]
 * @returns {Promise<{addresses: Record<string,string|null>, pending: number}>}
 *          `addresses` holds every key now known (null = no address exists);
 *          `pending` counts keys still unknown
 */
export async function reverseGeocodePoints(points, { resolve = 0, budgetMs = 20000 } = {}) {
  const startedAt = Date.now()

  const order = []
  const coordsByKey = new Map()
  for (const { lat, lng } of points) {
    const key = geocodeKey(lat, lng)
    if (coordsByKey.has(key)) continue
    coordsByKey.set(key, { lat, lng })
    order.push(key)
  }

  const addresses = {}
  const rows = await prisma.geocodeCache.findMany({ where: { key: { in: order } } })
  for (const r of rows) addresses[r.key] = r.address

  const missing = order.filter(k => !(k in addresses))
  const batch = missing.slice(0, resolve)

  const lookups = batch.map(key => throttled(async () => {
    // Out of time: leave the rest for the caller's next call rather than hold
    // this request open past what a browser fetch will wait for.
    if (Date.now() - startedAt > budgetMs) return
    const { lat, lng } = coordsByKey.get(key)
    try {
      const address = await lookup(lat, lng)
      addresses[key] = address
      await prisma.geocodeCache.upsert({
        where: { key },
        create: { key, address },
        update: { address },
      })
    } catch {
      // One failed lookup is not worth failing the report over: the row shows
      // its coordinates, nothing is cached, and a later call retries it.
    }
  }))
  await Promise.all(lookups)

  return { addresses, pending: order.filter(k => !(k in addresses)).length }
}
