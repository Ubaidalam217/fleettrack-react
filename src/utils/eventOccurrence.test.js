import { describe, it, expect } from 'vitest'
import { buildEventReport, trackAt } from './eventOccurrence'
import { locationUrl } from './mapLink'

const t0 = Date.UTC(2026, 9, 18, 6, 0, 0) / 1000

// Parked, switched on, 30 min of driving at 40 km/h with a fix every minute, off.
function trip() {
  const msgs = []
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
  at(32, { ign: false, speed: 0, lat: 24.55 })
  return new Map([[7, { messages: msgs, truncated: false }]])
}

const event = (over = {}) => ({
  id: 'e1', deviceId: 7, type: 'ignition_on', severity: 'Medium', title: 'Ignition On',
  message: 'Ignition switched on', value: null, lat: null, lng: null,
  occurredAt: new Date((t0 + 60) * 1000).toISOString(), ...over,
})

const vehicles = [{ id: 7, name: 'Truck 7', master: { plateNo: 'DXB 1234' } }]

describe('trackAt', () => {
  const rows = [{ ts: 100 }, { ts: 200 }, { ts: 300 }]
  it('takes the last row at or before the moment', () => {
    expect(trackAt(rows, 250).ts).toBe(200)
    expect(trackAt(rows, 300).ts).toBe(300)
  })
  it('falls forward to the next row when nothing came before', () => {
    expect(trackAt(rows, 50).ts).toBe(100)
  })
  it('gives nothing when every row is outside the window', () => {
    expect(trackAt(rows, 300 + 16 * 60)).toBeNull()
    expect(trackAt([], 10)).toBeNull()
  })
})

describe('buildEventReport', () => {
  it('attaches the tracking at the moment of each alert', () => {
    const at10 = new Date((t0 + 10 * 60 + 20) * 1000).toISOString()
    const r = buildEventReport([event({ id: 'e2', occurredAt: at10, type: 'idle', message: 'Idling' })], trip(), { vehicles })
    expect(r.totalRows).toBe(1)
    const row = r.vehicles[0].dates[0].rows[0]
    expect(r.vehicles[0].vehicleId).toBe('DXB 1234')
    expect(row.status).toBe('Driving')
    expect(row.speed).toBe(40)
    expect(row.odoKm).toBeGreaterThan(4)
    expect(row.lat).toBeCloseTo(24.4 + 9 * 0.005, 5)
  })

  it('keeps an over-speed alert’s own reading and its own position', () => {
    const r = buildEventReport([event({ type: 'overspeed', value: 131.6, lat: 25.1, lng: 55.2 })], trip(), { vehicles })
    const row = r.vehicles[0].dates[0].rows[0]
    expect(row.speed).toBe(132)
    expect([row.lat, row.lng]).toEqual([25.1, 55.2])
  })

  it('filters by alert type and severity without refetching', () => {
    const evs = [event(), event({ id: 'e2', type: 'overspeed', severity: 'Critical', value: 120 })]
    expect(buildEventReport(evs, trip(), { vehicles, types: ['overspeed'] }).totalRows).toBe(1)
    expect(buildEventReport(evs, trip(), { vehicles, severities: ['Low'] }).totalRows).toBe(0)
    expect(buildEventReport(evs, trip(), { vehicles }).totalRows).toBe(2)
  })

  it('still lists an alert with no tracking nearby, and counts it', () => {
    const late = new Date((t0 + 5 * 3600) * 1000).toISOString()
    const r = buildEventReport([event({ occurredAt: late })], trip(), { vehicles })
    expect(r.totalRows).toBe(1)
    expect(r.untracked).toBe(1)
    expect(r.vehicles[0].dates[0].rows[0].status).toBe('—')
  })

  it('skips alerts that belong to no vehicle (licence expiry)', () => {
    expect(buildEventReport([event({ deviceId: null, type: 'license_expiry' })], trip(), { vehicles }).totalRows).toBe(0)
  })
})

describe('locationUrl', () => {
  it('links to our own /location page with the point', () => {
    const url = new URL(locationUrl({ lat: 25.2048493, lng: 55.2707828, vehicle: 'DXB 1', time: '11/2/2026 9:00:00 AM', address: 'Sheikh Zayed Rd' }))
    expect(url.pathname).toBe('/location')
    expect(url.searchParams.get('lat')).toBe('25.204849')
    expect(url.searchParams.get('v')).toBe('DXB 1')
    expect(url.searchParams.get('a')).toBe('Sheikh Zayed Rd')
  })
  it('gives no link without coordinates', () => {
    expect(locationUrl({ lat: null, lng: 1 })).toBeNull()
  })
})
