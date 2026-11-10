import { describe, expect, it } from 'vitest'
import {
  derivePowerCuts, powerState, sumCuts, visibleCuts, powerCutsByVehicle, volts, batteryVolts, POWER_FIELDS,
} from './powerFailure'

// 2026-11-10 08:00 local
const T0 = Math.floor(new Date(2026, 10, 10, 8, 0, 0).getTime() / 1000)
const msg = (dt, o = {}) => ({
  timestamp: T0 + dt,
  'external.powersource.voltage': 12.4,
  'battery.voltage': 4.1,
  'engine.ignition.status': false,
  'position.latitude': 25.2,
  'position.longitude': 55.3,
  ...o,
})
const V = v => ({ 'external.powersource.voltage': v })

describe('powerState', () => {
  it('reads the voltage against the threshold', () => {
    expect(powerState(msg(0, V(12.1)))).toBe(true)
    expect(powerState(msg(0, V(6)))).toBe(true)
    expect(powerState(msg(0, V(5.9)))).toBe(false)
    expect(powerState(msg(0, V(11)), 11.5)).toBe(false)
  })

  it('treats a false status as no power even with a normal voltage', () => {
    expect(powerState(msg(0, { 'external.powersource.status': false }))).toBe(false)
  })

  it('does not let a true status override a low voltage', () => {
    expect(powerState(msg(0, { ...V(0), 'external.powersource.status': true }))).toBe(false)
  })

  it('falls back to the status without a voltage, and says nothing with neither', () => {
    expect(powerState({ timestamp: T0, 'external.powersource.status': true })).toBe(true)
    expect(powerState({ timestamp: T0, 'external.powersource.status': false })).toBe(false)
    expect(powerState({ timestamp: T0, 'battery.voltage': 4 })).toBe(null)
  })
})

describe('derivePowerCuts', () => {
  it('cuts from the first low reading to the first normal one, with lowest volts, battery and ignition at the cut', () => {
    const cuts = derivePowerCuts([
      msg(0),
      msg(60, { ...V(1.4), 'battery.voltage': 3.95, 'engine.ignition.status': true, 'position.latitude': 25.21 }),
      msg(120, { ...V(0), 'battery.voltage': 3.9 }),
      msg(300, V(12.2)),
      msg(400),
    ])
    expect(cuts).toHaveLength(1)
    const c = cuts[0]
    expect(c.startTs).toBe(T0 + 60)
    expect(c.endTs).toBe(T0 + 300)
    expect(c.durationSec).toBe(240)
    expect(c.minVoltage).toBe(0)
    expect(c.batteryV).toBe(3.95)
    expect(c.ignition).toBe(true)
    expect(c.lat).toBe(25.21)
    expect(c.open).toBe(false)
    expect(c.beforePeriod).toBe(false)
  })

  it('finds each cut separately, short flickers included', () => {
    const cuts = derivePowerCuts([
      msg(0), msg(10, V(2)), msg(15), msg(100), msg(200, V(0)), msg(800, V(0)), msg(900),
    ])
    expect(cuts.map(c => c.durationSec)).toEqual([5, 700])
  })

  it('honours a different threshold', () => {
    const msgs = [msg(0, V(24)), msg(60, V(9)), msg(120, V(24))]
    expect(derivePowerCuts(msgs)).toHaveLength(0)
    expect(derivePowerCuts(msgs, { cutBelowV: 10 })).toHaveLength(1)
  })

  it('starts a cut on a false status before the voltage drops, and ends it on the voltage, not a true status with low volts', () => {
    const cuts = derivePowerCuts([
      msg(0),
      msg(30, { 'external.powersource.status': false }),       // event first, voltage still 12.4
      msg(31, V(0)),
      msg(600, { ...V(0), 'external.powersource.status': true }), // event a second early
      msg(601, V(24.5)),
    ])
    expect(cuts).toHaveLength(1)
    expect(cuts[0].startTs).toBe(T0 + 30)
    expect(cuts[0].endTs).toBe(T0 + 601)
    expect(cuts[0].minVoltage).toBe(0)
  })

  it('keeps one cut when the restore event comes but the voltage stays low', () => {
    const cuts = derivePowerCuts([
      msg(0), msg(60, V(0)), msg(120, { ...V(4.5), 'external.powersource.status': true }), msg(180, V(4.5)), msg(240),
    ])
    expect(cuts).toHaveLength(1)
    expect(cuts[0].durationSec).toBe(180)
  })

  it('marks a cut already under way at the first reading', () => {
    const cuts = derivePowerCuts([msg(0, V(0)), msg(120)])
    expect(cuts[0].beforePeriod).toBe(true)
    expect(cuts[0].startTs).toBe(T0)
  })

  it('does not mark it when the first reading is the tracker’s own power-lost event', () => {
    const cuts = derivePowerCuts([msg(0, { ...V(0), 'external.powersource.status': false }), msg(120)])
    expect(cuts[0].beforePeriod).toBe(false)
  })

  it('leaves a cut open to the end of the period, or to the last message without one', () => {
    const msgs = [msg(0), msg(60, V(0)), msg(300, V(0))]
    const [withEnd] = derivePowerCuts(msgs, { periodEndTs: T0 + 3600 })
    expect(withEnd.open).toBe(true)
    expect(withEnd.endTs).toBe(null)
    expect(withEnd.durationSec).toBe(3540)
    const [noEnd] = derivePowerCuts(msgs)
    expect(noEnd.durationSec).toBe(240)
  })

  it('does not end a cut across messages with no power reading, and takes values from the last known before it', () => {
    const cuts = derivePowerCuts([
      msg(0, { 'engine.ignition.status': true, 'position.latitude': 25.3 }),
      { timestamp: T0 + 60, ...V(0) },                       // no ignition, battery or position on the cut message
      { timestamp: T0 + 120, 'battery.voltage': 3.8 },        // no reading: state unchanged
      msg(180),
    ])
    expect(cuts).toHaveLength(1)
    expect(cuts[0].durationSec).toBe(120)
    expect(cuts[0].ignition).toBe(true)
    expect(cuts[0].batteryV).toBe(4.1)
    expect(cuts[0].lat).toBe(25.3)
  })

  it('fills the position from inside the cut when none came before it', () => {
    const cuts = derivePowerCuts([
      { timestamp: T0, ...V(12) },
      { timestamp: T0 + 60, ...V(0) },
      { timestamp: T0 + 90, ...V(0), 'position.latitude': 25.4, 'position.longitude': 55.1 },
      { timestamp: T0 + 120, ...V(12) },
    ])
    expect(cuts[0].lat).toBe(25.4)
    expect(cuts[0].lng).toBe(55.1)
    expect(cuts[0].batteryV).toBe(null)
    expect(cuts[0].ignition).toBe(null)
  })

  it('ignores 0,0 positions and messages without a timestamp; no readings means no cuts', () => {
    const cuts = derivePowerCuts([
      msg(0),
      { ...msg(60, V(0)), 'position.latitude': 0, 'position.longitude': 0 },
      { 'external.powersource.voltage': 12 },
      msg(120),
    ])
    expect(cuts).toHaveLength(1)
    expect(cuts[0].lat).toBe(25.2)
    expect(derivePowerCuts([{ timestamp: T0 }, { timestamp: T0 + 60 }])).toEqual([])
    expect(derivePowerCuts(undefined)).toEqual([])
  })
})

describe('sumCuts / visibleCuts', () => {
  const cuts = [
    { durationSec: 30, minVoltage: 2.1, open: false },
    { durationSec: 600, minVoltage: 0, open: false },
    { durationSec: 20, minVoltage: null, open: true },
  ]

  it('counts the cuts, the time without power and the lowest voltage', () => {
    expect(sumCuts(cuts)).toEqual({ cuts: 3, offSec: 650, lowestV: 0, open: 1 })
    expect(sumCuts([])).toEqual({ cuts: 0, offSec: 0, lowestV: null, open: 0 })
  })

  it('hides cuts shorter than the minimum, but never an open one', () => {
    expect(visibleCuts(cuts, 0)).toEqual({ cuts, hidden: 0 })
    const v = visibleCuts(cuts, 1)
    expect(v.hidden).toBe(1)
    expect(v.cuts.map(c => c.durationSec)).toEqual([600, 20])
  })
})

describe('powerCutsByVehicle', () => {
  it('orders by vehicle name and tells apart no cuts, no power reading and no data', () => {
    const byDevice = new Map([
      [1, { messages: [msg(0), msg(60, V(0)), msg(120)], truncated: false }],
      [2, { messages: [{ timestamp: T0, 'battery.voltage': 4 }], truncated: true }],
      [3, { messages: [], truncated: false }],
      [4, { messages: [msg(0), msg(60)], truncated: false }],
    ])
    const vehicles = [
      { id: 1, name: 'Z-dev', master: { plateNo: 'KM 6168' } },
      { id: 2, name: 'AD 12411' },
      { id: 3, name: 'AD 99' },
    ]
    const out = powerCutsByVehicle(byDevice, vehicles)
    expect(out.map(v => v.vehicleId)).toEqual(['4', 'AD 12411', 'AD 99', 'KM 6168'])
    const by = Object.fromEntries(out.map(v => [v.deviceId, v]))
    expect(by[1].cuts).toHaveLength(1)
    expect(by[1].reports).toBe(true)
    expect(by[2]).toMatchObject({ reports: false, hasData: true, truncated: true })
    expect(by[3]).toMatchObject({ reports: false, hasData: false })
    expect(by[4]).toMatchObject({ reports: true, hasData: true, cuts: [] })
  })
})

describe('formatting', () => {
  it('shows supply volts to one decimal and battery volts to two', () => {
    expect(volts(1.365)).toBe('1.4')
    expect(volts(0)).toBe('0.0')
    expect(volts(null)).toBe('—')
    expect(batteryVolts(3.872)).toBe('3.87')
    expect(batteryVolts(undefined)).toBe('—')
  })

  it('asks Flespi for the power, battery, ignition and position fields', () => {
    expect(POWER_FIELDS.split(',')).toEqual([
      'timestamp', 'external.powersource.voltage', 'external.powersource.status', 'battery.voltage',
      'engine.ignition.status', 'position.latitude', 'position.longitude',
    ])
  })
})
