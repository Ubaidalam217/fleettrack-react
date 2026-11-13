/**
 * Who drove a vehicle at a given moment — the driver dimension the Movement,
 * Event Occurrence, Geo Zone, Daywise and Heat Map reports filter and group by
 * (client, 2026-11-12: "All the reports can be generated Vehicle wise or
 * Driver wise").
 *
 * The rule is the Trip reports' (usageReports.js / UsageReportPage): a trip's
 * driver is the iButton tag read during it, else the vehicle's assigned driver.
 * Here, per moment:
 *   - a tag read while the ignition is on names the driver of that whole
 *     ignition-on run — from the run's start, as a trip takes its first tag —
 *     until the ignition goes off or another tag is read; the name is whoever
 *     held that tag when it was read (`driverForTag(code, ts)`);
 *   - with no tag, the driver assigned to the vehicle at that moment
 *     (`assignedAt(ts)`, from the recorded history — client, 2026-11-13: "All
 *     the drivers names will stay as it is"), else `assigned`, today's;
 *   - with neither, "No driver".
 *
 * Pure: the Settings lookups are passed in, so this stays testable.
 * hooks/useDriverDimension.js wires the history-aware ones.
 */

export const NO_DRIVER = Object.freeze({ key: 'none', label: 'No driver' })

/** An iButton code as drivers store it; '' for none and the all-zero "no tag" code. */
export function tagKey(code) {
  const s = String(code ?? '').replace(/[\s:-]/g, '').toUpperCase()
  return /^0*$/.test(s) ? '' : s
}

/** A driver record (or a bare name) as a report's {key, label}; null for nothing. */
export function driverIdentity(driver) {
  if (!driver) return null
  if (typeof driver === 'string') return driver.trim() ? { key: `n:${driver.trim()}`, label: driver.trim() } : null
  if (driver.id) return { key: `d:${driver.id}`, label: driver.name || 'Driver' }
  if (driver.name) return { key: `n:${driver.name}`, label: driver.name }
  return null
}

/** The {key, label} for a tag: its registered driver, else an "Unregistered Driver" for that ID. */
export function tagIdentity(code, driverForTag) {
  const key = tagKey(code)
  if (!key) return null
  return driverIdentity(driverForTag?.(key)) ?? { key: `u:${key}`, label: `Unregistered Driver · ID ${key}` }
}

/**
 * A lookup of the driver at any moment of one vehicle's messages.
 *
 * @param {object[]} messages  ascending by timestamp (Flespi shape)
 * @param {object}   opts
 * @param {(code: string, ts: number) => object|null} opts.driverForTag  the registered driver
 *        holding a tag when it was read at ts (a lookup of today's holder may ignore ts)
 * @param {{key, label}|null} [opts.assigned]  the vehicle's assigned driver today
 * @param {(ts: number) => ({key, label}|null)} [opts.assignedAt]  the driver assigned at a
 *        moment; when given it decides untagged moments (null = nobody) and `assigned` is unused
 * @returns {(ts: number) => {key: string, label: string}}
 */
export function driverTimeline(messages, { driverForTag, assigned = null, assignedAt = null } = {}) {
  const fallback = assignedAt ? ts => assignedAt(ts) ?? NO_DRIVER : () => assigned ?? NO_DRIVER
  const points = [] // { ts, who } — `who` null means "back to the fallback"
  let runStart = null
  let tag = null    // the tag key in force in the current run
  for (const m of messages ?? []) {
    const ts = m?.timestamp
    if (typeof ts !== 'number') continue
    const ign = m['engine.ignition.status']
    if (ign === false) {
      if (tag) points.push({ ts, who: null })
      tag = null
      runStart = null
    } else if (ign === true && runStart === null) {
      runStart = ts
    }
    const key = tagKey(m['ibutton.code'])
    if (key && key !== tag) {
      const who = tagIdentity(key, driverForTag ? code => driverForTag(code, ts) : null)
      // The first tag of a run names its driver from the run's start.
      const at = tag === null && runStart !== null ? runStart : ts
      while (points.length && points[points.length - 1].ts > at) points.pop()
      points.push({ ts: at, who })
      tag = key
    }
  }
  return ts => {
    let lo = 0, hi = points.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (points[mid].ts <= ts) lo = mid + 1
      else hi = mid
    }
    return (lo > 0 && points[lo - 1].who) || fallback(ts)
  }
}

/** Whether a {key} passes a driver filter: null/undefined = all; else a Set of keys ('u:*' = any unregistered card). */
export function driverPasses(who, filter) {
  if (!filter) return true
  if (filter.has(who.key)) return true
  return who.key.startsWith('u:') && filter.has('u:*')
}

/** "All", or the chosen drivers' labels joined. */
export function driverFilterLabel(filter, options) {
  if (!filter) return 'All'
  if (filter.size === 0) return 'None'
  const byKey = new Map((options ?? []).map(o => [o.key, o.label]))
  return [...filter].map(k => byKey.get(k) ?? k).join(', ')
}

/**
 * One vehicle's messages cut into the runs a driver filter keeps, each run
 * ending on the first message after it, so every kept interval (message to
 * next) stays whole and no interval spans a driver who is filtered out. For
 * interval-based figures such as the Heat Map's time per place.
 */
export function runsForDrivers(messages, at, filter) {
  if (!filter) return [messages ?? []]
  const runs = []
  let run = null
  for (const m of messages ?? []) {
    const keep = driverPasses(at(m.timestamp), filter)
    if (keep) {
      if (!run) { run = []; runs.push(run) }
      run.push(m)
    } else if (run) {
      run.push(m) // the end point of the last kept interval
      run = null
    }
  }
  return runs
}
