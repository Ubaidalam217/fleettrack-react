import { describe, expect, it } from 'vitest'
import { presenceCells, eventCells, hotspots } from './heatmap'

const at = (t, lat, lng, speed, ign = true) => ({ timestamp: t, 'position.latitude': lat, 'position.longitude': lng, 'position.speed': speed, 'engine.ignition.status': ign })

describe('presenceCells', () => {
  // Parked 2 h at the depot (ignition off), then 10 min idling there, then driving.
  const depot = [24.4, 54.4]
  const msgs = [
    at(0, ...depot, 0, false), at(3600, ...depot, 0, false), at(7200, ...depot, 0, true),
    at(7800, ...depot, 0, true), at(7860, 24.41, 54.41, 40), at(7920, 24.42, 54.42, 50),
  ]
  const byVehicle = new Map([[1, msgs]])

  it('counts time, by what the vehicle was doing', () => {
    const all = presenceCells(byVehicle, { mode: 'all' })
    expect(all.totalSec).toBe(7920) // the last reading has no "until next"
    const engine = presenceCells(byVehicle, { mode: 'engine' })
    expect(engine.totalSec).toBe(600 + 60 + 60)
    const moving = presenceCells(byVehicle, { mode: 'moving' })
    expect(moving.totalSec).toBe(60)
    expect(moving.cells).toHaveLength(1)
  })

  it('skips silences too long to know, and 0,0 fixes', () => {
    const gap = new Map([[1, [at(0, 24.4, 54.4, 30), at(3 * 3600, 24.4, 54.4, 30), at(3 * 3600 + 10, 0, 0, 30), at(3 * 3600 + 20, 24.4, 54.4, 30)]]])
    // Only the 10 s from the reading after the gap to the next one count; the
    // 3 h silence and the reading at 0,0 do not.
    expect(presenceCells(gap, { mode: 'moving' }).totalSec).toBe(10)
  })
})

describe('eventCells and hotspots', () => {
  it('counts events per place by type, and joins a yard into one hot spot', () => {
    const ev = (lat, lng, type, deviceId = 7) => ({ lat, lng, type, deviceId })
    const events = [
      ev(24.4, 54.4, 'overspeed'), ev(24.4001, 54.4001, 'overspeed'), ev(24.4006, 54.4, 'idle', 8),
      ev(25.2, 55.3, 'harsh_braking'), ev(null, null, 'offline'),
    ]
    const { cells, total, unplaced } = eventCells(events, { labelOf: e => `V${e.deviceId}` })
    expect([total, unplaced]).toEqual([4, 1])
    const [top, next] = hotspots(cells)
    expect(top).toMatchObject({ rank: 1, weight: 3, types: { overspeed: 2, idle: 1 }, vehicles: ['V7', 'V8'] })
    expect(next).toMatchObject({ rank: 2, weight: 1, types: { harsh_braking: 1 } })
  })
})
