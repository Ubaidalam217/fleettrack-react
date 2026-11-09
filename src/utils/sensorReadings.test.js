import { describe, expect, it } from 'vitest'
import { probeTemperature, messageTemperature, liveTemperature, liveFuelLevel, isFresh } from './sensorReadings'
import { computeSensors } from './sensorsData'

// Shapes taken from the 2026-11-09 probe of the real trackers.
const testBench = { 'ble.sensor.temperature.1': 23.67, 'ble.sensor.humidity.1': 57, 'ble.sensor.battery.voltage.1': 3.1 }
const dropout = { 'ble.sensor.temperature.1': 0, 'ble.sensor.humidity.1': 0, 'ble.sensor.battery.voltage.1': 0 }
const noProbe = { 'ble.sensor.temperature.1': 0, 'ble.sensor.humidity.1': 0 } // AD 12411, KM 6168 E

describe('probeTemperature', () => {
  it('keeps real readings, drops a no-probe or dropout 0, keeps a lone 0 °C', () => {
    expect(probeTemperature(testBench)).toBe(23.67)
    expect(probeTemperature(dropout)).toBeNull()
    expect(probeTemperature(noProbe)).toBeNull()
    expect(probeTemperature({ 'ble.sensor.temperature.1': 0, 'ble.sensor.humidity.1': 80 })).toBe(0) // a cold room
    expect(probeTemperature({ 'ble.sensor.temperature.1': 0 })).toBe(0)
    expect(probeTemperature({})).toBeNull()
  })
  it('averages only the probes that really report', () => {
    expect(messageTemperature({ ...testBench, 'ble.sensor.temperature.2': 25.67 })).toBeCloseTo(24.67)
    expect(messageTemperature(noProbe)).toBeNull()
  })
})

describe('live readings', () => {
  const now = 1_800_000_000
  it('is current only while its own field is fresh', () => {
    expect(isFresh(now - 60, now)).toBe(true)
    expect(isFresh(now - 3600, now)).toBe(false)
    const tel = Object.fromEntries(Object.entries(testBench).map(([k, value]) => [k, { value, ts: now - 30 }]))
    expect(liveTemperature(tel, now)).toBe(23.67)
    const stale = Object.fromEntries(Object.entries(testBench).map(([k, value]) => [k, { value, ts: now - 7200 }]))
    expect(liveTemperature(stale, now)).toBeNull()
    const zeros = Object.fromEntries(Object.entries(noProbe).map(([k, value]) => [k, { value, ts: now - 30 }]))
    expect(liveTemperature(zeros, now)).toBeNull()
    // AD 12944-R14: fuel 0 % last sent in July.
    expect(liveFuelLevel({ 'fuel.sensor.value': { value: 0, ts: now - 120 * 86400 } }, now)).toBeNull()
    expect(liveFuelLevel({ 'fuel.sensor.value': { value: 64, ts: now - 60 } }, now)).toBe(64)
  })
})

describe('computeSensors (Sensors tab)', () => {
  it('hides temperature for a vehicle with no probe, and a dropout does not pull Min to 0', () => {
    const msgs = [noProbe, noProbe].map((m, i) => ({ ...m, timestamp: 100 + i }))
    expect(computeSensors(msgs, {}).temperature).toBeNull()

    const bench = [
      { ...testBench, timestamp: 100 },
      { ...dropout, timestamp: 101 },
      { ...testBench, 'ble.sensor.temperature.1': 21.06, timestamp: 102 },
    ]
    const t = computeSensors(bench, { temperature: null }).temperature
    expect(t.min).toBeCloseTo(21.06)
    expect(t.current).toBeNull()
    expect(t.last).toBeCloseTo(21.06)
    expect(t.lastAt).toBe(102)
  })

  it('hides fuel when the level never leaves 0 and the CAN counter is 0', () => {
    const can = [0, 1, 2].map(i => ({ 'fuel.sensor.value': 0, 'can.fuel.consumed': 0, timestamp: 100 + i }))
    expect(computeSensors(can, { fuelLevel: null }).fuel).toBeNull()
    const real = [
      { 'fuel.sensor.value': 70, 'can.fuel.consumed': 5000, timestamp: 100 },
      { 'fuel.sensor.value': 66, 'can.fuel.consumed': 5012.5, timestamp: 200 },
    ]
    const f = computeSensors(real, { fuelLevel: null }).fuel
    expect(f).toMatchObject({ currentLevel: null, lastLevel: 66, lastLevelAt: 200, consumedToday: 12.5 })
  })
})
