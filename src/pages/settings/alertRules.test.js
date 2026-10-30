import { describe, it, expect } from 'vitest'
import { validateAlertSettings, parseEmails, isEmail } from './alertRules'
import { alert as A } from '../../data/adapters'
import { ALERT_TYPES, normalizeAlert, emptyAlert } from './mockData'
import { eventDetail, mapsLink, relativeTime } from '../../components/alerts/alertFormat'

describe('validateAlertSettings — mirrors the server', () => {
  it('accepts every type at its defaults (except temperature, which needs a bound)', () => {
    for (const t of ALERT_TYPES) {
      const errs = validateAlertSettings(t.value, t.defaults())
      if (t.value === 'temperature') expect(errs).toHaveProperty('minTemp')
      else expect(errs).toEqual({})
    }
  })

  it('checks the over-speed limit range', () => {
    expect(validateAlertSettings('overspeed', { speedKmh: '9' })).toHaveProperty('speedKmh')
    expect(validateAlertSettings('overspeed', { speedKmh: '301' })).toHaveProperty('speedKmh')
    expect(validateAlertSettings('overspeed', { speedKmh: '' })).toHaveProperty('speedKmh')
    expect(validateAlertSettings('overspeed', { speedKmh: '300' })).toEqual({})
  })

  it('checks minutes for idle and offline', () => {
    expect(validateAlertSettings('idle', { minutes: '0' })).toHaveProperty('minutes')
    expect(validateAlertSettings('offline', { minutes: '1441' })).toHaveProperty('minutes')
    expect(validateAlertSettings('offline', { minutes: 'x' }).minutes).toBe('Must be a number')
  })

  it('needs a geofence unless All is ticked', () => {
    expect(validateAlertSettings('geofence_exit', { allGeofences: true, geofenceIds: [] })).toEqual({})
    expect(validateAlertSettings('geofence_exit', { allGeofences: false, geofenceIds: [] })).toHaveProperty('geofenceIds')
    expect(validateAlertSettings('geofence_enter', { allGeofences: false, geofenceIds: ['g1'] })).toEqual({})
  })

  it('checks the night window and its speed', () => {
    expect(validateAlertSettings('night_driving', { from: '23:00', to: '23:00', minSpeedKmh: '10' })).toHaveProperty('to')
    expect(validateAlertSettings('night_driving', { from: '', to: '05:00', minSpeedKmh: '10' })).toHaveProperty('from')
    expect(validateAlertSettings('night_driving', { from: '22:00', to: '05:00', minSpeedKmh: '0' })).toHaveProperty('minSpeedKmh')
  })

  it('checks licence warning days', () => {
    expect(validateAlertSettings('license_expiry', { days: '366' })).toHaveProperty('days')
    expect(validateAlertSettings('license_expiry', { days: '7' })).toEqual({})
  })

  it('keeps the temperature rules', () => {
    expect(validateAlertSettings('temperature', { minTemp: '0', maxTemp: '' })).toEqual({})
    expect(validateAlertSettings('temperature', { minTemp: '5', maxTemp: '1' })).toHaveProperty('maxTemp')
  })
})

describe('email recipients', () => {
  it('splits on commas, semicolons and spaces and lower-cases', () => {
    expect(parseEmails('A@x.com, b@y.ae;c@z.org  nope')).toEqual({
      valid: ['a@x.com', 'b@y.ae', 'c@z.org'],
      invalid: ['nope'],
    })
    expect(isEmail('ops@company')).toBe(false)
  })
})

describe('alert adapter', () => {
  it('round-trips an over-speed rule through params', () => {
    const row = { ...emptyAlert(), name: 'Fast', companyId: 'bg1', type: 'overspeed', settings: { speedKmh: '110' }, severity: 'High', emails: ['a@x.com'] }
    const body = A.toApiCreate(row)
    expect(body).toMatchObject({ bgId: 'bg1', type: 'overspeed', severity: 'High', params: { speedKmh: 110 }, minTemp: null, maxTemp: null, emails: ['a@x.com'] })
    const back = A.toFe({ id: 'a', ...body, vehicleIds: [] })
    expect(back.settings.speedKmh).toBe('110')
    expect(back.severity).toBe('High')
  })

  it('sends [] for All geofences and the ids otherwise', () => {
    const base = { ...emptyAlert(), type: 'geofence_enter' }
    expect(A.fields({ ...base, settings: { allGeofences: true, geofenceIds: ['g1'] } }).params).toEqual({ geofenceIds: [] })
    expect(A.fields({ ...base, settings: { allGeofences: false, geofenceIds: ['g1'] } }).params).toEqual({ geofenceIds: ['g1'] })
    expect(A.toFe({ type: 'geofence_enter', params: { geofenceIds: [] } }).settings.allGeofences).toBe(true)
  })

  it('keeps temperature on its own columns', () => {
    const f = A.fields({ ...emptyAlert(), type: 'temperature', settings: { minTemp: '-18', maxTemp: '' } })
    expect(f).toMatchObject({ minTemp: '-18', maxTemp: null, params: {} })
  })

  it('sends licence expiry as all vehicles', () => {
    const f = A.fields({ ...emptyAlert(), type: 'license_expiry', allVehicles: false, vehicleIds: ['v1'], settings: { days: '30' } })
    expect(f).toMatchObject({ allVehicles: true, vehicleIds: [], params: { days: 30 } })
  })

  it('widens an old stored row', () => {
    const d = normalizeAlert({ id: 'a1', name: 'x', type: 'temperature', companyId: 'c1', allVehicles: true, vehicleIds: [], settings: { minTemp: '1', maxTemp: '' }, notify: { inApp: true } })
    expect(d.severity).toBe('Medium')
    expect(d.emails).toEqual([])
    expect(d.notify).toEqual({ inApp: true, email: false, sms: false })
  })
})

describe('alert event text', () => {
  it('drops the vehicle and driver the server folds into the message', () => {
    const e = { message: 'AD 1: Over speed: 130 km/h (limit 120 km/h) · Driver: Ali', vehicle: { plateNo: 'AD 1' }, driver: { name: 'Ali' } }
    expect(eventDetail(e)).toBe('Over speed: 130 km/h (limit 120 km/h)')
    const lic = { message: 'Ali (AD 1): Driving licence expires in 5 days', vehicle: { plateNo: 'AD 1' }, driver: { name: 'Ali' } }
    expect(eventDetail(lic)).toBe('Driving licence expires in 5 days')
  })

  it('links to the map only with a real position', () => {
    expect(mapsLink({ lat: null, lng: null })).toBeNull()
    expect(mapsLink({ lat: 25.2, lng: 55.3 })).toContain('25.2,55.3')
  })

  it('formats relative time', () => {
    const now = Date.parse('2026-10-30T12:00:00Z')
    expect(relativeTime('2026-10-30T11:55:00Z', now)).toBe('5 min ago')
    expect(relativeTime('2026-10-29T12:00:00Z', now)).toBe('1 day ago')
  })
})
