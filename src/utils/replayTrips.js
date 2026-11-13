/**
 * Trips inside a loaded Live Map replay, and the files a replay exports to.
 *
 * Client, 2026-11-10: "Export replay of the trip, and show the trips." The
 * replay used to play its whole loaded range as one track; this splits it into
 * trips so the panel can list them and play one, and builds the KML (Google
 * Earth) and GPX files a trip — or the whole range — downloads as.
 *
 * A trip here is the Trip Report's trip, not a second rule: the replay points
 * are mapped back onto the Flespi keys deriveTrips() reads (usageReports.js —
 * ignition on to ignition off, a gap of more than 30 min ends it), so the
 * replay and the Trip Report count the same trips for the same period.
 *
 * Pure: no React, no network, no Date.now().
 */

import { deriveTrips, ZERO_KM } from './usageReports.js'

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pad = n => String(n).padStart(2, '0')

// ── trips ────────────────────────────────────────────────────────────────

/**
 * A replay point ({lat, lng, speed, heading, ignition, ts, mileage?, valid?})
 * as the Flespi message deriveTrips() and the distance stepper read. Ignition
 * is only carried when the device reported it, so a device without it falls
 * back to movement exactly as it does in the Trip Report.
 */
export function pointToMessage(p) {
  const m = {
    timestamp: p.ts,
    'position.latitude': p.lat,
    'position.longitude': p.lng,
    'position.speed': num(p.speed) ?? 0,
    'position.direction': p.heading,
  }
  if (typeof p.ignition === 'boolean') m['engine.ignition.status'] = p.ignition
  if (num(p.mileage) !== null) m['vehicle.mileage'] = p.mileage
  if (typeof p.valid === 'boolean') m['position.valid'] = p.valid
  if (num(p.volt) !== null) m['external.powersource.voltage'] = p.volt
  if (typeof p.ibutton === 'string') m['ibutton.code'] = p.ibutton
  return m
}

/** First index whose ts is >= ts (points ascending by ts). */
function lowerBound(points, ts) {
  let lo = 0, hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((points[mid].ts ?? -Infinity) < ts) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Last index whose ts is <= ts, or -1. */
function upperIndex(points, ts) {
  let lo = 0, hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((points[mid].ts ?? -Infinity) <= ts) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * The trips in a replay's points (ascending by ts), numbered 1..N in order.
 *
 * Each carries `fromIdx`/`toIdx` — the inclusive slice of `points` it covers —
 * so playing a trip is a slice of the points already loaded, never a fetch.
 *
 * @param {object[]} points  replay points, ascending by ts
 * @param {object} [opts]    passed through to deriveTrips (maxGapSec, ...)
 * @returns {object[]} {no, startTs, endTs, durationSec, distanceKm, maxSpeed,
 *          driveSec, idleSec, startLat, startLng, endLat, endLng, open,
 *          fromIdx, toIdx, pointCount}
 */
export function tripsFromPoints(points, opts = {}) {
  if (!points?.length) return []
  const trips = deriveTrips(points.map(pointToMessage), opts)
  const out = []
  for (const t of trips) {
    const fromIdx = lowerBound(points, t.startTs)
    const toIdx = upperIndex(points, t.endTs)
    if (toIdx < fromIdx) continue
    out.push({
      no: out.length + 1,
      startTs: t.startTs,
      endTs: t.endTs,
      durationSec: t.durationSec,
      distanceKm: t.distanceKm,
      maxSpeed: t.maxSpeed,
      driveSec: t.driveSec,
      idleSec: t.idleSec,
      startLat: t.startLat, startLng: t.startLng,
      endLat: t.endLat, endLng: t.endLng,
      open: t.open,
      fromIdx,
      toIdx,
      pointCount: toIdx - fromIdx + 1,
    })
  }
  return out
}

/** A "0 km" trip by the Trip Report's own threshold (usageReports ZERO_KM). */
export const isZeroTrip = t => t.distanceKm < ZERO_KM

/**
 * The trips the list shows. Like the Trip Report, 0 km trips (an ignition
 * flicker in the yard) are hidden by default; the rest are renumbered 1..N so
 * the list, its count and the export file names agree with what is on screen.
 *
 * @returns {{ trips: object[], hidden: number }}
 */
export function visibleReplayTrips(trips, hideZero = true) {
  const all = trips ?? []
  if (!hideZero) return { trips: all, hidden: 0 }
  const kept = all.filter(t => !isZeroTrip(t))
  if (kept.length === all.length) return { trips: all, hidden: 0 }
  return { trips: kept.map((t, i) => ({ ...t, no: i + 1 })), hidden: all.length - kept.length }
}

/** The points one trip covers — a slice of the loaded range. */
export function tripPoints(points, trip) {
  if (!trip || !points?.length) return points ?? []
  return points.slice(trip.fromIdx, trip.toIdx + 1)
}

/** Totals for the "whole range" row: trip count, km, driving time, top speed. */
export function tripTotals(trips) {
  let distanceKm = 0, driveSec = 0, durationSec = 0, maxSpeed = 0
  for (const t of trips ?? []) {
    distanceKm += t.distanceKm ?? 0
    driveSec += t.driveSec ?? 0
    durationSec += t.durationSec ?? 0
    if ((t.maxSpeed ?? 0) > maxSpeed) maxSpeed = t.maxSpeed
  }
  return { trips: trips?.length ?? 0, distanceKm, driveSec, durationSec, maxSpeed }
}

// ── formatting ───────────────────────────────────────────────────────────

/** "1h 05m", "12m", "45s" — a trip's length in the panel. */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${pad(m)}m` : `${m}m`
}

/** "02:07:45" — the export's duration cells (the reports' HH:MM:SS). */
export function fmtHms(sec) {
  if (!Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** "11/10/2026 8:05:09 AM" — local time, the house date format of the report exports. */
export function fmtDateTime(ts) {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts * 1000)
  const h = d.getHours()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${h >= 12 ? 'PM' : 'AM'}`
}

/** "2026-11-10" — local calendar day, for file names. */
export function localDay(ts) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO-8601 UTC without milliseconds, as KML <when> and GPX <time> want it. */
export function isoTime(ts) {
  return new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Download name for an export:
 *   a trip          KM_6651_F_2026-11-10_trip-2.kml
 *   the whole range KM_6651_F_2026-11-10_replay.kml
 *                   KM_6651_F_2026-11-08_to_2026-11-10_replay.kml (several days)
 */
export function exportFileName(vehicle, points, trip, ext) {
  const name = String(vehicle ?? '').trim().replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'vehicle'
  if (trip) return `${name}_${localDay(trip.startTs)}_trip-${trip.no}.${ext}`
  const list = points ?? []
  const first = list.find(p => Number.isFinite(p.ts))
  let last = null
  for (let i = list.length - 1; i >= 0 && !last; i--) if (Number.isFinite(list[i].ts)) last = list[i]
  if (!first) return `${name}_replay.${ext}`
  const from = localDay(first.ts)
  const to = localDay(last.ts)
  return `${name}_${from === to ? from : `${from}_to_${to}`}_replay.${ext}`
}

// ── KML / GPX ─────────────────────────────────────────────────────────────

/** XML text/attribute escaping. */
export function xmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
}

/** Only points a track can carry: a time and a position. */
const plottable = points => (points ?? []).filter(p =>
  Number.isFinite(p.ts) && Number.isFinite(p.lat) && Number.isFinite(p.lng))

// Coordinates to 6 decimals (~10 cm) — the device's own precision, and it keeps
// a week-long export from carrying 17-digit floats.
const c6 = v => String(Math.round(v * 1e6) / 1e6)

// The app's Sea Blue (#0a8fb0) in KML's aabbggrr order.
const KML_ROUTE_COLOR = 'ffb08f0a'

/**
 * A replay as KML for Google Earth.
 *
 * The route is a <gx:Track> — one <when> and one <gx:coord> per point — so
 * Google Earth's time slider replays the drive with the icon turning to each
 * point's heading. Speed rides along as ExtendedData (it shows in the track's
 * elevation profile). Start and End are separate placemarks with no time of
 * their own, so they stay on the map whatever the slider shows.
 *
 * @param {object[]} points  replay points to export (a trip's, or the whole range)
 * @param {object} meta      {title, description?, startLabel?, endLabel?}
 *                           startLabel/endLabel: the place names, when known
 * @returns {string} KML document
 */
export function buildKml(points, meta = {}) {
  const pts = plottable(points)
  const title = meta.title || 'Replay'
  const out = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">')
  out.push('<Document>')
  out.push(`  <name>${xmlEscape(title)}</name>`)
  out.push('  <open>1</open>')
  if (meta.description) out.push(`  <description>${xmlEscape(meta.description)}</description>`)
  out.push('  <Style id="route">')
  out.push('    <IconStyle><scale>1.2</scale><Icon><href>http://earth.google.com/images/kml-icons/track-directional/track-0.png</href></Icon></IconStyle>')
  out.push(`    <LineStyle><color>${KML_ROUTE_COLOR}</color><width>4</width></LineStyle>`)
  out.push('  </Style>')
  out.push('  <Style id="start"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>')
  out.push('  <Style id="end"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-square.png</href></Icon></IconStyle></Style>')
  out.push('  <Schema id="replayData">')
  out.push('    <gx:SimpleArrayField name="speed" type="float"><displayName>Speed (km/h)</displayName></gx:SimpleArrayField>')
  out.push('  </Schema>')

  if (pts.length) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    const endpoint = (label, styleId, p, place) => {
      const desc = [fmtDateTime(p.ts), place, `${c6(p.lat)}, ${c6(p.lng)}`].filter(Boolean).join('\n')
      out.push('  <Placemark>')
      out.push(`    <name>${label}</name>`)
      out.push(`    <description>${xmlEscape(desc)}</description>`)
      out.push(`    <styleUrl>#${styleId}</styleUrl>`)
      out.push(`    <Point><coordinates>${c6(p.lng)},${c6(p.lat)},0</coordinates></Point>`)
      out.push('  </Placemark>')
    }
    endpoint('Start', 'start', first, meta.startLabel)
    endpoint('End', 'end', last, meta.endLabel)

    // Heading for every point: a point without one keeps the last known, so the
    // icon does not snap to north for a single sample.
    let heading = 0
    const angles = pts.map(p => {
      if (Number.isFinite(p.heading)) heading = p.heading
      return heading
    })

    out.push('  <Placemark>')
    out.push(`    <name>${xmlEscape(title)}</name>`)
    out.push('    <styleUrl>#route</styleUrl>')
    out.push('    <gx:Track>')
    out.push('      <altitudeMode>clampToGround</altitudeMode>')
    for (const p of pts) out.push(`      <when>${isoTime(p.ts)}</when>`)
    for (const p of pts) out.push(`      <gx:coord>${c6(p.lng)} ${c6(p.lat)} 0</gx:coord>`)
    for (const a of angles) out.push(`      <gx:angles>${Math.round(a)} 0 0</gx:angles>`)
    out.push('      <ExtendedData>')
    out.push('        <SchemaData schemaUrl="#replayData">')
    out.push('          <gx:SimpleArrayData name="speed">')
    for (const p of pts) out.push(`            <gx:value>${num(p.speed) ?? 0}</gx:value>`)
    out.push('          </gx:SimpleArrayData>')
    out.push('        </SchemaData>')
    out.push('      </ExtendedData>')
    out.push('    </gx:Track>')
    out.push('  </Placemark>')
  }

  out.push('</Document>')
  out.push('</kml>')
  return out.join('\n') + '\n'
}

/**
 * A replay as GPX 1.1 — for anything that is not Google Earth (Garmin,
 * Strava-style tools, QGIS). Start/End waypoints and one track segment.
 * GPX 1.1 has no speed or course on a track point, so only time is carried;
 * the tools derive speed from time and position.
 */
export function buildGpx(points, meta = {}) {
  const pts = plottable(points)
  const title = meta.title || 'Replay'
  const out = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<gpx version="1.1" creator="FleetmaxX" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">')
  out.push('  <metadata>')
  out.push(`    <name>${xmlEscape(title)}</name>`)
  if (meta.description) out.push(`    <desc>${xmlEscape(meta.description)}</desc>`)
  out.push('  </metadata>')
  if (pts.length) {
    const wpt = (label, p, place) => {
      out.push(`  <wpt lat="${c6(p.lat)}" lon="${c6(p.lng)}">`)
      out.push(`    <time>${isoTime(p.ts)}</time>`)
      out.push(`    <name>${label}</name>`)
      if (place) out.push(`    <desc>${xmlEscape(place)}</desc>`)
      out.push('  </wpt>')
    }
    wpt('Start', pts[0], meta.startLabel)
    wpt('End', pts[pts.length - 1], meta.endLabel)
    out.push('  <trk>')
    out.push(`    <name>${xmlEscape(title)}</name>`)
    out.push('    <trkseg>')
    for (const p of pts) {
      out.push(`      <trkpt lat="${c6(p.lat)}" lon="${c6(p.lng)}"><time>${isoTime(p.ts)}</time></trkpt>`)
    }
    out.push('    </trkseg>')
    out.push('  </trk>')
  }
  out.push('</gpx>')
  return out.join('\n') + '\n'
}

// ── Excel rows ────────────────────────────────────────────────────────────

/** Which trip (number) each point belongs to, for the export's Trip column. */
export function tripNoByIndex(trips) {
  const map = new Map()
  for (const t of trips ?? []) for (let i = t.fromIdx; i <= t.toIdx; i++) map.set(i, t.no)
  return map
}

/** "On" / "Off" / "" — a point's ignition as the export shows it. */
export function ignitionText(v) {
  if (v === true) return 'On'
  if (v === false) return 'Off'
  return ''
}
