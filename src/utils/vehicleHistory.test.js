import { describe, expect, it } from 'vitest'
import { moveEvent, moveFromTo, moveMatches, moveSentence, moveTone } from './vehicleHistory'

const out = { level: 'device', imei: '863257062083821', fromName: 'Test Bench', toName: null, vehicleLabel: 'Test Bench', note: 'Replaced by 869166081174012 — faulty', movedByName: 'Super Admin' }
const inn = { level: 'device', imei: '869166081174012', fromName: null, toName: 'Test Bench', vehicleLabel: 'Test Bench', note: 'Replaced 863257062083821 — faulty' }

describe('vehicle history rows in words', () => {
  it('names tracker changes, renames, merges and archives', () => {
    expect(moveEvent(out)).toBe('Tracker taken out')
    expect(moveEvent(inn)).toBe('Tracker installed')
    expect(moveFromTo(out)).toEqual({ from: 'IMEI 863257062083821', to: '—' })
    expect(moveFromTo(inn)).toEqual({ from: '—', to: 'IMEI 869166081174012' })
    expect(moveSentence({ level: 'rename', fromName: 'PLATE-1', toName: 'AD 149' })).toBe('Renamed PLATE-1 → AD 149')
    expect(moveSentence({ level: 'merge', fromName: 'Test Bench', toName: 'iTriangle Avinash' })).toBe('Test Bench merged into iTriangle Avinash')
    expect(moveSentence({ level: 'archive', fromName: 'Test Bench' })).toBe('Test Bench archived')
    expect(moveSentence({ level: 'branch', fromName: 'A', toName: 'B' })).toBe('Branch: A → B')
    expect(moveTone(out)).toBe('#b91c1c')
    expect(moveTone({ level: 'merge' })).toBe('#b45309')
    expect(moveTone({ level: 'rename' })).toBeNull()
  })

  it('finds a change by the old or the new IMEI, typed any way, by plate, user and note', () => {
    expect(moveMatches(out, '863257062083821')).toBe(true)
    expect(moveMatches(inn, '863 257 062')).toBe(true) // named in the note of the "installed" row
    expect(moveMatches(out, '869-166-081')).toBe(true)
    expect(moveMatches(out, 'test bench')).toBe(true)
    expect(moveMatches(out, 'super')).toBe(true)
    expect(moveMatches(out, 'faulty')).toBe(true)
    expect(moveMatches(out, 'AD 149')).toBe(false)
    expect(moveMatches(out, '')).toBe(true)
  })
})
