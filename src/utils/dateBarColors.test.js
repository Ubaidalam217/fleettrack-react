import { describe, expect, it } from 'vitest'
import { dateBarColor, dateBarHex, dateLabelEvery } from './dateBarColors'

describe('dateBarColors', () => {
  it('cycles six hues, each round paler than the last', () => {
    expect(dateBarColor(0)).toEqual([52, 152, 186])
    expect(dateBarColor(1)).not.toEqual(dateBarColor(0))
    const sum = c => c.reduce((s, v) => s + v, 0)
    expect(sum(dateBarColor(24))).toBeGreaterThan(sum(dateBarColor(0)))
    expect(dateBarHex(0)).toBe('#3498ba')
  })

  it('labels every other date, sparser past 40', () => {
    expect(dateLabelEvery(31)).toBe(2)
    expect(dateLabelEvery(90)).toBe(6)
  })
})
