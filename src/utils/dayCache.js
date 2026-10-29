/**
 * A browser cache for one day's report messages (IndexedDB).
 *
 * The Daywise reports fetch a month one day at a time (~1 MB per day for ten
 * vehicles), so a month took 20-30 s and every re-run, or switching between Work
 * Hour and Distance, paid it again. A day that is over does not change, so it is
 * stored here and the next run reads it from the browser instead.
 *
 * Only days that ended at least SETTLE_MS ago are stored: trackers upload
 * buffered messages late after a coverage gap, and a day cached too early would
 * keep missing them. Everything is best effort — no IndexedDB (private mode, an
 * old browser) simply means every day is fetched, as before.
 */

const DB_NAME = 'fleetmax-report-cache'
const STORE = 'days'
const VERSION = 1
/** Keep at most this many day entries; the oldest saved go first. */
const MAX_ENTRIES = 400
/** A day must have ended this long ago before it is cached. */
export const SETTLE_MS = 48 * 3600 * 1000

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('savedAt', 'savedAt')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** True when a day ending at `dayEndMs` is old enough to cache. */
export const isSettled = dayEndMs => Date.now() - dayEndMs >= SETTLE_MS

export async function readDay(key) {
  const db = await openDb()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result?.value ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function writeDay(key, value) {
  const db = await openDb()
  if (!db) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    store.put({ key, value, savedAt: Date.now() })
    // Trim: walk oldest-first and drop the overflow.
    const countReq = store.count()
    countReq.onsuccess = () => {
      let excess = countReq.result - MAX_ENTRIES
      if (excess <= 0) return
      store.index('savedAt').openCursor().onsuccess = e => {
        const cursor = e.target.result
        if (!cursor || excess <= 0) return
        cursor.delete()
        excess -= 1
        cursor.continue()
      }
    }
  } catch {
    // Quota or a closed connection — the report still works without the cache.
  }
}
