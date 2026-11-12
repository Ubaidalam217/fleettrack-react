import { describe, expect, it } from 'vitest'
import { withReport } from './useReportTitle'

describe('withReport', () => {
  it('adds "Report" only when the title does not already end in it', () => {
    expect(withReport('Trip Details')).toBe('Trip Details Report')
    expect(withReport('Event Occurrence Report')).toBe('Event Occurrence Report')
    expect(withReport('Oil & Gas reports')).toBe('Oil & Gas reports')
    expect(withReport('Daywise Work Hour')).toBe('Daywise Work Hour Report')
  })
})
