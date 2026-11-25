import { describe, expect, it } from 'vitest'
import {
  uffizioToLive, liveStatus, mergeLive, withoutUffizio, isUffizioId, isUffizioVehicle, uffizioVehicleId,
  markerType, fuelText, fuelLitresOf,
} from './uffizioLive'

// An invented GET /api/live/uffizio row.
const NOW = Date.UTC(2026, 10, 25, 10, 0, 0) / 1000
const row = (extra = {}) => ({
  id: 'uffizio:veh-1', vehicleId: 'veh-1', imei: '359990000000001', source: 'UFFIZIO',
  ts: NOW - 90, lat: 24.41, lng: 54.51, speed: 52, heading: 135, ign: true, status: 'RUNNING',
  odometerKm: 123456.7, driverName: 'Sample Driver', driverTag: '01AB23CD', externalVolt: 27.4, batteryPct: 96,
  temperature: 31.5, sos: false, power: true, satellites: 11, location: 'Invented Road, Test City', vehicleType: 'Truck',
  updatedAt: '2026-11-25T09:59:00.000Z', raw: { Vehicle_Name: 'ZZ 1 T1' },
  fuel: { port: 'BLE Fuel Level #1', raw: 3100, ts: NOW - 90, litres: 212.4, flag: null, calibrated: true, tankCapacityL: 400 },
  ...extra,
})
const BASE = { plateNo: '', fleetNo: '', vehicleType: '', driver: { name: '', mobile: '' }, sensors: {} }

describe('uffizioToLive', () => {
  it('maps a row to the live-store shape the Live Map reads', () => {
    const v = uffizioToLive(row(), BASE, NOW)
    expect(v).toMatchObject({
      id: 'uffizio:veh-1', source: 'UFFIZIO', ident: '359990000000001', status: 'Running',
      lat: 24.41, lng: 54.51, speed: 52, heading: 135, ignition: true, lastTs: NOW - 90,
      fuelLevel: 212.4, temperature: 31.5, ibutton: '01AB23CD',
      master: { vehicleType: 'truck', driver: { name: 'Sample Driver' } },
      uffizio: { status: 'RUNNING', odometerKm: 123456.7, externalVolt: 27.4, batteryPct: 96, sos: false, location: 'Invented Road, Test City' },
    })
    expect(isUffizioVehicle(v)).toBe(true)
  })

  it('no calibration: no litres, the raw value on the card', () => {
    const v = uffizioToLive(row({ fuel: { port: 'P', raw: 3796, calibrated: false, litres: null } }), BASE, NOW)
    expect(v.fuelLevel).toBeNull()
    expect(fuelText(v.uffizio.fuel)).toBe('Raw 3796 (not calibrated)')
    expect(fuelText(row().fuel)).toBe('212.4 L of 400 L')
    expect(fuelText({ raw: 30022, calibrated: true, litres: null, flag: 'out_of_range' })).toBe('Out of range (raw 30022)')
    expect(fuelText(null)).toBeNull()
    expect(fuelLitresOf({ calibrated: false, litres: 5 })).toBeNull()
  })

  it('missing values stay null, never 0', () => {
    const v = uffizioToLive(row({ lat: null, lng: null, speed: null, heading: null, ign: null, temperature: null, fuel: null, status: null }), BASE, NOW)
    expect(v).toMatchObject({ lat: null, lng: null, speed: null, heading: null, ignition: null, temperature: null, fuelLevel: null, status: 'NoData' })
  })
})

describe('liveStatus', () => {
  it('follows the Flespi store’s rule, with Uffizio’s own Status when the ignition is unknown', () => {
    expect(liveStatus({ lastTs: NOW - 60, ignition: true, speed: 30 }, NOW)).toBe('Running')
    expect(liveStatus({ lastTs: NOW - 60, ignition: true, speed: 0 }, NOW)).toBe('Idle')
    expect(liveStatus({ lastTs: NOW - 60, ignition: false, speed: 0 }, NOW)).toBe('Stopped')
    expect(liveStatus({ lastTs: NOW - 2 * 86400, ignition: true, speed: 30 }, NOW)).toBe('Inactive')
    expect(liveStatus({ lastTs: null }, NOW)).toBe('NoData')
    expect(liveStatus({ lastTs: NOW - 60, ignition: null, uffizioStatus: 'IDLING' }, NOW)).toBe('Idle')
    expect(liveStatus({ lastTs: NOW - 60, ignition: null, uffizioStatus: 'STOPPED' }, NOW)).toBe('Stopped')
  })
})

describe('ids, merge and exclusion', () => {
  it('an Uffizio id is never a Flespi device id', () => {
    expect(isUffizioId('uffizio:abc')).toBe(true)
    expect(isUffizioId(8414546)).toBe(false)
    expect(isUffizioId('8414546')).toBe(false)
    expect(uffizioVehicleId('uffizio:abc')).toBe('abc')
    expect(uffizioVehicleId(12)).toBeNull()
  })

  it('merges after the Flespi vehicles, never twice for one IMEI, and the reports can drop them', () => {
    const flespi = [{ id: 101, ident: '860000000000001' }, { id: 102, ident: '860000000000002' }]
    const u = [uffizioToLive(row(), BASE, NOW), uffizioToLive(row({ id: 'uffizio:dup', imei: '860000000000002' }), BASE, NOW)]
    const all = mergeLive(flespi, u)
    expect(all.map(v => v.id)).toEqual([101, 102, 'uffizio:veh-1'])
    expect(mergeLive(flespi, [])).toBe(flespi)
    expect(withoutUffizio(all).map(v => v.id)).toEqual([101, 102])
  })

  it('marker types', () => {
    expect(markerType('Truck')).toBe('truck')
    expect(markerType('Water Tanker')).toBe('truck')
    expect(markerType('Car')).toBe('car')
    expect(markerType('Generator')).toBe('')
  })
})
