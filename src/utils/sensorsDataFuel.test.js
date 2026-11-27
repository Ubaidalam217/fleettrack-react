import { describe, expect, it } from 'vitest'
import { computeSensors } from './sensorsData'

// Invented SMART5-like telemetry: fuel over CAN, nothing on fuel.sensor.value.
const NOW = 1_800_000_000
const msg = (ts, extra) => ({ timestamp: ts, 'engine.ignition.status': true, ...extra })

describe('Fuel Monitoring from the fuel pipeline', () => {
  const messages = [msg(NOW - 600, { 'can.fuel.consumed.high.resolution': 5671.2, 'can.fuel.volume': 22 }), msg(NOW - 60, { 'can.fuel.consumed.high.resolution': 5677.2, 'can.fuel.volume': 22 })]

  it('falls back to can.fuel.volume in litres for a vehicle with no fuel configuration', () => {
    const f = computeSensors(messages, {}, null, NOW).fuel
    expect(f).toMatchObject({ levelUnit: 'L', currentLevel: 22, consumedToday: expect.closeTo(6, 5), fillEvents: null, theftEvents: null })
  })

  it('shows nothing for a CAN volume of 0 and keeps the percent logic for fuel.sensor.value', () => {
    expect(computeSensors([msg(NOW - 5, { 'can.fuel.volume': 0 })], {}, null, NOW).fuel).toBeNull()
    const pct = computeSensors([msg(NOW - 60, { 'fuel.sensor.value': 40 }), msg(NOW - 30, { 'fuel.sensor.value': 55 })], { fuelLevel: 55 }, null, NOW).fuel
    expect(pct).toMatchObject({ levelUnit: '%', currentLevel: 55, fillEvents: 1 })
  })

  it('uses the calibrated latest reading, the fuel report events and its own used figure', () => {
    const info = {
      calibration: { method: 'CAN_VOLUME' }, calibrated: true, latest: { raw: 22, litres: 22, ts: new Date((NOW - 120) * 1000).toISOString() },
      series: [{ ts: 1, v: 30 }], summary: { readings: 5, used: 8 },
      events: [{ kind: 'fill', litres: 40 }, { kind: 'drain', litres: 20 }, { kind: 'drain', litres: 16 }],
    }
    const f = computeSensors([msg(NOW - 60, {})], {}, info, NOW).fuel
    expect(f).toMatchObject({ levelUnit: 'L', currentLevel: 22, consumedToday: 8, fillEvents: 1, theftEvents: 2, note: null })
  })

  it('shows the raw value and a not-calibrated note without a table, and a stale value as the last one', () => {
    const info = { calibration: null, calibrated: false, latest: { raw: 84, litres: null, ts: new Date((NOW - 7200) * 1000).toISOString() }, series: [{ ts: 1, v: 84 }], events: [], summary: { readings: 1 } }
    const f = computeSensors([], {}, info, NOW).fuel
    expect(f).toMatchObject({ levelUnit: 'raw', note: 'not calibrated', currentLevel: null, lastLevel: 84, fillEvents: null })
  })

  it('prefers the device’s day counter over the series for consumption', () => {
    const info = { calibration: { method: 'AIN1' }, calibrated: true, latest: { raw: 1, litres: 10, ts: new Date(NOW * 1000).toISOString() }, series: [], summary: { readings: 4, used: 3 }, events: [] }
    expect(computeSensors(messages, {}, info, NOW).fuel.consumedToday).toBeCloseTo(6, 5)
  })
})
