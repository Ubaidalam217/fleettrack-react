import { describe, it, expect } from 'vitest'
import { deriveMovementReport } from './movementReport'

// One device, no odometer (like the four Teltonika units): parked with the
// ignition off, switched on, 30 minutes of driving with a fix every minute,
// switched off, then 20 minutes of one-a-minute "Ignition off" heartbeats.
function trip() {
  const msgs = []
  const t0 = Date.UTC(2026, 9, 18, 6, 0, 0) / 1000
  const at = (i, { ign, speed, lat }) => msgs.push({
    timestamp: t0 + i * 60,
    'engine.ignition.status': ign,
    'position.speed': speed,
    'position.latitude': lat,
    'position.longitude': 54.4,
    'position.satellites': 12,
  })
  at(0, { ign: false, speed: 0, lat: 24.4 })
  for (let i = 1; i <= 31; i++) at(i, { ign: true, speed: 40, lat: 24.4 + (i - 1) * 0.005 })
  for (let i = 32; i <= 52; i++) at(i, { ign: false, speed: 0, lat: 24.4 + 30 * 0.005 })
  return new Map([[1, { messages: msgs, truncated: false }]])
}

const rowsOf = report => report.vehicles[0].dates.flatMap(d => d.rows)

describe('deriveMovementReport', () => {
  it('measures a vehicle with no odometer from GPS (Cumulative Odo is not 0)', () => {
    const report = deriveMovementReport(trip(), {})
    // 30 steps of 0.005 deg latitude ≈ 16.7 km
    expect(report.vehicles[0].totalDistanceKm).toBeGreaterThan(16)
    expect(report.vehicles[0].totalDistanceKm).toBeLessThan(17.5)
  })

  it('emits every message with no interval', () => {
    expect(deriveMovementReport(trip(), {}).totalRows).toBe(53)
  })

  it('thins repeated rows with an interval, but keeps every event', () => {
    const full = deriveMovementReport(trip(), {})
    const thin = deriveMovementReport(trip(), { intervalSec: 300 })
    const rows = rowsOf(thin)

    expect(thin.totalRows).toBeLessThan(full.totalRows / 3)
    // The switch-on and the first switch-off are events, never thinned.
    expect(rows.filter(r => r.statusKey === 'startUp')).toHaveLength(1)
    const firstOffAfterDriving = rows.findIndex((r, i) => i > 0 && r.statusKey === 'ignitionOff' && rows[i - 1].statusKey !== 'ignitionOff')
    expect(firstOffAfterDriving).toBeGreaterThan(0)
    expect(rows[firstOffAfterDriving].ts).toBe(rowsOf(full).find((r, i, a) => i > 0 && r.statusKey === 'ignitionOff' && a[i - 1].statusKey === 'driving').ts)
    // No two same-status repeats closer than the interval.
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].statusKey === rows[i - 1].statusKey) expect(rows[i].ts - rows[i - 1].ts).toBeGreaterThanOrEqual(300)
    }
    // Distance is identical — thinning drops rows, not kilometres.
    expect(thin.vehicles[0].totalDistanceKm).toBeCloseTo(full.vehicles[0].totalDistanceKm, 9)
  })

  it('fills Driver ID from the injected lookup, else the device metadata', () => {
    const vehicles = [{ id: 1, name: 'Unit 1', ident: '863071011234501', master: { driver: { name: 'Legacy Name' } } }]
    expect(deriveMovementReport(trip(), { vehicles }).vehicles[0].driverId).toBe('Legacy Name')
    const named = deriveMovementReport(trip(), { vehicles, driverNameFor: v => (v.ident === '863071011234501' ? 'Ahmed Khan' : '') })
    expect(named.vehicles[0].driverId).toBe('Ahmed Khan')
    // A device with no metadata row at all still renders, with a blank cell.
    expect(deriveMovementReport(trip(), { driverNameFor: () => 'x' }).vehicles[0].driverId).toBe('')
  })
})
