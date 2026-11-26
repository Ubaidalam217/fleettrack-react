import { describe, it, expect } from 'vitest'
import { createDistanceStepper, haversineMeters, isSparseMessage } from './distance'
import {
  uffizioDistance, uffizioDayRecords, deriveUffizioMonth, estimatedUffizioIds, compareIds, hasUffizio,
  sourceOf, uaeDate, uaeMidnight,
} from './uffizioReports'
import { deriveDeviceMonth, uaeDayStart } from './daywiseCore'
import { deriveTrips } from './usageReports'

// Invented vehicles and data only (the repo is public).
const ID = 'uffizio:veh-test-1'
// 2026-11-20 00:00 UAE = 2026-11-19 20:00 UTC.
const D0 = uaeDayStart(2026, 11, 20)
const H = 3600
const LAT = 24.45, LNG = 54.38
// ~1.11 km per 0.01 degree of latitude.
const KM_PER_DEG = haversineMeters(0, 0, 1, 0) / 1000

const s = (ts, { lat = LAT, lng = LNG, speed = 0, ign = false, odo, id = ID } = {}) => ({
  'device.id': id,
  timestamp: ts,
  'position.latitude': lat,
  'position.longitude': lng,
  'position.speed': speed,
  'position.direction': 0,
  'position.valid': true,
  'engine.ignition.status': ign,
  'vehicle.mileage': odo ?? null,
  'ibutton.code': null,
  'external.powersource.voltage': 13.9,
})

/** A drive every 2 minutes from `t0` for `minutes`, north at `kmh`, odometer rising with it. */
function drive(t0, minutes, { kmh = 60, odo0 = 10_000, lat0 = LAT, withOdo = true, id = ID } = {}) {
  const out = []
  for (let k = 0; k <= minutes / 2; k++) {
    const km = (kmh * 2 * k) / 60
    out.push(s(t0 + k * 120, { lat: lat0 + km / KM_PER_DEG, speed: kmh, ign: true, odo: withOdo ? odo0 + km : undefined, id }))
  }
  return out
}

/** Parked samples every `everySec` from t0 to t1 (ignition off, odometer still, GPS drifting a few metres). */
function parked(t0, t1, { odo = 10_000, everySec = 120, lat = LAT, ign = false, withOdo = true } = {}) {
  const out = []
  for (let t = t0, k = 0; t < t1; t += everySec, k++) out.push(s(t, { lat: lat + (k % 2 ? 0.00003 : -0.00003), ign, odo: withOdo ? odo : undefined }))
  return out
}

describe('the sparse (Uffizio) distance rule', () => {
  it('is picked by the "uffizio:" device id only', () => {
    expect(isSparseMessage(s(0))).toBe(true)
    expect(isSparseMessage({ 'device.id': 4711 })).toBe(false)
    expect(isSparseMessage({})).toBe(false)
  })

  it('a normal day: the odometer, end minus start', () => {
    const msgs = [...parked(D0 + 6 * H, D0 + 8 * H), ...drive(D0 + 8 * H, 60), ...parked(D0 + 9 * H + 120, D0 + 12 * H, { odo: 10_060 })]
    const d = uffizioDistance(msgs, D0, D0 + 86400)
    expect(d.km).toBeCloseTo(60, 6)
    expect(d.source).toBe('odometer')
    expect(d.estimatedKm).toBe(0)
  })

  it('a vehicle that never moved: 0 km despite GPS drift, with or without an odometer', () => {
    expect(uffizioDistance(parked(D0, D0 + 86400), D0, D0 + 86400).km).toBe(0)
    expect(uffizioDistance(parked(D0, D0 + 86400, { withOdo: false }), D0, D0 + 86400).km).toBe(0)
    // Ignition on, idling all day: still 0 (drift stays under the step threshold).
    expect(uffizioDistance(parked(D0, D0 + 86400, { ign: true, withOdo: false }), D0, D0 + 86400).km).toBe(0)
  })

  it('an odometer reset (backwards) is measured from GPS for that stretch only', () => {
    const a = drive(D0 + 8 * H, 20, { odo0: 50_000 })             // 20 km on the odometer
    const last = a[a.length - 1]
    // Next sample 2 minutes on, 2 km further north, odometer reset to 0.
    const b = drive(last.timestamp + 120, 20, { odo0: 0, lat0: last['position.latitude'] + 2 / KM_PER_DEG })
    const d = uffizioDistance([...a, ...b], D0, D0 + 86400)
    expect(d.odometerKm).toBeCloseTo(40, 6)
    expect(d.estimatedKm).toBeCloseTo(2, 2)
    expect(d.km).toBeCloseTo(42, 2)
    expect(d.source).toBe('mixed')
  })

  it('an odometer jump forward no drive explains is left out', () => {
    const a = drive(D0 + 8 * H, 20, { odo0: 1000 })
    const last = a[a.length - 1]
    const jump = s(last.timestamp + 120, { lat: last['position.latitude'] + 2 / KM_PER_DEG, speed: 60, ign: true, odo: 1520 })
    const after = drive(last.timestamp + 240, 10, { odo0: 1520 + 2, lat0: jump['position.latitude'] + 2 / KM_PER_DEG })
    const d = uffizioDistance([...a, jump, ...after], D0, D0 + 86400)
    // 20 (odometer) + ~2 (GPS over the jump) + 2 (odometer, jump → next) + 10 (odometer)
    expect(d.km).toBeGreaterThan(33)
    expect(d.km).toBeLessThan(35)
    expect(d.source).toBe('mixed')
  })

  it('a real drive across a data gap keeps its odometer kilometres', () => {
    const a = drive(D0 + 8 * H, 10, { odo0: 2000 })               // 10 km
    const last = a[a.length - 1]
    // 50 minutes silent, then 45 km further on the odometer (54 km/h average).
    const b = drive(last.timestamp + 50 * 60, 10, { odo0: 2010 + 45, lat0: last['position.latitude'] + 30 / KM_PER_DEG })
    const d = uffizioDistance([...a, ...b], D0, D0 + 86400)
    expect(d.km).toBeCloseTo(65, 6)
    expect(d.source).toBe('odometer')
  })

  it('no odometer at all: GPS, marked estimated; an ignition-on step with speed 0 still counts when it moved', () => {
    const msgs = [
      s(D0 + 8 * H, { ign: true, speed: 0 }),
      s(D0 + 8 * H + 120, { ign: true, speed: 0, lat: LAT + 0.5 / KM_PER_DEG }),   // 500 m at a red light
      s(D0 + 8 * H + 240, { ign: true, speed: 0, lat: LAT + 0.5 / KM_PER_DEG + 0.00002 }),
    ]
    const d = uffizioDistance(msgs, D0, D0 + 86400)
    expect(d.km).toBeCloseTo(0.5, 2)
    expect(d.source).toBe('estimated')
  })

  it('leaves every Flespi device on the old rule (regression)', () => {
    // The same 500 m step without speed, as a Flespi device: the old rule counts nothing.
    const flespi = [
      { ...s(1000, { ign: true }), 'device.id': 4711, 'vehicle.mileage': undefined },
      { ...s(1120, { ign: true, lat: LAT + 0.5 / KM_PER_DEG }), 'device.id': 4711, 'vehicle.mileage': undefined },
    ]
    const step = createDistanceStepper()
    step(flespi[0])
    expect(step(flespi[1]).km).toBe(0)
  })
})

describe('uffizioDayRecords', () => {
  const day = (recs, iso) => recs.find(r => r.date === iso)

  it('a normal day: distance, driving, idle, stop, speeds, first start, last stop, one trip', () => {
    const msgs = [
      ...parked(D0 + 6 * H, D0 + 8 * H),
      s(D0 + 8 * H - 120 + 60, { ign: true, speed: 0, odo: 10_000 }),        // 07:59 ignition on, idle 1 min
      ...drive(D0 + 8 * H, 60),                                              // 08:00-09:00, 60 km
      s(D0 + 9 * H + 120, { ign: false, odo: 10_060, lat: LAT + 60 / KM_PER_DEG }),
      ...parked(D0 + 9 * H + 240, D0 + 12 * H, { odo: 10_060, lat: LAT + 60 / KM_PER_DEG }),
    ]
    const [r] = uffizioDayRecords(msgs, D0, D0 + 86400)
    expect(r.date).toBe('2026-11-20')
    expect(r.noData).toBe(false)
    expect(r.distanceKm).toBeCloseTo(60, 6)
    expect(r.distanceSource).toBe('odometer')
    expect(r.odoStart).toBe(10_000)
    expect(r.odoEnd).toBeCloseTo(10_060, 6)
    expect(r.drivingSec).toBe(3600 + 120)   // the last driving sample's interval to the ignition-off one
    expect(r.idleSec).toBe(60)
    expect(r.maxSpeed).toBe(60)
    expect(r.avgSpeed).toBe(60)
    expect(r.trips).toBe(1)
    expect(r.firstStart).toBe(D0 + 8 * H - 60)
    expect(r.lastStop).toBe(D0 + 9 * H + 120)
    expect(r.stopSec).toBeGreaterThan(4 * H)
  })

  it('ignition off all day: no trip, no driving, 0 km, the time is stopped', () => {
    const [r] = uffizioDayRecords(parked(D0, D0 + 86400, { everySec: 600 }), D0, D0 + 86400)
    expect(r.trips).toBe(0)
    expect(r.drivingSec + r.idleSec).toBe(0)
    expect(r.distanceKm).toBe(0)
    expect(r.stopSec).toBe(86400 - 600)
    expect(r.firstStart).toBeNull()
    expect(r.avgSpeed).toBeNull()
  })

  it('missing samples: a gap over 30 min is not engine time and splits the trip; the odometer still counts', () => {
    const a = drive(D0 + 8 * H, 10, { odo0: 500 })
    const last = a[a.length - 1]
    const b = drive(last.timestamp + 40 * 60, 10, { odo0: 530, lat0: last['position.latitude'] + 15 / KM_PER_DEG })
    const [r] = uffizioDayRecords([...a, ...b], D0, D0 + 86400)
    expect(r.trips).toBe(2)
    expect(r.drivingSec).toBe(2 * 600)
    expect(r.distanceKm).toBeCloseTo(40, 6)
  })

  it('a drive across UAE midnight is split between the two days; the trip counts on its start day', () => {
    const msgs = drive(D0 + 86400 - 10 * 60, 20, { odo0: 7000 })            // 23:50 → 00:10, 20 km
    const recs = uffizioDayRecords(msgs, D0, D0 + 2 * 86400)
    expect(recs.map(r => r.date)).toEqual(['2026-11-20', '2026-11-21'])
    expect(day(recs, '2026-11-20').distanceKm).toBeCloseTo(10, 6)
    expect(day(recs, '2026-11-21').distanceKm).toBeCloseTo(10, 6)
    expect(day(recs, '2026-11-20').trips).toBe(1)
    expect(day(recs, '2026-11-21').trips).toBe(0)
    expect(day(recs, '2026-11-20').drivingSec).toBe(600)
    expect(day(recs, '2026-11-21').drivingSec).toBe(600)
  })

  it('a day with no sample says No data', () => {
    const recs = uffizioDayRecords(drive(D0 + 8 * H, 10), D0, D0 + 2 * 86400)
    expect(day(recs, '2026-11-21').noData).toBe(true)
    expect(day(recs, '2026-11-21').distanceSource).toBeNull()
    expect(uffizioDayRecords([], D0, D0 + 86400)[0].noData).toBe(true)
  })

  it('fuel start, end and used (a fill counts back in)', () => {
    const fuel = [
      { ts: D0 + 7 * H, litres: 200 }, { ts: D0 + 10 * H, litres: 170 },
      { ts: D0 + 11 * H, litres: 260 },                                       // +90 L fill
      { ts: D0 + 18 * H, litres: 240 },
    ]
    const [r] = uffizioDayRecords(drive(D0 + 8 * H, 10), D0, D0 + 86400, { fuel })
    expect(r.fuelStartL).toBe(200)
    expect(r.fuelEndL).toBe(240)
    expect(r.fuelUsedL).toBe(50)
  })

  it('UAE day boundaries: 23:59:59 and 00:00:00 UAE are different days', () => {
    expect(uaeDate(D0 - 1)).toBe('2026-11-19')
    expect(uaeDate(D0)).toBe('2026-11-20')
    expect(uaeMidnight(D0 + 5 * H)).toBe(D0)
  })
})

describe('deriveUffizioMonth', () => {
  it('matches deriveDeviceMonth and adds the estimated share and sample counts', () => {
    const a = drive(D0 + 8 * H, 20, { odo0: 50_000 })
    const last = a[a.length - 1]
    const b = drive(last.timestamp + 120, 20, { odo0: 0, lat0: last['position.latitude'] + 2 / KM_PER_DEG })
    const msgs = [...a, ...b]
    const m = deriveUffizioMonth(msgs, 2026, 11)
    const base = deriveDeviceMonth(msgs, 2026, 11)
    expect(m.distanceKm).toEqual(base.distanceKm)
    expect(m.totalKm).toBeCloseTo(42, 2)
    expect(m.estimatedKm[20]).toBeCloseTo(2, 2)
    expect(m.totalEstimatedKm).toBeCloseTo(2, 2)
    expect(m.samplesPerDay[20]).toBe(msgs.length)
    expect(m.noData).toBe(false)
    expect(m.source).toBe('UFFIZIO')
  })

  it('no sample in the month: noData', () => {
    expect(deriveUffizioMonth([], 2026, 11).noData).toBe(true)
  })
})

describe('trips from Uffizio samples (the unchanged trip engine)', () => {
  it('one ignition-on run is one trip, its distance the odometer, no harsh events from 2-minute samples', () => {
    const msgs = [...drive(D0 + 8 * H, 30, { odo0: 100 }), s(D0 + 8 * H + 32 * 60, { odo: 130, lat: LAT + 30 / KM_PER_DEG })]
    const trips = deriveTrips(msgs)
    expect(trips).toHaveLength(1)
    expect(trips[0].distanceKm).toBeCloseTo(30, 6)
    expect(trips[0].hbCount + trips[0].haCount + trips[0].hcCount).toBe(0)
    expect(trips[0].startOdo).toBe(100)
    expect(trips[0].endOdo).toBe(130)
  })
})

describe('helpers', () => {
  it('estimatedUffizioIds names only Uffizio vehicles with a GPS share', () => {
    const noOdo = drive(D0 + 8 * H, 10, { withOdo: false, id: 'uffizio:veh-test-2' })
    const odo = drive(D0 + 8 * H, 10)
    const by = new Map([[ID, { messages: odo }], ['uffizio:veh-test-2', { messages: noOdo }], [4711, { messages: [] }]])
    expect([...estimatedUffizioIds(by)]).toEqual(['uffizio:veh-test-2'])
  })

  it('compareIds sorts Flespi numbers first, then Uffizio ids', () => {
    expect([ 'uffizio:b', 12, 'uffizio:a', 3 ].sort(compareIds)).toEqual([3, 12, 'uffizio:a', 'uffizio:b'])
  })

  it('hasUffizio on arrays and maps', () => {
    expect(hasUffizio([1, 2])).toBe(false)
    expect(hasUffizio([1, ID])).toBe(true)
    expect(hasUffizio(new Map([[ID, {}]]))).toBe(true)
  })

  it('sourceOf', () => {
    expect(sourceOf(10, 0)).toBe('odometer')
    expect(sourceOf(10, 10)).toBe('estimated')
    expect(sourceOf(10, 2)).toBe('mixed')
  })
})
