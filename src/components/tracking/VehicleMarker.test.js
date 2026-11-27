import { describe, expect, it } from 'vitest'
import { vehicleMarkerHtml } from './vehicleIcons'

// Client 2026-11-27: the vehicle shape and the ring round it both carry the status colour.
describe('vehicleMarkerHtml', () => {
  it('colours the ring and the photographed shape with the status colour', () => {
    const html = vehicleMarkerHtml('car', '#22c55e')
    expect(html).toContain('--veh-st:#22c55e')
    expect(html).toContain('veh-tint')
    expect(html).toContain('veh-fill')
  })
  it('keeps the photo as it is for the replay marker (tint off), ring only', () => {
    const html = vehicleMarkerHtml('car', '#ef4444', false)
    expect(html).toContain('--veh-st:#ef4444')
    expect(html).not.toContain('veh-fill')
  })
  it('a drawn silhouette (bike) is filled with the colour itself', () => {
    expect(vehicleMarkerHtml('bike', '#eab308')).toContain('#eab308')
  })
})
