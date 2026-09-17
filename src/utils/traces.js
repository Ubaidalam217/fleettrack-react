// Live traces — the growing breadcrumb a vehicle leaves while Trace is on.
//
// In-memory only, by design: a trace is a view of what is happening right now,
// and Replay already covers "where has it been". Nothing here touches storage,
// so a reload starts every trace clean.

/** Concurrent trace ceiling. Past this the map stops reading as a map. */
export const MAX_TRACES = 5

// Picked to stay apart from each other and from the status colours used by the
// markers, so a trace is never mistaken for a vehicle state.
// Left on the original blue-first ramp through the rebrand: these have to stay
// apart from each other AND from the status colours the markers use, so the
// brand green is the one hue that cannot go in here.
export const TRACE_COLORS = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']

/** Lowest unused colour, so freeing slot 2 and tracing again reuses slot 2. */
export function nextTraceColor(traces) {
  const taken = new Set(Object.values(traces).map(t => t.color))
  return TRACE_COLORS.find(c => !taken.has(c)) ?? TRACE_COLORS[0]
}

/**
 * Append a fix to a trace, skipping anything that would not move the line.
 *
 * Two guards, both needed. `lastTs` rejects repeats of a message already
 * recorded — the vehicles array is rebuilt on every MQTT push, including
 * pushes that carry no new position. The coordinate check then drops fixes
 * that advanced in time but not in space, which is what a parked vehicle
 * reporting every 60s produces: without it a stationary trace accumulates
 * thousands of identical points.
 */
export function appendPoint(trace, lat, lng, ts) {
  if (lat == null || lng == null) return trace
  if (trace.lastTs != null && ts != null && ts <= trace.lastTs) return trace

  const last = trace.points[trace.points.length - 1]
  if (last && last[0] === lat && last[1] === lng) {
    // Still advance the clock, or every later message re-tests this same point.
    return ts != null ? { ...trace, lastTs: ts } : trace
  }

  return {
    ...trace,
    points: [...trace.points, [lat, lng]],
    lastTs: ts ?? trace.lastTs,
  }
}

/** A fresh trace seeded with the vehicle's current position, if it has one. */
export function createTrace(color, vehicle) {
  const seeded = vehicle?.lat != null && vehicle?.lng != null
  return {
    color,
    points: seeded ? [[vehicle.lat, vehicle.lng]] : [],
    lastTs: seeded ? vehicle.lastTs ?? null : null,
  }
}
