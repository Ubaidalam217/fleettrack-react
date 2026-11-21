import { describe, expect, it } from 'vitest'
import { occurrences, upcoming, startOn, runsOn, scheduleErrors, describeSchedule, uaeDateKey } from './journeyRecurrence'
import { cleanFormFields, checkAnswers, answerText } from './journeyForms'
import { parseCsv, readStopRows, sampleCsv, mapHeader } from './journeyStopsImport'

describe('recurring schedules', () => {
  it('daily, weekly on days, monthly on dates, inside Valid From / To', () => {
    const base = { validFrom: '2026-11-01T00:00:00+04:00', validTo: '2026-11-30T00:00:00+04:00' }
    expect(occurrences({ ...base, repeat: 'DAILY' }, '2026-11-28', '2026-12-03')).toEqual(['2026-11-28', '2026-11-29', '2026-11-30'])
    // 2026-11-22 is a Sunday.
    expect(occurrences({ ...base, repeat: 'WEEKLY', weekdays: [0, 3] }, '2026-11-22', '2026-11-29')).toEqual(['2026-11-22', '2026-11-25', '2026-11-29'])
    expect(occurrences({ repeat: 'MONTHLY', monthDays: [1, 31] }, '2026-11-01', '2027-01-31')).toEqual(['2026-11-01', '2026-12-01', '2026-12-31', '2027-01-01', '2027-01-31'])
    expect(runsOn({ repeat: 'DAILY', validFrom: '2026-11-10T00:00:00+04:00' }, '2026-11-09')).toBe(false)
  })

  it('starts at the UAE time, and leaves out a day already past its start', () => {
    expect(startOn('2026-11-22', '06:00').toISOString()).toBe('2026-11-22T02:00:00.000Z')
    expect(startOn('2026-11-22', '6am')).toBe(null)
    const now = Date.parse('2026-11-22T03:00:00Z') // 07:00 UAE: today's 06:00 is gone
    const next = upcoming({ repeat: 'DAILY', startTime: '06:00', horizonDays: 2 }, now)
    expect(next.map(o => o.key)).toEqual(['2026-11-23', '2026-11-24'])
    expect(uaeDateKey('2026-11-21T21:00:00Z')).toBe('2026-11-22')
  })

  it('says what is missing and reads back in words', () => {
    expect(Object.keys(scheduleErrors({ scheduleKind: 'RELATIVE', repeat: 'WEEKLY', weekdays: [] }))).toEqual(['weekdays', 'startTime', 'validFrom'])
    expect(scheduleErrors({ scheduleKind: 'NONE' })).toEqual({})
    expect(describeSchedule({ scheduleKind: 'RELATIVE', repeat: 'WEEKLY', weekdays: [4, 0], startTime: '06:00' })).toBe('Sun, Thu at 06:00')
    expect(describeSchedule({ scheduleKind: 'RELATIVE', repeat: 'MONTHLY', monthDays: [2, 1], startTime: '05:30' })).toBe('On the 1st, 2nd at 05:30')
  })
})

describe('stop forms', () => {
  it('cleans the fields: unique keys, dropdown choices', () => {
    const { fields, errors } = cleanFormFields([{ label: 'Seal no.' }, { label: 'Seal no.', type: 'NUMBER' }, { label: 'State', type: 'DROPDOWN', options: 'Good, Damaged' }])
    expect(errors).toEqual({})
    expect(fields.map(f => f.key)).toEqual(['seal_no', 'seal_no_2', 'state'])
    expect(fields[2].options).toEqual(['Good', 'Damaged'])
    expect(cleanFormFields([]).errors.fields).toBeTruthy()
  })

  it('checks the answers by type', () => {
    const fields = [
      { key: 'n', type: 'NUMBER', required: true }, { key: 'ok', type: 'YESNO' }, { key: 's', type: 'DROPDOWN', options: ['A', 'B'] },
      { key: 'p', type: 'PHOTO', required: true },
    ]
    const r = checkAnswers(fields, { n: '12', ok: 'no', s: 'C' })
    expect(r.answers).toEqual({ n: 12, ok: false })
    expect(Object.keys(r.errors)).toEqual(['s', 'p'])
    expect(answerText({ type: 'YESNO' }, false)).toBe('No')
  })
})

describe('bulk upload of stops', () => {
  it('reads the sample back without errors', () => {
    const { stops, errors } = readStopRows(parseCsv(sampleCsv()))
    expect(errors).toEqual([])
    expect(stops).toHaveLength(2)
    expect(stops[0]).toMatchObject({ name: 'ADNOC Ruwais Gate 2', lat: 24.1105, purpose: 'DELIVERY', signatureRequired: true, stayMin: 30, windowFrom: '08:00' })
    expect(stops[1]).toMatchObject({ name: 'Mussafah Yard', purpose: 'LOADING', saveAddress: true })
  })

  it('parses quotes, semicolons and the header in any order', () => {
    const rows = parseCsv('Longitude;Name;Latitude\n54.5;"Yard, gate ""B""";24.3\n')
    expect(rows[1]).toEqual(['54.5', 'Yard, gate "B"', '24.3'])
    expect(mapHeader(rows[0])).toEqual({ lng: 0, name: 1, lat: 2 })
  })

  it('reports each bad row with its sheet row number, and finds names in the address book', () => {
    const csv = 'Name,Latitude,Longitude,Radius (m),State,Visited via\n'
      + 'Good,24.3,54.5,300,Rest,QR\n'
      + ',24.3,54.5,,,\n'
      + 'Far,95,54.5,,,\n'
      + 'Tiny,24.3,54.5,5,,\n'
      + 'Odd,24.3,54.5,,Party,Bus\n'
      + 'Ruwais Gate,,,,,\n'
      + 'Nowhere,,,,,\n'
    const book = { 'ruwais gate': { id: 'a1', lat: 24.11, lng: 52.73, radiusM: 400, purpose: 'DELIVERY' } }
    const { stops, errors } = readStopRows(parseCsv(csv), { addressByName: n => book[n.toLowerCase()] ?? null })
    expect(stops.map(s => s.name)).toEqual(['Good', 'Ruwais Gate'])
    expect(stops[0]).toMatchObject({ purpose: 'REST', visitVia: 'QR' })
    expect(stops[1]).toMatchObject({ addressId: 'a1', radiusM: 400, purpose: 'DELIVERY', saveAddress: false })
    expect(errors.map(e => e.row)).toEqual([3, 4, 5, 6, 8])
    expect(errors[3].message).toMatch(/state must be/)
    expect(errors[4].message).toMatch(/no address-book entry/)
  })

  it('needs a Name column', () => {
    expect(readStopRows([['Lat', 'Lng'], ['1', '2']]).errors[0].message).toMatch(/Name/)
  })
})
