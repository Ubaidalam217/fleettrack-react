/**
 * Harsh braking and harsh acceleration from the trackers' speed readings
 * (client, 2026-11-10: "all events including Harsh Braking and Harsh
 * Acceleration will be counted"). None of the fleet's trackers sends a harsh
 * event of its own, so they are read off the speed, the same way the Trip and
 * GYR reports count them (utils/usageReports.js):
 *
 *   - only readings 1–10 s apart, where the change is real rather than a gap
 *     jumping from parked to motorway speed;
 *   - at or beyond the threshold (3.5 m/s² unless the rule sets another);
 *   - above 10 m/s² is a reporting artefact, not a car, and is dropped.
 *
 * Back-to-back qualifying readings are one episode — one hard stop is one
 * event, with where and when it started and ended. Shared by the server's
 * alert engine and the reports.
 */

export const HARSH_MS2 = 3.5
const NOISE_CEILING_MS2 = 10
const MIN_DT = 1
const MAX_DT = 10

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * @param {object[]} messages  one device's messages, oldest first
 * @param {object}   opts      { kind: 'braking' | 'acceleration', thresholdMs2 }
 * @returns {{ startTs, endTs, peakMs2, fromKmh, toKmh, lat, lng }[]}
 */
export function harshEpisodes(messages, { kind = 'braking', thresholdMs2 = HARSH_MS2 } = {}) {
  const out = []
  const sign = kind === 'acceleration' ? 1 : -1
  let open = null
  for (let i = 1; i < (messages?.length ?? 0); i++) {
    const a = messages[i - 1], b = messages[i]
    const t0 = num(a.timestamp), t1 = num(b.timestamp)
    const v0 = num(a['position.speed']), v1 = num(b['position.speed'])
    let hit = false, ms2 = 0
    if (t0 !== null && t1 !== null && v0 !== null && v1 !== null) {
      const dt = t1 - t0
      if (dt >= MIN_DT && dt <= MAX_DT) {
        ms2 = (sign * (v1 - v0)) / 3.6 / dt
        hit = ms2 >= thresholdMs2 && ms2 <= NOISE_CEILING_MS2
      }
    }
    if (hit) {
      if (open && open.endTs === t0) {
        open.endTs = t1
        open.toKmh = v1
        open.peakMs2 = Math.max(open.peakMs2, ms2)
      } else {
        if (open) out.push(open)
        open = {
          startTs: t0, endTs: t1, peakMs2: ms2, fromKmh: v0, toKmh: v1,
          lat: num(a['position.latitude']), lng: num(a['position.longitude']),
        }
      }
    } else if (open) {
      out.push(open)
      open = null
    }
  }
  if (open) out.push(open)
  return out
}

/** "Harsh braking: 62 → 21 km/h in 3 s (3.9 m/s²)". */
export function describeHarsh(kind, e) {
  const what = kind === 'acceleration' ? 'Harsh acceleration' : 'Harsh braking'
  return `${what}: ${Math.round(e.fromKmh)} → ${Math.round(e.toKmh)} km/h in ${e.endTs - e.startTs} s (${e.peakMs2.toFixed(1)} m/s²)`
}
