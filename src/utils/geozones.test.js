import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GEO_OPTIONS, normalizeGeoOptions, matchesGeoType, geoTypeCounts, ruleGeofenceIds,
  shownGeozones, geozoneBounds, geozoneCaption,
} from './geozones'

const square = (id, extra = {}) => ({
  id, companyId: 'bg1', kind: 'GEOFENCE', shape: 'POLYGON', name: id, speedLimitKmh: '',
  points: [{ lat: 24, lng: 54 }, { lat: 24, lng: 54.1 }, { lat: 24.1, lng: 54.1 }, { lat: 24.1, lng: 54 }],
  ...extra,
})
const GEOS = [
  square('g1'),
  square('g2', { speedLimitKmh: '60' }),
  { id: 'a1', companyId: 'bg1', kind: 'ADDRESS', shape: 'CIRCLE', name: 'Depot', centerLat: 25, centerLng: 55, radius: 1113.2, speedLimitKmh: '' },
  square('x1', { companyId: 'bg2' }),
]

describe('normalizeGeoOptions', () => {
  it('fills defaults and drops junk', () => {
    expect(normalizeGeoOptions(null)).toEqual(DEFAULT_GEO_OPTIONS)
    expect(normalizeGeoOptions({ show: 'x', ids: ['a', 'a', 3, ''], type: 'y', labels: 'on' })).toEqual({ ...DEFAULT_GEO_OPTIONS, ids: ['a'] })
    expect(normalizeGeoOptions({ show: 'custom', ids: ['g1'], type: 'speed', labels: true })).toEqual({ show: 'custom', ids: ['g1'], type: 'speed', labels: true })
  })
})

describe('types', () => {
  it('tells zones, addresses and speed zones apart', () => {
    expect(matchesGeoType(GEOS[0], 'zone')).toBe(true)
    expect(matchesGeoType(GEOS[2], 'zone')).toBe(false)
    expect(matchesGeoType(GEOS[2], 'address')).toBe(true)
    expect(matchesGeoType(GEOS[1], 'speed')).toBe(true)
    expect(matchesGeoType(GEOS[0], 'speed')).toBe(false)
    expect(geoTypeCounts(GEOS)).toEqual({ all: 4, zone: 3, address: 1, speed: 1 })
  })
})

describe('ruleGeofenceIds', () => {
  const vehicle = { settingsId: 'v1', bgId: 'bg1' }
  it('is null with no vehicle selected', () => {
    expect(ruleGeofenceIds([], GEOS, null)).toBeNull()
  })

  it('collects the geofences of the active rules that apply to the vehicle', () => {
    const alerts = [
      { type: 'geofence', status: 'Active', allVehicles: false, vehicleIds: ['v1'], companyId: 'bg1', settings: { geofenceIds: ['g1'] } },
      { type: 'geofence_speed', status: 'Active', allVehicles: true, vehicleIds: [], companyId: 'bg1', settings: { geofenceIds: ['g2'] } },
      { type: 'geofence', status: 'Inactive', allVehicles: true, companyId: 'bg1', settings: { geofenceIds: ['a1'] } },
      { type: 'overspeed', status: 'Active', allVehicles: true, companyId: 'bg1', settings: {} },
      { type: 'geofence', status: 'Active', allVehicles: false, vehicleIds: ['v9'], companyId: 'bg1', settings: { geofenceIds: ['a1'] } },
      { type: 'geofence', status: 'Active', allVehicles: true, companyId: 'bg2', settings: { geofenceIds: ['x1'] } },
    ]
    expect([...ruleGeofenceIds(alerts, GEOS, vehicle)].sort()).toEqual(['g1', 'g2'])
  })

  it('reads "All geofences" as every geofence of the rule\'s group', () => {
    const alerts = [{ type: 'geofence', status: 'Active', allVehicles: false, vehicleIds: ['v1'], companyId: 'bg1', settings: { allGeofences: true, geofenceIds: [] } }]
    expect([...ruleGeofenceIds(alerts, GEOS, vehicle)].sort()).toEqual(['a1', 'g1', 'g2'])
  })
})

describe('shownGeozones', () => {
  it('shows all, a custom pick, or the rule set, then filters by type', () => {
    expect(shownGeozones(GEOS, { show: 'all' }).map(g => g.id)).toEqual(['g1', 'g2', 'a1', 'x1'])
    expect(shownGeozones(GEOS, { show: 'custom', ids: ['a1', 'g2'] }).map(g => g.id)).toEqual(['g2', 'a1'])
    expect(shownGeozones(GEOS, { show: 'custom', ids: ['a1', 'g2'], type: 'zone' }).map(g => g.id)).toEqual(['g2'])
    expect(shownGeozones(GEOS, { show: 'rules' }, { ruleIds: new Set(['g1']) }).map(g => g.id)).toEqual(['g1'])
    expect(shownGeozones(GEOS, { show: 'rules' }, { ruleIds: null })).toEqual([])
    expect(shownGeozones(GEOS, { type: 'speed' }).map(g => g.id)).toEqual(['g2'])
  })
})

describe('bounds and caption', () => {
  it('frames polygons and circles', () => {
    const b = geozoneBounds([GEOS[0], GEOS[2]])
    expect(b[0][0]).toBeCloseTo(24)
    expect(b[0][1]).toBeCloseTo(54)
    expect(b[1][0]).toBeCloseTo(25.01)
    expect(b[1][1]).toBeGreaterThan(55.01)
    expect(geozoneBounds([])).toBeNull()
  })

  it('counts what is shown', () => {
    expect(geozoneCaption(12, 12)).toBe('12 geofences shown')
    expect(geozoneCaption(1, 30)).toBe('1 geofence shown of 30')
  })
})
