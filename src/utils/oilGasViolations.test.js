import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OIL_GAS_VIOLATION_TYPES, NOT_OIL_GAS_TYPES, ONE_TIME_VIOLATION_TYPES, isOilGasViolation, isOneTimeViolation,
} from './oilGasViolations'

// Read as text: the engine imports Prisma, and the Settings store its stores.
const source = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
function engineTypes() {
  const text = source('../../server/src/lib/alertEngine.js')
  const block = text.slice(text.indexOf('export const TYPES = Object.freeze({'))
  return [...block.slice(0, block.indexOf('\n})')).matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map(m => m[1])
}
function settingsTypes() {
  const text = source('../pages/settings/mockData.js')
  const block = text.slice(text.indexOf('export const ALERT_TYPES = ['))
  return [...block.slice(0, block.indexOf('\n]')).matchAll(/^ {4}value: '([a-z_]+)'/gm)].map(m => m[1])
}

describe('Oil & Gas violation types', () => {
  it('keeps the driving and tamper violations, not status, paperwork or temperature', () => {
    expect([...OIL_GAS_VIOLATION_TYPES].sort()).toEqual([
      'battery_tamper', 'geofence_speed', 'harsh_acceleration', 'harsh_braking', 'harsh_cornering',
      'idle', 'night_driving', 'overspeed', 'panic', 'tamper',
    ])
    for (const t of ['temperature', 'license_expiry', 'ignition_on', 'ignition_off', 'geofence_enter', 'geofence_exit', 'offline', 'suspended_driver', 'custom']) {
      expect(isOilGasViolation(t)).toBe(false)
    }
    expect(isOilGasViolation('overspeed')).toBe(true)
    expect(isOilGasViolation(undefined)).toBe(false)
  })

  it('sorts every type the engine and Settings know into kept or left out', () => {
    const engine = engineTypes()
    const settings = settingsTypes()
    expect(engine).toContain('panic')
    expect(settings).toContain('panic')
    const sorted = new Set([...OIL_GAS_VIOLATION_TYPES, ...NOT_OIL_GAS_TYPES])
    for (const t of new Set([...engine, ...settings])) expect(sorted.has(t), t).toBe(true)
    // Every id kept is a real one, but harsh cornering, kept for the day the engine raises it.
    for (const t of OIL_GAS_VIOLATION_TYPES) if (t !== 'harsh_cornering') expect(engine, t).toContain(t)
    expect(OIL_GAS_VIOLATION_TYPES.filter(t => NOT_OIL_GAS_TYPES.includes(t))).toEqual([])
  })

  it('SOS and harsh braking / acceleration / cornering are one-time events', () => {
    expect([...ONE_TIME_VIOLATION_TYPES].sort()).toEqual(['harsh_acceleration', 'harsh_braking', 'harsh_cornering', 'panic'])
    expect(isOneTimeViolation('panic')).toBe(true)
    expect(isOneTimeViolation('overspeed')).toBe(false)
    expect(isOneTimeViolation('idle')).toBe(false)
  })
})
