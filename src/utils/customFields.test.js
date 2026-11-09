import { describe, expect, it } from 'vitest'
import { validateCustomFields, cleanCustomFields, fieldNameSuggestions, valueParts } from './customFields'

describe('validateCustomFields', () => {
  it('passes blank rows, flags a nameless value and a repeated name', () => {
    const rows = [
      { name: 'Contact', value: 'A' },
      { name: ' ', value: ' ' },
      { name: '', value: 'orphan' },
      { name: 'contact ', value: 'B' },
    ]
    expect(validateCustomFields(rows)).toEqual({ '2.name': 'Give this field a name', '3.name': 'This name is already used above' })
    expect(cleanCustomFields(rows)).toEqual([{ name: 'Contact', value: 'A' }, { name: '', value: 'orphan' }, { name: 'contact', value: 'B' }])
  })
})

describe('fieldNameSuggestions', () => {
  it('counts names across vehicles, most used first, one spelling each', () => {
    const vehicles = [
      { customFields: [{ name: 'Contract End Date', value: '1' }, { name: 'Owner', value: 'x' }] },
      { customFields: [{ name: 'contract end date', value: '2' }] },
      {},
    ]
    expect(fieldNameSuggestions(vehicles)).toEqual([{ name: 'Contract End Date', count: 2 }, { name: 'Owner', count: 1 }])
  })
})

describe('valueParts', () => {
  it('links e-mails and web addresses inside text', () => {
    expect(valueParts('mfselmi@adnoc.ae & ops@example.com')).toEqual([
      { type: 'email', text: 'mfselmi@adnoc.ae', href: 'mailto:mfselmi@adnoc.ae' },
      { type: 'text', text: ' & ' },
      { type: 'email', text: 'ops@example.com', href: 'mailto:ops@example.com' },
    ])
    expect(valueParts('See https://example.com/a').map(p => p.type)).toEqual(['text', 'url'])
  })

  it('links a phone only in a phone field or with a leading +', () => {
    expect(valueParts('056 406 1875/056 991 9871', 'Focal Point Phone #').filter(p => p.type === 'phone').map(p => p.href))
      .toEqual(['tel:0564061875', 'tel:0569919871'])
    expect(valueParts('4500012345', 'Contract SAP Number')).toEqual([{ type: 'text', text: '4500012345' }])
    expect(valueParts('+971 50 123 4567')[0]).toMatchObject({ type: 'phone', href: 'tel:+971501234567' })
    expect(valueParts('09/07/2027', 'Contract End Date')).toEqual([{ type: 'text', text: '09/07/2027' }])
  })
})
