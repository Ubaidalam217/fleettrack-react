import { describe, expect, it } from 'vitest'
import { visibleColumns, columnChoices } from './reportColumns'

const COLS = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]

describe('visibleColumns', () => {
  it('drops the hidden columns and keeps the order', () => {
    expect(visibleColumns(COLS, new Set(['b'])).map(c => c.key)).toEqual(['a', 'c'])
    expect(visibleColumns(COLS, new Set())).toBe(COLS)
  })

  it('never leaves a report with no columns', () => {
    expect(visibleColumns(COLS, new Set(['a', 'b', 'c']))).toBe(COLS)
  })
})

describe('columnChoices', () => {
  it('lists each key once across tables, first label wins', () => {
    const out = columnChoices(COLS, [{ key: 'b', label: 'Other B' }, { key: 'd', label: 'D' }])
    expect(out).toEqual([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }, { key: 'd', label: 'D' }])
  })
})
