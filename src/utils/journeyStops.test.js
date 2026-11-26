import { describe, expect, it } from 'vitest'
import { appendStops } from './journeyStops'

const A = { name: 'Start', lat: 1, lng: 1, stayMin: 0 }
const B = { name: 'Destination', lat: 2, lng: 2, stayMin: 0, signatureRequired: true, purpose: 'DELIVERY' }

describe('appendStops', () => {
  it('a new point is added at the end and becomes the destination', () => {
    const out = appendStops([A, B], [{ lat: 3, lng: 3 }])
    expect(out.map(s => s.name)).toEqual(['Start', 'Stop 1', 'Destination'])
    expect(out[2]).toMatchObject({ lat: 3, lng: 3 })
  })

  it('the old destination becomes an ordinary stop that stays a while; the delivery details move to the new last point', () => {
    const out = appendStops([A, B], [{ lat: 3, lng: 3 }])
    expect(out[1]).toMatchObject({ lat: 2, lng: 2, stayMin: 15, signatureRequired: false, purpose: null })
    expect(out[2]).toMatchObject({ signatureRequired: true, purpose: 'DELIVERY', stayMin: 0 })
  })

  it('point 3, then point 4: stops 1 and 2 stay in the order they were added', () => {
    let out = appendStops([A, B], [{ lat: 3, lng: 3 }])
    out = appendStops(out, [{ lat: 4, lng: 4 }])
    expect(out.map(s => [s.name, s.lat])).toEqual([['Start', 1], ['Stop 1', 2], ['Stop 2', 3], ['Destination', 4]])
  })

  it('keeps a destination the user named, and several added stops keep their order', () => {
    const named = { ...B, name: 'Ruwais Gate 2' }
    const out = appendStops([A, named], [{ name: 'Yard', lat: 3, lng: 3 }, { name: 'Port', lat: 4, lng: 4 }])
    expect(out.map(s => s.name)).toEqual(['Start', 'Ruwais Gate 2', 'Yard', 'Port'])
  })

  it('adding nothing changes nothing', () => {
    expect(appendStops([A, B], [])).toEqual([A, B])
  })
})
