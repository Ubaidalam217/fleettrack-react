import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDeviceMessages, fetchFleetMessages } from './replay'

// The message readers send an Uffizio vehicle to our own copy, never to Flespi.
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const msg = (id, ts) => ({ 'device.id': id, timestamp: ts, 'position.latitude': 24.4, 'position.longitude': 54.5 })

afterEach(() => vi.unstubAllGlobals())

describe('Uffizio vehicles in the message readers', () => {
  it('one vehicle: GET /api/live/uffizio/:id/messages, no Flespi call', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async url => { calls.push(String(url)); return json({ result: [msg('uffizio:v1', 1000), msg('uffizio:v1', 1120)], truncated: false }) }))
    const r = await fetchDeviceMessages('uffizio:v1', 900, 2000)
    expect(r.messages.map(m => m.timestamp)).toEqual([1000, 1120])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/\/api\/live\/uffizio\/v1\/messages\?from=900&to=2000$/)
    expect(calls[0]).not.toMatch(/gw\/devices/)
  })

  it('a fleet read splits Flespi devices from Uffizio vehicles', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      const u = String(url)
      calls.push(u)
      if (u.includes('/api/live/uffizio/')) return json({ result: [msg('uffizio:v2', 1500)] })
      return json({ result: [msg(101, 1400), msg(102, 1450)] })
    }))
    const by = await fetchFleetMessages([101, 'uffizio:v2', 102], 1000, 2000)
    expect(by.get(101).messages).toHaveLength(1)
    expect(by.get(102).messages).toHaveLength(1)
    expect(by.get('uffizio:v2').messages.map(m => m.timestamp)).toEqual([1500])
    const flespi = calls.filter(u => u.includes('/gw/devices/'))
    expect(flespi).toHaveLength(1)
    expect(flespi[0]).toContain('/gw/devices/101,102/messages')
    expect(flespi[0]).not.toContain('uffizio')
  })
})
