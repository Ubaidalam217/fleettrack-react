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
 * A Photon feature's properties as one comma-separated address, most specific
 * first — the same shape as Nominatim's display_name ("3, Al Awsimah Street,
 * Mussafah, Abu Dhabi, United Arab Emirates"), so cached rows from either
 * geocoder read alike and the frontend's shortenAddress() trims both the same.
 */
export function formatPhotonAddress(p) {
  if (!p) return null
  const parts = [
    p.housenumber,
    p.name && p.name !== p.street ? p.name : null,
    p.street,
    p.locality,
    p.district,
    p.city,
    p.county,
    p.state,
    p.postcode,
    p.country,
  ]
  const seen = new Set()
  const out = []
  for (const part of parts) {
    const v = typeof part === 'string' ? part.trim() : ''
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out.length ? out.join(', ') : null
}

/** How far a Photon lookup that found nothing within its default 1 km reaches. */
const PHOTON_WIDE_RADIUS_KM = 5

/**
 * One lookup against the configured geocoder.
 *
 * GEOCODER_KIND picks the API: `nominatim` (the public default) or `photon` —
 * the self-hosted one on the VPS, which answers in milliseconds with no usage
 * limit, so a report's addresses fill in at once instead of at 1 per second.
 *
 * @returns {Promise<string|null>} the address, or null when the geocoder
 *          answered but has nothing for the point
 * @throws  on a network error, timeout or non-2xx — never cached
 */
async function lookup(lat, lng) {
  if (env.GEOCODER_KIND !== 'photon') return askNominatim(env.GEOCODER_URL, lat, lng)
  // GEOCODER_URL may list several Photon instances, one per region (the fleet
  // drives in the UAE and in The Gambia, and each regional dump is its own
  // database). Each is asked in turn — first at Photon's default 1 km, then
  // widened — and the first address wins. A miss costs milliseconds.
  for (const base of geocoderUrls()) {
    const found = (await askPhoton(base, lat, lng, false)) ?? (await askPhoton(base, lat, lng, true))
    if (found) return found
  }
  return null
}

/**
 * Last resort for what the regional Photon extracts do not cover: rural Gambia
 * has only ~5,000 places in OpenStreetMap's Photon dump (1,158 points of one day
 * came back empty), and a route can cross into Senegal. The public Nominatim
 * has the full map; it is asked only for these leftovers, one lookup at a time
 * at its 1-per-second policy, and only while a report is waiting for them —
 * never from the background job — so it never sees bulk traffic.
 */
const hasFallback = () => env.GEOCODER_KIND === 'photon' && !!env.GEOCODER_FALLBACK_URL

/** One public-Nominatim request at a time, at least 1.1 s apart, process-wide. */
let nominatimChain = Promise.resolve()
let nominatimLast = 0
function nominatimSlot(task) {
  const run = nominatimChain.then(async () => {
    const wait = nominatimLast + 1100 - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    nominatimLast = Date.now()
    return task()
  })
  nominatimChain = run.catch(() => {})
  return run
}

const geocoderUrls = () => env.GEOCODER_URL.split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean)

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      // Nominatim's usage policy requires an identifying User-Agent.
      'User-Agent': 'FleetmaX-tracking-backend/1.0',
    },
    signal: AbortSignal.timeout(env.GEOCODER_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Geocoder answered ${res.status}`)
  return res.json()
}

// English either way: without it both answer in the local script, which for
// this fleet's region means Arabic in every row of the report.
async function askNominatim(base, lat, lng) {
  const json = await getJson(`${base.replace(/\/+$/, '')}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0&accept-language=en`)
  return typeof json?.display_name === 'string' ? json.display_name : null
}

/**
 * Photon only looks 1 km out by default, and the industrial and desert roads
 * this fleet drives (ICAD, truck routes) have nothing named that close —
 * measured, those rows came back empty and showed raw coordinates — so a miss
 * is asked again at PHOTON_WIDE_RADIUS_KM for the nearest named street or site.
 */
async function askPhoton(base, lat, lng, widened) {
  const radius = widened ? `&radius=${PHOTON_WIDE_RADIUS_KM}` : ''
  const json = await getJson(`${base}/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1${radius}`)
  return formatPhotonAddress(json?.features?.[0]?.properties)
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
export async function reverseGeocodePoints(points, { resolve = 0, budgetMs = 20000, fallback = true } = {}) {
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
  const store = async (key, address) => {
    addresses[key] = address
    await prisma.geocodeCache.upsert({ where: { key }, create: { key, address }, update: { address } })
  }
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
      // Nothing from Photon: leave it to the fallback below rather than caching
      // "no address" — the fallback may well have one.
      if (address === null && hasFallback()) return
      await store(key, address)
    } catch {
      // One failed lookup is not worth failing the report over: the row shows
      // its coordinates, nothing is cached, and a later call retries it.
    }
  }))
  await Promise.all(lookups)

  // The leftovers, outside the Photon lanes so they never hold up the fast
  // lookups of another report, and only for a caller that is waiting.
  if (fallback && hasFallback()) {
    const left = batch.filter(k => !(k in addresses))
    for (const key of left) {
      if (Date.now() - startedAt > budgetMs) break
      const { lat, lng } = coordsByKey.get(key)
      try {
        await store(key, await nominatimSlot(() => askNominatim(env.GEOCODER_FALLBACK_URL, lat, lng)))
      } catch {
        // Same as above: retried on the next call.
      }
    }
  }

  return { addresses, pending: order.filter(k => !(k in addresses)).length }
}
