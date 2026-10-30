import { describe, it, expect } from 'vitest'
import { licenceExpiryState, formatExpiryDate, isoDateFromToday, EXPIRY_WARN_DAYS } from './licenceExpiry'

// Late evening local time: a timestamp comparison would already be "tomorrow" in UTC
// for a UTC+ zone, which is exactly the slip the day-number comparison avoids.
const NOW = new Date(2026, 9, 30, 23, 30)

describe('licenceExpiryState', () => {
  it('reads a blank or malformed date as no expiry on file', () => {
    expect(licenceExpiryState('', NOW).state).toBe('none')
    expect(licenceExpiryState(null, NOW).state).toBe('none')
    expect(licenceExpiryState('31/03/2027', NOW).state).toBe('none')
  })

  it('is expired from the day after the expiry date', () => {
    expect(licenceExpiryState('2026-10-29', NOW)).toMatchObject({ state: 'expired', days: -1, label: 'Expired' })
  })

  it('counts the expiry day itself as still valid, with a warning', () => {
    expect(licenceExpiryState('2026-10-30', NOW)).toMatchObject({ state: 'expiring', days: 0, label: 'Expires today' })
    expect(licenceExpiryState('2026-10-31', NOW).label).toBe('Expires in 1 day')
  })

  it('warns inside the window and is valid beyond it', () => {
    expect(licenceExpiryState(isoDateFromToday(EXPIRY_WARN_DAYS, NOW), NOW)).toMatchObject({ state: 'expiring', days: EXPIRY_WARN_DAYS })
    expect(licenceExpiryState(isoDateFromToday(EXPIRY_WARN_DAYS + 1, NOW), NOW).state).toBe('valid')
  })
})

describe('formatExpiryDate', () => {
  it('prints day, short month and year', () => {
    expect(formatExpiryDate('2027-03-31')).toBe('31 Mar 2027')
    expect(formatExpiryDate('')).toBe('')
  })
})
