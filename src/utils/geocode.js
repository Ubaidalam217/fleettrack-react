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
const cache = new Map() // "lat,lng" (rounded) -> address string

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
