import { describe, it, expect } from 'vitest'
import { vehiclesDrivenBy } from './vehiclesDrivenToday.js'

const trip = (startTs, endTs, km, ibutton = null) => ({ startTs, endTs, distanceKm: km, ibutton })
const veh = (deviceId, name, trips) => ({ deviceId, vehicle: { id: deviceId, ident: `imei-${deviceId}` }, vehicleId: name, trips })

describe('vehiclesDrivenBy', () => {
  const fleet = [
    veh(1, 'PLATE-1', [trip(100, 200, 5, 'AB12'), trip(300, 400, 3)]),
    veh(2, 'PLATE-2', [trip(50, 90, 2, '00AB12'), trip(500, 600, 4, 'CD34')]),
    veh(3, 'PLATE-3', [trip(10, 20, 1)]),
  ]

  it('counts trips with the driver’s tag on any vehicle, and untagged trips only on assigned vehicles', () => {
    const rows = vehiclesDrivenBy(fleet, { code: 'ab:12', isAssigned: v => v.id === 1 })
    expect(rows.map(r => r.name)).toEqual(['PLATE-1'])
    expect(rows[0]).toMatchObject({ firstTs: 100, lastTs: 400, trips: 2, km: 8 })
  })

  it('never gives the assigned driver a trip someone else’s tag was read in', () => {
    const rows = vehiclesDrivenBy(fleet, { code: '', isAssigned: v => v.id === 2 })
    expect(rows).toEqual([])
  })

  it('orders vehicles by their first trip and skips trips that never moved', () => {
    const rows = vehiclesDrivenBy(
      [...fleet, veh(4, 'PLATE-4', [trip(5, 8, 0.01, 'AB12')])],
      { code: 'AB12', isAssigned: v => v.id === 3 },
    )
    expect(rows.map(r => r.name)).toEqual(['PLATE-3', 'PLATE-1'])
  })

  it('a driver without a tag and without a vehicle drove nothing', () => {
    expect(vehiclesDrivenBy(fleet, { code: null, isAssigned: () => false })).toEqual([])
  })
})
