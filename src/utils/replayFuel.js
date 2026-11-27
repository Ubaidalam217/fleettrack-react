/**
 * The fuel line of the replay (client, 2026-11-27: "show fuel data in replay if
 * added against the vehicle"). Pure: no React, no network.
 *
 * The data is GET /api/fuel/series for the replayed period (litres with the
 * calibration in use, raw without; fills and drains with the Fuel report's
 * thresholds), or — for a Flespi tracker nobody has set a fuel input on — the
 * CAN fuel volume that the replay's own messages carry, cleaned and read for
 * fills / drains with the same rules (utils/fuelEvents.js).
 */

import { cleanSeries, detectFuelEvents, DEFAULT_THRESHOLD_L } from './fuelEvents'

const fin = v => typeof v === 'number' && Number.isFinite(v)

/** Fuel of a replay, or null when there is none to show. */
export function fuelFromServer(info) {
  if (!info || !Array.isArray(info.series) || !info.series.length) return null
  return {
    source: 'fuel',
    unit: info.calibrated ? 'L' : 'raw',
    note: info.calibrated ? null : 'not calibrated',
    series: info.series.filter(p => fin(p?.ts) && fin(p?.v)).map(p => ({ ts: p.ts, v: p.v })),
    events: info.calibrated ? (info.events ?? []).filter(e => e.kind === 'fill' || e.kind === 'drain') : [],
  }
}

/**
 * Fuel from the replay's points that carry a CAN fuel volume (`fuelL`, > 0).
 * Null with fewer than 2 readings.
 */
export function fuelFromPoints(points, { threshold = DEFAULT_THRESHOLD_L } = {}) {
  const rows = (points ?? []).filter(p => fin(p?.fuelL) && p.fuelL > 0 && fin(p.ts))
    .map(p => ({ ts: p.ts * 1000, litres: p.fuelL, ign: typeof p.ignition === 'boolean' ? p.ignition : null, speed: fin(p.speed) ? p.speed : null, lat: p.lat, lng: p.lng }))
  if (rows.length < 2) return null
  const series = cleanSeries(rows, { threshold })
  if (series.length < 2) return null
  return {
    source: 'can',
    unit: 'L',
    note: 'from the vehicle’s CAN, not set up in Fuel',
    series: series.map(p => ({ ts: p.ts, v: p.litres })),
    events: detectFuelEvents(series, { threshold }),
  }
}

/** The reading at or before a moment (ms), else the first one. Series ascending by ts. */
export function fuelAt(series, tsMs) {
  if (!series?.length) return null
  if (tsMs <= series[0].ts) return series[0]
  let lo = 0, hi = series.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (series[mid].ts <= tsMs) lo = mid
    else hi = mid - 1
  }
  return series[lo]
}

/**
 * The graph: an SVG path over [t0, t1] (unix seconds, the replay's own span) in a
 * w x h box, scaled to the lowest and highest reading, plus where a moment sits
 * (`x`) and the markers of the fills and drains inside the span.
 */
export function fuelGeometry(fuel, t0, t1, { w = 1000, h = 34, pad = 4 } = {}) {
  if (!fuel?.series?.length || !fin(t0) || !fin(t1)) return null
  const span = Math.max(1, t1 - t0)
  const inside = fuel.series.filter(p => p.ts / 1000 >= t0 - 60 && p.ts / 1000 <= t1 + 60)
  if (inside.length < 1) return null
  const lo = Math.min(...inside.map(p => p.v))
  const hi = Math.max(...inside.map(p => p.v))
  const range = Math.max(1e-6, hi - lo)
  const x = ts => Math.min(w, Math.max(0, ((ts / 1000 - t0) / span) * w))
  const y = v => h - pad - ((v - lo) / range) * (h - 2 * pad)
  const r = n => Math.round(n * 10) / 10
  const pts = inside.map(p => [r(x(p.ts)), r(hi === lo ? h / 2 : y(p.v))])
  const path = pts.length === 1 ? `M${pts[0][0]},${pts[0][1]}L${pts[0][0] + 1},${pts[0][1]}` : `M${pts.map(p => p.join(',')).join('L')}`
  const marks = (fuel.events ?? [])
    .filter(e => e.startTs / 1000 >= t0 && e.startTs / 1000 <= t1)
    .map(e => ({ kind: e.kind, x: r(x(e.startTs)), y: r(hi === lo ? h / 2 : y(e.kind === 'fill' ? e.after : e.before)), litres: e.litres, startTs: e.startTs }))
  return { path, marks, x, lo, hi }
}
