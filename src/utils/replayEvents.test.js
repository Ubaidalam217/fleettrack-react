import { describe, expect, it } from 'vitest'
import {
  EVENT_GROUPS, DEFAULT_HIDDEN_GROUPS, groupOfType, fromAlertEvents, harshFromTrack, ignitionFromTrack,
  buildReplayEvents, groupCounts, visibleEvents, eventsByTrip, eventBadges, eventSummary, fmtEventDuration,
} from './replayEvents'

const T0 = Math.floor(new Date(2026, 10, 13, 7, 30, 0).getTime() / 1000)
const iso = ts => new Date(ts * 1000).toISOString()

// Flespi-shaped messages, one every 5 s.
const msg = (dt, speed, ign = true) => ({
  timestamp: T0 + dt,
  'position.latitude': 24.4 + dt * 0.00001,
  'position.longitude': 54.5,
  'position.speed': speed,
  'engine.ignition.status': ign,
})

const DRIVE = [
  msg(0, 0, false), msg(5, 0, true), msg(10, 40), msg(15, 60), msg(20, 85), msg(25, 92), msg(30, 98),
  msg(35, 70), msg(40, 50),
  // A hard stop: 50 → 10 km/h in 2 s is 5.6 m/s².
  msg(42, 10), msg(47, 10), msg(52, 0), msg(57, 0, false),
]

describe('groups', () => {
  it('puts every alert type about a drive in one chip, and leaves paperwork out', () => {
    expect(groupOfType('overspeed').key).toBe('overspeed')
    expect(groupOfType('harsh_braking').key).toBe('harsh')
    expect(groupOfType('geofence_exit').key).toBe('geofence')
    expect(groupOfType('panic').key).toBe('sos')
    expect(groupOfType('battery_tamper').key).toBe('battery')
    expect(groupOfType('geofence_speed').key).toBe('zoneSpeed')
    expect(groupOfType('license_expiry')).toBeNull()
    expect(groupOfType('reminder')).toBeNull()
  })

  it('hides ignition by default', () => {
    expect(DEFAULT_HIDDEN_GROUPS).toEqual(['ignition'])
    const keys = EVENT_GROUPS.map(g => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('fromAlertEvents', () => {
  it('uses the stored episode: From, To, Duration, peak speed and the rule limit', () => {
    const [e] = fromAlertEvents([{
      id: 'x1', type: 'overspeed', title: 'Adnoc-over-speed', message: 'Speed 98 km/h (limit 80 km/h)',
      occurredAt: iso(T0 + 20), endedAt: iso(T0 + 120), durationSec: 100, peakValue: 98, value: 85,
      lat: 24.41, lng: 54.51, driverId: 'd1',
    }], DRIVE)
    expect(e).toMatchObject({
      id: 'a:x1', group: 'overspeed', label: 'Overspeed', source: 'alert',
      fromTs: T0 + 20, toTs: T0 + 120, durationSec: 100, speed: 98, limit: 80,
      lat: 24.41, lng: 54.51, driverId: 'd1', title: 'Adnoc-over-speed',
    })
  })

  it('reads an older event\'s span off the track by the rule', () => {
    const [e] = fromAlertEvents([{
      id: 'x2', type: 'overspeed', message: 'Speed 92 km/h (limit 80 km/h)', occurredAt: iso(T0 + 25), value: 92,
    }], DRIVE)
    expect(e.fromTs).toBe(T0 + 20)
    expect(e.durationSec).toBeGreaterThan(0)
    expect(e.speed).toBe(98)
    expect(e.lat).toBeCloseTo(24.4002)
  })

  it('gives one-time events a moment only — no To, no Duration', () => {
    const [sos] = fromAlertEvents([{ id: 's', type: 'panic', occurredAt: iso(T0 + 30), endedAt: iso(T0 + 90), durationSec: 60 }], DRIVE)
    expect(sos).toMatchObject({ fromTs: T0 + 30, toTs: T0 + 30, durationSec: null, group: 'sos', label: 'SOS' })
  })

  it('drops types that are not about a drive, and says no Duration when none is known', () => {
    expect(fromAlertEvents([{ id: 'l', type: 'license_expiry', occurredAt: iso(T0) }], DRIVE)).toEqual([])
    const [idle] = fromAlertEvents([{ id: 'i', type: 'idle', occurredAt: iso(T0 + 9000) }], DRIVE)
    expect(idle.durationSec).toBeNull()
  })
})

describe('events read off the track', () => {
  it('finds the hard stop, unless an alert already reported it', () => {
    const found = harshFromTrack(DRIVE)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ type: 'harsh_braking', group: 'harsh', source: 'track', fromTs: T0 + 40, speed: 50, durationSec: null })
    const alerts = fromAlertEvents([{ id: 'h', type: 'harsh_braking', occurredAt: iso(T0 + 41) }], DRIVE)
    expect(harshFromTrack(DRIVE, alerts)).toEqual([])
  })

  it('turns every ignition change into an on / off event', () => {
    const ign = ignitionFromTrack(DRIVE)
    expect(ign.map(e => [e.type, e.fromTs - T0])).toEqual([['ignition_on', 5], ['ignition_off', 57]])
    expect(ign.every(e => e.group === 'ignition' && e.durationSec === null)).toBe(true)
  })

  it('buildReplayEvents merges both sources, oldest first', () => {
    const all = buildReplayEvents([{ id: 'p', type: 'panic', occurredAt: iso(T0 + 30) }], DRIVE)
    expect(all.map(e => e.type)).toEqual(['ignition_on', 'panic', 'harsh_braking', 'ignition_off'])
  })
})

describe('grouping', () => {
  const ev = (id, type, ts, extra = {}) => ({ ...fromAlertEvents([{ id, type, occurredAt: iso(ts) }], [])[0], ...extra })
  const events = [
    ev('1', 'overspeed', T0 + 100, { durationSec: 65, speed: 92 }),
    ev('2', 'overspeed', T0 + 600, { durationSec: 100, speed: 98 }),
    ev('3', 'idle', T0 + 1500, { durationSec: 372 }),
    ev('4', 'tamper', T0 + 9000),
    ev('5', 'ignition_on', T0 + 50),
  ]
  const trips = [
    { no: 1, startTs: T0, endTs: T0 + 2000 },
    { no: 2, startTs: T0 + 5000, endTs: T0 + 6000 },
  ]

  it('counts per chip: core chips always, others only when present', () => {
    const counts = groupCounts(events)
    expect(counts.map(g => [g.key, g.count])).toEqual([
      ['overspeed', 2], ['harsh', 0], ['idle', 1], ['geofence', 0], ['ignition', 1], ['tamper', 1],
    ])
  })

  it('filters out switched-off groups', () => {
    expect(visibleEvents(events, new Set(['ignition', 'overspeed'])).map(e => e.id)).toEqual(['a:3', 'a:4'])
    expect(visibleEvents(events, [])).toBe(events)
  })

  it('puts each event in the trip it began in, the rest outside', () => {
    const { byTrip, outside } = eventsByTrip(events, trips)
    expect(byTrip.get(T0).map(e => e.id)).toEqual(['a:1', 'a:2', 'a:3', 'a:5'])
    expect(byTrip.get(T0 + 5000)).toEqual([])
    expect(outside.map(e => e.id)).toEqual(['a:4'])
  })

  it('badges a trip per kind, in chip order', () => {
    expect(eventBadges(events).map(b => b.text)).toEqual(['2 overspeed', '1 idle', '1 ignition', '1 tamper'])
    expect(eventBadges([])).toEqual([])
  })

  it('summarises an event for the trip list', () => {
    expect(eventSummary(events[1])).toBe('Overspeed · 1m 40s · 98 km/h')
    expect(eventSummary(events[2])).toBe('Idle · 6m 12s')
    expect(eventSummary({ type: 'harsh_braking', label: 'Harsh braking', durationSec: null, speed: 62.4 })).toBe('Harsh braking · 62 km/h')
    expect(fmtEventDuration(45)).toBe('45s')
    expect(fmtEventDuration(65)).toBe('1m 05s')
    expect(fmtEventDuration(3720)).toBe('1h 02m')
  })
})
