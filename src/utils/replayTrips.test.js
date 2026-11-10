import { describe, expect, it } from 'vitest'
import {
  pointToMessage, tripsFromPoints, tripPoints, tripTotals, fmtDuration, fmtHms, visibleReplayTrips,
  exportFileName, buildKml, buildGpx, xmlEscape, isoTime, tripNoByIndex, ignitionText,
} from './replayTrips'
import { deriveTrips } from './usageReports'

// 2026-11-10 08:00 local
const T0 = Math.floor(new Date(2026, 10, 10, 8, 0, 0).getTime() / 1000)

// A replay point as fetchDeviceTrack builds it. ~9 m/s north per second of dt.
const pt = (dt, o = {}) => ({
  ts: T0 + dt,
  lat: 25.2 + dt * 0.00008,
  lng: 55.3,
  speed: 0,
  heading: 0,
  ignition: true,
  status: 'Idle',
  ...o,
})

// Two drives with a parked hour between them.
const DAY = [
  pt(0, { ignition: false }),
  pt(60),                                   // trip 1 starts (on, idle)
  pt(120, { speed: 40, heading: 10 }),
  pt(180, { speed: 50, heading: 20 }),
  pt(240, { speed: 30 }),
  pt(300, { ignition: false }),             // trip 1 ends
  pt(1800, { ignition: false }),
  pt(3600),                                 // trip 2 starts
  pt(3660, { speed: 60 }),
  pt(3720, { speed: 70 }),
  pt(3780, { ignition: false }),            // trip 2 ends
  pt(5000, { ignition: false }),
]

describe('pointToMessage', () => {
  it('maps a replay point onto the Flespi keys deriveTrips reads', () => {
    expect(pointToMessage(pt(10, { speed: 33, heading: 90, mileage: 1200.5, valid: true }))).toEqual({
      timestamp: T0 + 10,
      'position.latitude': 25.2 + 10 * 0.00008,
      'position.longitude': 55.3,
      'position.speed': 33,
      'position.direction': 90,
      'engine.ignition.status': true,
      'vehicle.mileage': 1200.5,
      'position.valid': true,
    })
  })

  it('leaves ignition out when the device did not report it, so trips fall back to movement', () => {
    const m = pointToMessage(pt(0, { ignition: null, speed: null }))
    expect('engine.ignition.status' in m).toBe(false)
    expect(m['position.speed']).toBe(0)
    expect('vehicle.mileage' in m).toBe(false)
  })
})

describe('tripsFromPoints', () => {
  it('cuts the same trips as the Trip Report rule, numbered in order', () => {
    const trips = tripsFromPoints(DAY)
    const reference = deriveTrips(DAY.map(pointToMessage))
    expect(trips).toHaveLength(2)
    expect(trips).toHaveLength(reference.length)
    expect(trips.map(t => t.no)).toEqual([1, 2])
    trips.forEach((t, i) => {
      expect(t.startTs).toBe(reference[i].startTs)
      expect(t.endTs).toBe(reference[i].endTs)
      expect(t.distanceKm).toBeCloseTo(reference[i].distanceKm, 9)
      expect(t.maxSpeed).toBe(reference[i].maxSpeed)
    })
    expect(trips[0]).toMatchObject({ startTs: T0 + 60, endTs: T0 + 300, durationSec: 240, maxSpeed: 50, open: false })
    expect(trips[1]).toMatchObject({ startTs: T0 + 3600, endTs: T0 + 3780, maxSpeed: 70 })
    expect(trips[0].distanceKm).toBeGreaterThan(0)
  })

  it('records the slice of points each trip covers', () => {
    const [t1, t2] = tripsFromPoints(DAY)
    expect([t1.fromIdx, t1.toIdx, t1.pointCount]).toEqual([1, 5, 5])
    expect([t2.fromIdx, t2.toIdx, t2.pointCount]).toEqual([7, 10, 4])
    const slice = tripPoints(DAY, t2)
    expect(slice).toHaveLength(4)
    expect(slice[0]).toBe(DAY[7])              // the loaded points, not copies
    expect(slice[slice.length - 1]).toBe(DAY[10])
  })

  it('ends a trip at a data gap longer than 30 minutes', () => {
    const trips = tripsFromPoints([
      pt(0), pt(60, { speed: 20 }), pt(120, { speed: 20 }),
      pt(120 + 31 * 60, { speed: 20 }), pt(120 + 32 * 60, { ignition: false }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].endTs).toBe(T0 + 120)
    expect(trips[1].startTs).toBe(T0 + 120 + 31 * 60)
  })

  it('keeps a trip still running at the end of the range, flagged open', () => {
    const trips = tripsFromPoints([pt(0, { ignition: false }), pt(60), pt(120, { speed: 30 })])
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({ open: true, endTs: T0 + 120, fromIdx: 1, toIdx: 2 })
  })

  it('falls back to movement for a device that never reports ignition', () => {
    const trips = tripsFromPoints([
      pt(0, { ignition: null }), pt(60, { ignition: null, speed: 30 }),
      pt(120, { ignition: null, speed: 30 }), pt(180, { ignition: null }),
    ])
    expect(trips).toHaveLength(1)
    expect(trips[0].startTs).toBe(T0 + 60)
    expect(trips[0].endTs).toBe(T0 + 180)
  })

  it('returns nothing for no points or an ignition that never came on', () => {
    expect(tripsFromPoints([])).toEqual([])
    expect(tripsFromPoints(null)).toEqual([])
    expect(tripsFromPoints([pt(0, { ignition: false }), pt(60, { ignition: false })])).toEqual([])
  })

  it('tripPoints with no trip is the whole range', () => {
    expect(tripPoints(DAY, null)).toBe(DAY)
  })
})

describe('visibleReplayTrips', () => {
  // DAY plus an ignition flicker in the yard between the two drives.
  const withFlicker = [
    ...DAY.slice(0, 6),
    pt(1000, { ignition: true }), pt(1007, { ignition: false }),
    ...DAY.slice(6),
  ]

  it('hides 0 km trips by default, as the Trip Report does, and renumbers the rest', () => {
    const all = tripsFromPoints(withFlicker)
    expect(all).toHaveLength(3)
    expect(all[1].distanceKm).toBe(0)
    const { trips, hidden } = visibleReplayTrips(all)
    expect(hidden).toBe(1)
    expect(trips.map(t => t.no)).toEqual([1, 2])
    expect(trips[1].startTs).toBe(all[2].startTs)
    expect([trips[1].fromIdx, trips[1].toIdx]).toEqual([all[2].fromIdx, all[2].toIdx])
  })

  it('shows them all on request, unchanged', () => {
    const all = tripsFromPoints(withFlicker)
    const { trips, hidden } = visibleReplayTrips(all, false)
    expect(trips).toBe(all)
    expect(hidden).toBe(0)
  })

  it('returns the same array when nothing is hidden', () => {
    const all = tripsFromPoints(DAY)
    expect(visibleReplayTrips(all).trips).toBe(all)
  })
})

describe('tripTotals', () => {
  it('sums distance and duration and keeps the top speed', () => {
    const trips = tripsFromPoints(DAY)
    const t = tripTotals(trips)
    expect(t.trips).toBe(2)
    expect(t.maxSpeed).toBe(70)
    expect(t.durationSec).toBe(240 + 180)
    expect(t.distanceKm).toBeCloseTo(trips[0].distanceKm + trips[1].distanceKm, 9)
  })
})

describe('formatting', () => {
  it('fmtDuration', () => {
    expect(fmtDuration(45)).toBe('45s')
    expect(fmtDuration(12 * 60 + 5)).toBe('12m')
    expect(fmtDuration(3600 + 5 * 60)).toBe('1h 05m')
    expect(fmtDuration(NaN)).toBe('—')
  })

  it('fmtHms', () => {
    expect(fmtHms(2 * 3600 + 7 * 60 + 45)).toBe('02:07:45')
    expect(fmtHms(undefined)).toBe('')
  })

  it('isoTime is UTC without milliseconds', () => {
    expect(isoTime(Date.UTC(2026, 10, 10, 4, 5, 6) / 1000)).toBe('2026-11-10T04:05:06Z')
  })

  it('xmlEscape', () => {
    expect(xmlEscape(`A&B <"C"> 'D'`)).toBe('A&amp;B &lt;&quot;C&quot;&gt; &apos;D&apos;')
  })

  it('ignitionText', () => {
    expect([ignitionText(true), ignitionText(false), ignitionText(null)]).toEqual(['On', 'Off', ''])
  })
})

describe('exportFileName', () => {
  it('names a trip by vehicle, day and trip number', () => {
    const [, t2] = tripsFromPoints(DAY)
    expect(exportFileName('KM 6651 F', DAY, t2, 'kml')).toBe('KM_6651_F_2026-11-10_trip-2.kml')
  })

  it('names the whole range by its day, or its first and last day', () => {
    expect(exportFileName('KM 6651 F', DAY, null, 'xlsx')).toBe('KM_6651_F_2026-11-10_replay.xlsx')
    const twoDays = [...DAY, pt(86400 + 60)]
    expect(exportFileName('KM 6651 F', twoDays, null, 'gpx')).toBe('KM_6651_F_2026-11-10_to_2026-11-11_replay.gpx')
  })

  it('keeps file-system-hostile characters out of the name', () => {
    expect(exportFileName('TEST / Falcon: "A"', DAY, null, 'kml')).toBe('TEST_Falcon_A_2026-11-10_replay.kml')
    expect(exportFileName('', [], null, 'kml')).toBe('vehicle_replay.kml')
  })
})

describe('buildKml', () => {
  const [, t2] = tripsFromPoints(DAY)
  const pts = tripPoints(DAY, t2)
  const kml = buildKml(pts, { title: 'KM 6651 F — Trip 2', description: 'Trip 2', startLabel: 'Musaffah & Co', endLabel: 'Base' })
  const count = re => (kml.match(re) ?? []).length

  it('is a KML document with the Google extension namespace', () => {
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(kml).toContain('xmlns="http://www.opengis.net/kml/2.2"')
    expect(kml).toContain('xmlns:gx="http://www.google.com/kml/ext/2.2"')
    expect(kml.trim().endsWith('</kml>')).toBe(true)
  })

  it('carries one <when>, <gx:coord>, <gx:angles> and speed value per point, so the time slider replays it', () => {
    expect(count(/<gx:Track>/g)).toBe(1)
    expect(count(/<when>/g)).toBe(pts.length)
    expect(count(/<gx:coord>/g)).toBe(pts.length)
    expect(count(/<gx:angles>/g)).toBe(pts.length)
    expect(count(/<gx:value>/g)).toBe(pts.length)
    expect(kml).toContain(`<when>${isoTime(pts[0].ts)}</when>`)
    // lng lat alt, in that order
    expect(kml).toContain(`<gx:coord>55.3 ${Math.round(pts[0].lat * 1e6) / 1e6} 0</gx:coord>`)
    expect(kml).toContain('<gx:value>70</gx:value>')
  })

  it('adds start and end placemarks at the first and last point, escaping place names', () => {
    expect(kml).toContain('<name>Start</name>')
    expect(kml).toContain('<name>End</name>')
    expect(kml).toContain('Musaffah &amp; Co')
    const last = pts[pts.length - 1]
    expect(kml).toContain(`<coordinates>55.3,${Math.round(last.lat * 1e6) / 1e6},0</coordinates>`)
    expect(kml).toContain('<name>KM 6651 F — Trip 2</name>')
  })

  it('skips points without a time or a position', () => {
    const k = buildKml([...pts, { ts: null, lat: 1, lng: 2 }, { ts: T0, lat: null, lng: 2 }])
    expect((k.match(/<when>/g) ?? []).length).toBe(pts.length)
  })

  it('stays a valid document with no points', () => {
    const k = buildKml([], { title: 'Empty' })
    expect(k).toContain('<Document>')
    expect(k).not.toContain('<gx:Track>')
  })

  it('keeps the last known heading for a point without one', () => {
    const k = buildKml([pt(0, { heading: 90 }), pt(10, { heading: null }), pt(20, { heading: 180 })])
    expect(k.match(/<gx:angles>[^<]+<\/gx:angles>/g)).toEqual([
      '<gx:angles>90 0 0</gx:angles>', '<gx:angles>90 0 0</gx:angles>', '<gx:angles>180 0 0</gx:angles>',
    ])
  })
})

describe('buildGpx', () => {
  it('is GPX 1.1 with start/end waypoints and one track point per point', () => {
    const gpx = buildGpx(DAY, { title: 'A <b>', startLabel: 'Here' })
    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"')
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(DAY.length)
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(2)
    expect(gpx).toContain('<name>A &lt;b&gt;</name>')
    expect(gpx).toContain('<desc>Here</desc>')
    // Waypoints come before the track, as the 1.1 schema orders them.
    expect(gpx.indexOf('<wpt ')).toBeLessThan(gpx.indexOf('<trk>'))
  })
})

describe('tripNoByIndex', () => {
  it('maps each covered point index to its trip number', () => {
    const m = tripNoByIndex(tripsFromPoints(DAY))
    expect(m.get(0)).toBeUndefined()
    expect(m.get(1)).toBe(1)
    expect(m.get(5)).toBe(1)
    expect(m.get(6)).toBeUndefined()
    expect(m.get(7)).toBe(2)
    expect(m.get(10)).toBe(2)
  })
})
