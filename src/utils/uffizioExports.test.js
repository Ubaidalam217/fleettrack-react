import { describe, it, expect } from 'vitest'
import { deriveMovementReport } from './movementReport'
import { tripsByVehicle, sumTrips } from './usageReports'
import { usageByDay, summarize } from './utilization'
import { buildTripReport } from './geoZoneReports'
import { fuelOverWindow } from './uffizioReports'
import { uaeDayStart } from './daywiseCore'
import { haversineMeters } from './distance'

// What the reports print for an Uffizio vehicle: no NaN, no "undefined", the
// odometer's kilometres. Invented vehicle and samples only.
const ID = 'uffizio:veh-test-9'
const D0 = uaeDayStart(2026, 11, 20)
const KM_PER_DEG = haversineMeters(0, 0, 1, 0) / 1000
const vehicle = { id: ID, source: 'UFFIZIO', name: '359990000000109', ident: '359990000000109', label: 'ZZ 7009 Q9', master: { driver: { name: '' } } }

const s = (ts, { lat = 24.45, speed = 0, ign = false, odo = null } = {}) => ({
  'device.id': ID, timestamp: ts, 'position.latitude': lat, 'position.longitude': 54.38, 'position.speed': speed,
  'position.direction': 0, 'position.valid': true, 'engine.ignition.status': ign, 'vehicle.mileage': odo,
  'ibutton.code': null, 'external.powersource.voltage': 27.6,
})
function day() {
  const out = [s(D0 + 6 * 3600, { odo: 5000 })]
  for (let k = 0; k <= 30; k++) out.push(s(D0 + 8 * 3600 + k * 120, { lat: 24.45 + (2 * k) / KM_PER_DEG, speed: k % 7 === 3 ? 0 : 60, ign: true, odo: 5000 + 2 * k }))
  out.push(s(D0 + 9 * 3600 + 120, { lat: 24.45 + 60 / KM_PER_DEG, odo: 5060 }))
  out.push(s(D0 + 15 * 3600, { lat: 24.45 + 60 / KM_PER_DEG, odo: 5060 }))
  return out
}
const byDevice = () => new Map([[ID, { messages: day(), truncated: false }]])

/** Every leaf value: no NaN, no Infinity, no "undefined" / "NaN" text. */
function clean(value, path = '$') {
  if (typeof value === 'number') expect(Number.isFinite(value), path).toBe(true)
  else if (typeof value === 'string') expect(/\bNaN\b|undefined/.test(value), `${path}: ${value}`).toBe(false)
  else if (Array.isArray(value)) value.forEach((v, i) => clean(v, `${path}[${i}]`))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) clean(v, `${path}.${k}`)
}

describe('report rows of an Uffizio vehicle', () => {
  it('Movement Report: odometer distance, readable rows', () => {
    const r = deriveMovementReport(byDevice(), { vehicles: [vehicle] })
    expect(r.vehicles).toHaveLength(1)
    expect(r.vehicles[0].vehicleId).toBe('ZZ 7009 Q9')
    expect(r.vehicles[0].totalDistanceKm).toBeCloseTo(60, 6)
    clean(r.vehicles[0].dates.flatMap(d => d.rows).map(({ ts, statusKey, speed, odoKm, lat, lng }) => ({ ts, statusKey, speed, odoKm, lat, lng })))
  })

  it('Trip reports: one trip of 60 km, totals finite', () => {
    const [v] = tripsByVehicle(byDevice(), [vehicle])
    expect(v.vehicleId).toBe('ZZ 7009 Q9')
    expect(v.trips).toHaveLength(1)
    expect(v.trips[0].distanceKm).toBeCloseTo(60, 6)
    clean(v.trips.map(t => ({ ...t, ibutton: t.ibutton ?? '' })))
    clean(sumTrips(v.trips))
  })

  it('Utilization: the day and the summary', () => {
    const u = usageByDay(day(), D0, D0 + 86400)
    const d = u.days.get('2026-11-20')
    expect(d.km).toBeCloseTo(60, 6)
    expect(d.driveSec).toBeGreaterThan(0)
    clean(summarize(u, { from: D0, to: D0 + 86400 }))
  })

  it('Geofence Trip Report: fuel columns from the calibrated readings, 0.0 without', () => {
    const trip = {
      start: { ts: D0 + 8 * 3600, lat: 24.45, lng: 54.38 }, end: { ts: D0 + 9 * 3600, lat: 24.9, lng: 54.38 },
      startFence: { name: 'Yard' }, endFence: { name: 'Site' }, distanceKm: 60, runningSec: 3000, idleSec: 600, stopSec: 0, inactiveSec: 0, durationSec: 3600,
    }
    const analysis = new Map([[ID, { meta: { deviceId: ID, vehicleId: 'ZZ 7009 Q9', company: 'Test BG', branch: '—' }, messages: [], geo: { trips: [trip] } }]])
    const fuel = {
      calibrated: true,
      series: [{ ts: (D0 + 7 * 3600) * 1000, v: 200 }, { ts: (D0 + 8.5 * 3600) * 1000, v: 190 }, { ts: (D0 + 8.6 * 3600) * 1000, v: 260 }, { ts: (D0 + 9 * 3600) * 1000, v: 250 }],
      events: [{ kind: 'fill', startTs: (D0 + 8.5 * 3600) * 1000, litres: 70 }],
    }
    const withFuel = buildTripReport(analysis, new Map([[ID, fuel]]))
    expect(withFuel.perVehiclePages[0].rows[0]).toMatchObject({ startFuel: '200.0', endFuel: '250.0', refill: '70.0', drain: '0.0', fuelConsumed: '20.0' })
    expect(withFuel.summary.fuelConsumed).toBe('20.0')
    const without = buildTripReport(analysis)
    expect(without.perVehiclePages[0].rows[0]).toMatchObject({ startFuel: '0.0', fuelConsumed: '0.0' })
    expect(without.summary.fuelConsumed).toBe('0.0')
  })

  it('fuelOverWindow: null when not calibrated or no reading reaches the window', () => {
    expect(fuelOverWindow({ calibrated: false, series: [{ ts: 1, v: 3000 }] }, 0, 10)).toBeNull()
    expect(fuelOverWindow({ calibrated: true, series: [{ ts: 100, v: 50 }] }, 0, 10)).toBeNull()
    expect(fuelOverWindow({ calibrated: true, series: [{ ts: 5, v: 50 }, { ts: 9, v: 40 }], events: [{ kind: 'drain', startTs: 6, litres: 8 }] }, 0, 10))
      .toEqual({ startL: 50, endL: 40, refillL: 0, drainL: 8, consumedL: 2 })
  })
})
