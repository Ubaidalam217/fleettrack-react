import { describe, it, expect } from 'vitest'
import { levelIn, screenForPath, atLeast, ALL_SCREENS, openCount } from './screens'

describe('screen permissions (frontend)', () => {
  it('reads an unset map or screen as unrestricted', () => {
    expect(levelIn(null, '/tracking')).toBe('addDelete')
    expect(levelIn({ '/charts': 'none' }, '/tracking')).toBe('addDelete')
    expect(levelIn({ '/tracking': 'none' }, '/tracking')).toBe('none')
    expect(levelIn({ '/x': 'customize' }, '/x')).toBe('addDelete')
  })

  it('maps routes to screens, with the sub-user pages under User accounts', () => {
    expect(screenForPath('/reports/movement')).toBe('/reports/movement')
    expect(screenForPath('/settings/company-subuser')).toBe('users')
    expect(screenForPath('/settings')).toBeNull()
    expect(screenForPath('/reports')).toBeNull()
  })

  it('orders the levels', () => {
    expect(atLeast('modify', 'view')).toBe(true)
    expect(atLeast('view', 'modify')).toBe(false)
    expect(atLeast('addDelete', 'addDelete')).toBe(true)
  })

  it('counts open screens and covers every report', () => {
    expect(ALL_SCREENS.some(s => s.id === '/reports/event')).toBe(true)
    const closed = Object.fromEntries(ALL_SCREENS.map(s => [s.id, 'none']))
    expect(openCount(closed)).toBe(0)
    expect(openCount({})).toBe(ALL_SCREENS.length)
  })
})
