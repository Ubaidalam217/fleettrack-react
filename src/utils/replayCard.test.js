import { describe, expect, it } from 'vitest'
import { DEFAULT_CARD_PREFS, normalizeCardPrefs, togglePinned, nextCorner, cardPrefsKey } from './replayCard'

describe('normalizeCardPrefs', () => {
  it('fills the defaults for nothing or junk', () => {
    expect(normalizeCardPrefs(null)).toEqual(DEFAULT_CARD_PREFS)
    expect(normalizeCardPrefs('x')).toEqual(DEFAULT_CARD_PREFS)
    expect(normalizeCardPrefs({ show: 'yes', dock: 'middle', compact: 1 })).toEqual(DEFAULT_CARD_PREFS)
  })

  it('keeps valid values, and a pinned card remembers its corner', () => {
    expect(normalizeCardPrefs({ show: false, dock: 'tr', compact: true })).toEqual({ show: false, dock: 'tr', corner: 'tr', compact: true })
    expect(normalizeCardPrefs({ dock: 'follow', corner: 'bl' })).toMatchObject({ dock: 'follow', corner: 'bl' })
  })
})

describe('pinning', () => {
  it('pins to the remembered corner and back to following', () => {
    const pinned = togglePinned({ dock: 'follow', corner: 'bl' })
    expect(pinned).toMatchObject({ dock: 'bl', corner: 'bl' })
    expect(togglePinned(pinned)).toMatchObject({ dock: 'follow', corner: 'bl' })
  })

  it('walks the corners', () => {
    expect(nextCorner({ dock: 'tl' }).dock).toBe('tr')
    expect(nextCorner({ dock: 'tr' }).dock).toBe('bl')
    expect(nextCorner({ dock: 'bl' }).dock).toBe('tl')
    expect(nextCorner({ dock: 'follow', corner: 'tr' }).dock).toBe('bl')
  })

  it('keys the storage by user', () => {
    expect(cardPrefsKey('u1')).toBe('ft-replay-card.u1')
    expect(cardPrefsKey(null)).toBe('ft-replay-card.demo')
  })
})
