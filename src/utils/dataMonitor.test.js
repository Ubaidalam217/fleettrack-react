import { describe, expect, it } from 'vitest'
import {
  fmtBytes, fmtInterval, fmtCount, fmtPct, fmtAgo, statusOf, meter, sparkPoints, deviceTitle, changedSettings,
} from './dataMonitor'

describe('data monitor formatting', () => {
  it('sizes in binary units', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(fmtBytes('nope')).toBe('0 B')
  })

  it('intervals from fractions of a second to hours', () => {
    expect(fmtInterval(null)).toBe('—')
    expect(fmtInterval(0.84)).toBe('0.8 s')
    expect(fmtInterval(30)).toBe('30 s')
    expect(fmtInterval(300)).toBe('5 min')
    expect(fmtInterval(4200)).toBe('1 h 10 min')
  })

  it('counts, percentages and ages', () => {
    expect(fmtCount(12345.4)).toBe('12,345')
    expect(fmtPct(3.24)).toBe('3.2%')
    expect(fmtPct(45.6)).toBe('46%')
    const now = Date.parse('2026-11-16T12:00:00Z')
    expect(fmtAgo('2026-11-16T11:59:30Z', now)).toBe('Just now')
    expect(fmtAgo('2026-11-16T11:48:00Z', now)).toBe('12 min ago')
    expect(fmtAgo('2026-11-16T09:00:00Z', now)).toBe('3 h ago')
    expect(fmtAgo(null, now)).toBe('—')
  })

  it('status chips and meters', () => {
    expect(statusOf('overload')).toMatchObject({ label: 'Overload', tone: 'critical' })
    expect(statusOf('whatever').label).toBe('Normal')
    expect(meter(50, 80, 95)).toEqual({ fill: 50, tone: 'good' })
    expect(meter(80, 80, 95).tone).toBe('warning')
    expect(meter(130, 80, 95)).toEqual({ fill: 100, tone: 'critical' })
  })

  it('sparkline points span the width and keep the line inside', () => {
    expect(sparkPoints([], 100, 20)).toBe('')
    expect(sparkPoints([0, 0, 0], 100, 20)).toBe('0,18 50,18 100,18')
    expect(sparkPoints([0, 5, 10], 100, 20)).toBe('0,18 50,10 100,2')
  })

  it('names a device by its vehicle', () => {
    expect(deviceTitle({ deviceId: 5, vehicle: { plateNo: 'AD 123' } })).toBe('AD 123')
    expect(deviceTitle({ deviceId: 5, vehicle: { plateNo: 'AD 123', fleetNo: 'FL-9' } })).toBe('FL-9 - AD 123')
    expect(deviceTitle({ deviceId: 5, vehicle: null })).toBe('Device 5')
  })

  it('sends only the settings that changed, as numbers', () => {
    const saved = { rateFloorPerHour: 600, protectFlespi: true, rateMultiplier: 5 }
    expect(changedSettings(saved, { rateFloorPerHour: '600', protectFlespi: true, rateMultiplier: '6', junk: 1 })).toEqual({ rateMultiplier: 6 })
    expect(changedSettings(saved, { protectFlespi: false })).toEqual({ protectFlespi: false })
  })
})
