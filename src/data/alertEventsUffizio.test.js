import { afterEach, describe, expect, it, vi } from 'vitest'
import { IS_REAL } from './mode'
import { fetchAlertEventsInRange } from './alertEvents'

// An Uffizio vehicle's events carry its vehicle id, no device id: the range
// query asks for them by vehicle and hands them back under "uffizio:<id>".
// Invented ids only.
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe.runIf(IS_REAL)('fetchAlertEventsInRange with Uffizio vehicles', () => {
  it('asks by vehicleIds and maps the events to the Uffizio id', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      urls.push(String(url))
      return json({ data: [
        { id: 'e1', type: 'fuel_theft', vehicleId: 'veh-x1', deviceId: null, occurredAt: '2026-11-20T08:00:00.000Z' },
        { id: 'e2', type: 'overspeed', vehicleId: 'veh-f', deviceId: 101, occurredAt: '2026-11-20T08:05:00.000Z' },
        { id: 'e3', type: 'fuel_fill', vehicleId: 'veh-other', deviceId: null, occurredAt: '2026-11-20T08:06:00.000Z' },
      ] })
    }))
    const from = Date.parse('2026-11-20T00:00:00Z') / 1000
    const { events } = await fetchAlertEventsInRange({ fromTs: from, toTs: from + 86400, deviceIds: [101, 'uffizio:veh-x1'] })
    expect(urls[0]).toContain('deviceIds=101')
    expect(urls[0]).toContain('vehicleIds=veh-x1')
    expect(events.map(e => [e.id, e.deviceId])).toEqual([['e1', 'uffizio:veh-x1'], ['e2', 101]])
  })

  it('only Uffizio vehicles: no deviceIds parameter', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async url => { urls.push(String(url)); return json({ data: [] }) }))
    await fetchAlertEventsInRange({ fromTs: 0, toTs: 10, deviceIds: ['uffizio:veh-x1'] })
    expect(urls[0]).not.toContain('deviceIds=')
    expect(urls[0]).toContain('vehicleIds=veh-x1')
  })
})
