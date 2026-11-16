import { describe, it, expect, vi } from 'vitest'

// Real mode: the levels come from the signed-in account (mock mode opens everything).
vi.mock('./mode.js', () => ({ IS_REAL: true, API_URL: 'http://api.test' }))

const { sessionLevel } = await import('./screens')

describe('Super-Admin-only screens', () => {
  it('open for a Super Admin, closed to every other role whatever its permission map says', () => {
    expect(sessionLevel({ role: 'SUPER_ADMIN' }, '/settings/data-monitor')).toBe('addDelete')
    for (const role of ['GGB_ADMIN', 'GROUP_ADMIN', 'BG_USER', 'SUB_USER']) {
      expect(sessionLevel({ role }, '/settings/data-monitor')).toBe('none')
      expect(sessionLevel({ role, screenAccess: { '/settings/data-monitor': 'addDelete' } }, '/settings/data-monitor')).toBe('none')
    }
  })

  it('leaves the other screens as they were', () => {
    expect(sessionLevel({ role: 'BG_USER' }, '/tracking')).toBe('addDelete')
    expect(sessionLevel({ role: 'BG_USER', screenAccess: { '/tracking': 'none' } }, '/tracking')).toBe('none')
    expect(sessionLevel({ role: 'SUPER_ADMIN', screenAccess: { '/tracking': 'none' } }, '/tracking')).toBe('addDelete')
  })
})
