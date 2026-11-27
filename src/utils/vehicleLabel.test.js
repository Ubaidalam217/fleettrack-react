import { describe, expect, it } from 'vitest'
import { flespiNameNote, flespiStatusFor, labelOf, vehicleLabel, withRegisterLabels } from './vehicleLabel'

describe('labelOf', () => {
  it('takes our plate, then our fleet no., then the Flespi plate, the Flespi name, the IMEI', () => {
    const all = { plateNo: 'AD 1', fleetNo: 'FL-1', flespiPlate: 'Meta', flespiName: 'Test Bench', imei: '8630' }
    expect(labelOf(all)).toBe('FL-1 - AD 1')
    expect(labelOf({ ...all, plateNo: '' })).toBe('FL-1')
    expect(labelOf({ ...all, plateNo: ' ', fleetNo: null })).toBe('Meta')
    expect(labelOf({ flespiName: 'Test Bench', imei: '8630' })).toBe('Test Bench')
    expect(labelOf({ imei: '8630' })).toBe('8630')
    expect(labelOf({})).toBe('')
    expect(labelOf()).toBe('')
  })

  it('trims what it returns', () => {
    expect(labelOf({ plateNo: '  AD 149 ' })).toBe('AD 149')
  })
})

describe('vehicleLabel', () => {
  it('names a register row by vehicle number, then fleet no. (vehicleId), then IMEI', () => {
    expect(vehicleLabel({ vehicleNumber: 'AD 12411', vehicleId: 'FL-8', imei: '864636068585849' })).toBe('FL-8 - AD 12411')
    expect(vehicleLabel({ vehicleNumber: '', vehicleId: 'FL-8', imei: '864636068585849' })).toBe('FL-8')
    expect(vehicleLabel({ vehicleNumber: '', vehicleId: '', imei: '864636068585849' })).toBe('864636068585849')
  })

  it('names an API vehicle by plateNo, fleetNo, IMEI', () => {
    expect(vehicleLabel({ id: 'v1', plateNo: 'AD 1', fleetNo: 'FL', imei: '1' })).toBe('FL - AD 1')
    expect(vehicleLabel({ id: 'v1', plateNo: null, fleetNo: 'FL', imei: '1' })).toBe('FL')
    expect(vehicleLabel({ id: 'v1', plateNo: null, fleetNo: null, imei: '1' })).toBe('1')
  })

  it('names a live device by its register label when it has one', () => {
    expect(vehicleLabel({ id: 7, name: 'Test Bench', ident: '1', master: { plateNo: 'Old' }, label: 'AD 99' })).toBe('AD 99')
  })

  it('falls back on a live device to the Flespi plate, the Flespi name, the IMEI, then "Device n"', () => {
    expect(vehicleLabel({ id: 7, name: 'KM 6651 F', ident: '1', master: { plateNo: 'Hyundai' } })).toBe('Hyundai')
    expect(vehicleLabel({ id: 7, name: 'Test Bench', ident: '1', master: { plateNo: '' } })).toBe('Test Bench')
    expect(vehicleLabel({ id: 7, name: '', ident: '8630', master: {} })).toBe('8630')
    expect(vehicleLabel({ id: 7, name: '', ident: '', master: {} })).toBe('Device 7')
  })

  it('treats a bare { id, name } as a device (the reports build those for a device that left the list)', () => {
    expect(vehicleLabel({ id: 42, name: '42' })).toBe('42')
    expect(vehicleLabel({ id: 42 })).toBe('Device 42')
    expect(vehicleLabel({ id: 'v1', imei: '8630' })).toBe('8630')
  })

  it('is empty for nothing', () => {
    expect(vehicleLabel(null)).toBe('')
    expect(vehicleLabel(undefined)).toBe('')
    expect(vehicleLabel('AD 1')).toBe('')
  })
})

describe('withRegisterLabels', () => {
  const device = (id, name, ident, plate = '') => ({ id, name, ident, master: { plateNo: plate, fleetNo: 'FL-meta', vehicleType: 'car' }, speed: 3 })
  const rows = [
    { id: 'v1', vehicleNumber: 'PLATE-2', vehicleId: 'FL-02', imei: '862272081368658' },
    { id: 'v2', vehicleNumber: '', vehicleId: 'FL-09', imei: '86-22720-81368294' },
  ]

  it('gives a registered device our plate as label, name and master.plateNo, and keeps the Flespi name', () => {
    const [out] = withRegisterLabels([device(1, 'AD 16629-G1', '862272081368658', 'AD 16629-G1')], rows)
    expect(out.label).toBe('FL-02 - PLATE-2')
    expect(out.name).toBe('FL-02 - PLATE-2')
    expect(out.master).toEqual({ plateNo: 'PLATE-2', fleetNo: 'FL-02', vehicleType: 'car' })
    expect(out.flespiName).toBe('AD 16629-G1')
    expect(out.registered).toBe(true)
    expect(out.speed).toBe(3)
    expect(vehicleLabel(out)).toBe('FL-02 - PLATE-2')
    expect(flespiNameNote(out)).toBe('AD 16629-G1')
  })

  it('uses our fleet no. when we have no plate, never the stale Flespi plate (matching the IMEI by digits)', () => {
    const [out] = withRegisterLabels([device(2, 'AD 91620-R8', '862272081368294', 'AD 91620-R8')], rows)
    expect(out.label).toBe('FL-09')
    expect(out.master.plateNo).toBe('')
    // Older readers show `master.plateNo || name`: that is ours too.
    expect(out.master.plateNo || out.name).toBe('FL-09')
  })

  it('leaves an unregistered device its Flespi name and metadata', () => {
    const d = device(3, 'KM 6651 F', '358480083689945', 'Hyundai')
    const [out] = withRegisterLabels([d], rows)
    expect(out.name).toBe('KM 6651 F')
    expect(out.master.plateNo).toBe('Hyundai')
    expect(out.label).toBe('Hyundai')
    expect(out.flespiName).toBe('KM 6651 F')
    expect(out.registered).toBeUndefined()
    expect(flespiNameNote(out)).toBe('KM 6651 F')
  })

  it('returns the same object for a device and register row that did not change', () => {
    const d = device(1, 'AD 16629-G1', '862272081368658')
    const a = withRegisterLabels([d], rows)[0]
    const b = withRegisterLabels([d], rows)[0]
    expect(b).toBe(a)
  })

  it('follows a rename in the register at once', () => {
    const d = device(1, 'AD 16629-G1', '862272081368658')
    const before = withRegisterLabels([d], rows)[0]
    const renamed = [{ ...rows[0], vehicleNumber: 'PLATE-2 NEW' }, rows[1]]
    const after = withRegisterLabels([d], renamed)[0]
    expect(before.label).toBe('FL-02 - PLATE-2')
    expect(after.label).toBe('FL-02 - PLATE-2 NEW')
    expect(after.name).toBe('FL-02 - PLATE-2 NEW')
  })

  it('passes a non-array through', () => {
    expect(withRegisterLabels(undefined, rows)).toBeUndefined()
  })
})

describe('flespiStatusFor', () => {
  const live = new Map([
    ['864636068585849', { id: 1, flespiName: 'AD 12411', name: 'PLATE-8' }],
    ['358480083689945', { id: 2, flespiName: 'KM 6651 F' }],
  ])

  it('says when no Flespi device has the IMEI', () => {
    expect(flespiStatusFor({ vehicleNumber: 'Test Bench', imei: '863257062083821' }, live)).toEqual({ state: 'missing' })
  })

  it('says when the Flespi device is named otherwise', () => {
    expect(flespiStatusFor({ vehicleNumber: 'PLATE-8', imei: '864636068585849' }, live)).toEqual({ state: 'differs', flespiName: 'AD 12411' })
    expect(flespiStatusFor({ vehicleNumber: 'Hyundai', imei: '358480083689945' }, live)).toEqual({ state: 'differs', flespiName: 'KM 6651 F' })
  })

  it('says nothing when they agree, or when there is nothing to compare', () => {
    expect(flespiStatusFor({ vehicleNumber: 'AD 12411', imei: '864636068585849' }, live)).toBeNull()
    expect(flespiStatusFor({ vehicleNumber: 'X', imei: '' }, live)).toBeNull()
    expect(flespiStatusFor({ vehicleNumber: 'X', imei: '1' }, null)).toBeNull()
  })
})

describe('fleet no. in front of the plate (client 2026-11-27)', () => {
  it('shows only the part that exists, and never repeats a number that is both', () => {
    expect(labelOf({ plateNo: 'AD 1', fleetNo: 'FL-1' })).toBe('FL-1 - AD 1')
    expect(labelOf({ plateNo: 'AD 1' })).toBe('AD 1')
    expect(labelOf({ fleetNo: 'FL-1', flespiName: 'Bench' })).toBe('FL-1')
    expect(labelOf({ plateNo: 'ad 1', fleetNo: 'AD 1' })).toBe('ad 1')
    expect(labelOf({ flespiName: 'Bench', imei: '1' })).toBe('Bench')
  })
})
