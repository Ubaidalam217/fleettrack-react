// Reverse geocoding for the Vehicle Info tab's Location field and the Movement
// Report's Location column, via Nominatim (OpenStreetMap's free reverse-geocode
// API — no key required, but usage policy asks for at most ~1 request/sec and a
// descriptive User-Agent/Referer, which the browser supplies automatically as
// Referer).
//
// Cached in memory *and* in localStorage. The in-memory-only rule this file
// started with was about a live vehicle marker, where carrying entries across
// page loads buys nothing. The Movement Report changed the calculus: a fleet-day
// report is ~2000 distinct coordinates, and at 1 request/sec that is half an
// hour of lookups to repeat on every reload. A rounded coordinate -> address
// mapping does not go stale (the vehicle moves, the street does not), so the
// only real cost of persisting is storage — bounded below by MAX_PERSISTED.
//
// In REAL mode reverseGeocodeMany goes through the backend instead
// (POST /api/geocode/reverse): its Postgres cache is shared by every user and
// browser, so a client on a fresh machine gets every address anyone has
// already resolved at once, and the 1/sec Nominatim throttle is enforced once
// for the whole server rather than per tab. Mock mode (the Netlify demo) has no
// backend and keeps calling Nominatim directly.
import { IS_REAL } from '../data/mode'
import { request } from '../data/http'

const cache = new Map() // "lat,lng" (rounded) -> address string

/** Points per cache-only request; the server accepts up to 2000. */
const SERVER_CACHE_CHUNK = 1000
/** Cache-only requests in flight at once. */
const SERVER_CACHE_PARALLEL = 4
/**
 * Live lookups per request, the server's maximum. With the self-hosted Photon
 * on the VPS a batch takes ~1 s; against the public Nominatim (a dev server)
 * the server stops at its 20 s budget and the rest come back on a re-run.
 */
const SERVER_RESOLVE_BATCH = 50

// v2: entries cached before accept-language=en was sent are in the local
// script (Arabic in this fleet's region), which is not what the report wants.
const STORE_KEY = 'ft_geocode_cache_v2'
const MAX_PERSISTED = 5000

// Nominatim's usage policy is 1 req/sec. 1100ms leaves headroom for clock skew
// so a long report never trips the limit and gets the whole app rate-limited.
const THROTTLE_MS = 1100

let loaded = false

function loadPersisted() {
  if (loaded) return
  loaded = true
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') cache.set(k, v)
      }
    }
  } catch { /* corrupt or unavailable storage — start empty */ }
}

// Debounced so resolving 600 addresses writes storage a handful of times rather
// than 600 times.
let flushTimer = null
function schedulePersist() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      // Map preserves insertion order, so slicing from the end keeps the most
      // recently resolved entries when the cache is over budget.
      const entries = [...cache.entries()].filter(([, v]) => typeof v === 'string')
      const kept = entries.slice(-MAX_PERSISTED)
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)))
    } catch { /* quota or private mode — the in-memory cache still works */ }
  }, 1500)
}

/**
 * Cache key for a coordinate: 4 decimal places, ~11m. Exported so a caller that
 * resolves a batch up front can look the results back up per row.
 */
export function geocodeKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`
}

/**
 * Trim a Nominatim display_name down to its most specific parts.
 *
 * The full string runs all the way out to the country ("Sayourah 2 Street, M
 * 38, Musaffah Industrial Area, Musaffah, Abu Dhabi, Abu Dhabi Emirate, United
 * Arab Emirates"), which is useless in a small card on a map — the leading
 * parts are the only ones that say where the vehicle actually is.
 */
export function shortenAddress(address, parts = 3) {
  if (!address) return address
  return address.split(',').slice(0, parts).join(',').trim()
}

async function lookup(lat, lng, signal) {
  // accept-language=en is not optional: without it Nominatim answers in the
  // local script, which for this fleet's region means every address in the
  // Movement Report comes back in Arabic.
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0&accept-language=en`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) return null
  const json = await res.json()
  return json.display_name ?? null
}

/**
 * Resolve (lat, lng) to a human-readable address string. Returns null on
 * failure rather than throwing — a missing address shouldn't break the tab.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null
  loadPersisted()
  const k = geocodeKey(lat, lng)
  if (cache.has(k)) return cache.get(k)

  try {
    const address = await lookup(lat, lng)
    cache.set(k, address)
    schedulePersist()
    return address
  } catch {
    return null
  }
}

/**
 * Forward geocode: a place/address string → candidate coordinates, for the
 * geofence editor's "jump the map here" search.
 *
 * Not cached, unlike reverseGeocode above — a free-text query has none of the
 * rounded-coordinate locality that makes caching reverse lookups pay off, and
 * this is a one-off interactive search rather than something called hundreds
 * of times per report.
 */
export async function searchPlace(query) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=0&accept-language=en`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const json = await res.json()
    if (!Array.isArray(json)) return []
    return json
      .map(r => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
  } catch {
    return []
  }
}

/** How many of these coordinates are not already cached. */
export function countUncached(coords) {
  loadPersisted()
  const seen = new Set()
  for (const { lat, lng } of coords) {
    if (lat == null || lng == null) continue
    const k = geocodeKey(lat, lng)
    if (!cache.has(k) && !seen.has(k)) seen.add(k)
  }
  return seen.size
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    function onAbort() { clearTimeout(timer); reject(abortError()) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  const err = new Error('Cancelled')
  err.name = 'AbortError'
  return err
}

/**
 * Resolve many coordinates, throttled to Nominatim's 1/sec policy.
 *
 * Deduplicates by rounded key first — an idling vehicle reports the same
 * coordinate for an hour, so a 900-row report is often only 200 real lookups —
 * then spends the budget in row order, so the rows the user reads first are the
 * ones that get addresses.
 *
 * @param {{lat:number,lng:number}[]} coords  in the order the caller wants them resolved
 * @param {object} [opts]
 * @param {number} [opts.limit]      max *network* lookups; cached hits are free
 * @param {AbortSignal} [opts.signal]
 * @param {function} [opts.onProgress] (done, total) after each lookup
 * @returns {Promise<{addresses: Map<string,string>, resolved: number, skipped: number}>}
 *          `addresses` is keyed by geocodeKey(); `skipped` counts coordinates
 *          left unresolved because the limit ran out.
 */
export async function reverseGeocodeMany(coords, opts = {}) {
  const { limit = Infinity, signal, onProgress } = opts
  loadPersisted()

  const addresses = new Map()
  const pending = []
  const seen = new Set()

  for (const { lat, lng } of coords) {
    if (lat == null || lng == null) continue
    const k = geocodeKey(lat, lng)
    if (seen.has(k)) continue
    seen.add(k)
    if (cache.has(k)) {
      const hit = cache.get(k)
      if (hit) addresses.set(k, hit)
    } else {
      pending.push({ k, lat, lng })
    }
  }

  if (IS_REAL) return resolveViaServer(pending, addresses, { limit, signal, onProgress })

  const budget = Math.max(0, Math.min(pending.length, limit))
  const total = budget
  let resolved = 0

  for (let i = 0; i < budget; i++) {
    if (signal?.aborted) throw abortError()
    const { k, lat, lng } = pending[i]
    try {
      const address = await lookup(lat, lng, signal)
      cache.set(k, address)
      if (address) addresses.set(k, address)
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      // A single failed lookup is not worth failing the report over — the row
      // falls back to raw coordinates. Not cached, so a re-run retries it.
    }
    resolved += 1
    onProgress?.(resolved, total)
    // No sleep after the last one — it would just delay the caller.
    if (i < budget - 1) await sleep(THROTTLE_MS, signal)
  }

  schedulePersist()
  return { addresses, resolved, skipped: pending.length - budget }
}

/** Merge a server answer into the local cache and the caller's result map. */
function absorb(serverAddresses, addresses) {
  for (const [k, address] of Object.entries(serverAddresses ?? {})) {
    cache.set(k, address)
    if (address) addresses.set(k, address)
  }
}

/**
 * Real-mode half of reverseGeocodeMany: everything the shared server cache
 * already knows in one or two requests, then the misses in small batches the
 * server looks up live (throttled there, for every user at once).
 */
async function resolveViaServer(pending, addresses, { limit, signal, onProgress }) {
  const points = p => p.map(({ lat, lng }) => ({ lat, lng }))

  try {
    // Cache-only chunks, a few at once: a week for ten vehicles is ~20k points,
    // and twenty of these one after another took ~5 s by themselves.
    const starts = []
    for (let i = 0; i < pending.length; i += SERVER_CACHE_CHUNK) starts.push(i)
    let next = 0
    const worker = async () => {
      while (next < starts.length) {
        if (signal?.aborted) throw abortError()
        const i = starts[next++]
        const res = await request('/api/geocode/reverse', {
          method: 'POST',
          body: { points: points(pending.slice(i, i + SERVER_CACHE_CHUNK)), resolve: 0 },
        })
        absorb(res.addresses, addresses)
      }
    }
    await Promise.all(Array.from({ length: Math.min(SERVER_CACHE_PARALLEL, starts.length) }, worker))
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    // Server unreachable: the rows keep their coordinates.
    schedulePersist()
    return { addresses, resolved: 0, skipped: pending.filter(p => !cache.has(p.k)).length }
  }

  const misses = pending.filter(p => !cache.has(p.k))
  const budget = Math.max(0, Math.min(misses.length, limit))
  let resolved = 0

  for (let i = 0; i < budget; i += SERVER_RESOLVE_BATCH) {
    if (signal?.aborted) throw abortError()
    const batch = misses.slice(i, Math.min(i + SERVER_RESOLVE_BATCH, budget))
    try {
      const res = await request('/api/geocode/reverse', {
        method: 'POST',
        body: { points: points(batch), resolve: batch.length },
      })
      absorb(res.addresses, addresses)
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      // A failed batch leaves those rows on coordinates; a re-run retries them.
    }
    resolved += batch.length
    onProgress?.(resolved, budget)
  }

  schedulePersist()
  return { addresses, resolved, skipped: misses.length - budget }
}
