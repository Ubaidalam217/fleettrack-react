import { describe, expect, it } from 'vitest'
import { summaryRows, summaryTotals, detailTables, groupRows, analytics, statusRows, listExport, detailExport, arrivedOnTime } from './journeyReports'

const j = (over = {}) => ({
  id: 'j1', ref: 'JRN-2026-0001', title: 'Ruwais run', vehicleLabel: 'AD 1', driverName: 'Ali', customer: 'ADNOC', status: 'Completed', display: 'Completed',
  plannedStart: '2026-11-22T02:00:00Z', expectedArrival: '2026-11-22T04:00:00Z', actualStart: '2026-11-22T02:10:00Z', actualArrival: '2026-11-22T04:25:00Z',
  plannedDistanceKm: 100, drivenKm: 104, alertCount: 2, cost: 50, offRouteCount: 1, stopsDone: 2,
  stops: [
    { seq: 0, name: 'Depot', plannedDepart: '2026-11-22T02:00:00Z', actualDepart: '2026-11-22T02:10:00Z', departTiming: 'ON_TIME', departDiffMin: 10, status: 'DEPARTED' },
    { seq: 1, name: 'Gate', purpose: 'DELIVERY', plannedArrive: '2026-11-22T03:00:00Z', actualArrive: '2026-11-22T03:20:00Z', arriveTiming: 'LATE', arriveDiffMin: 20, legKm: 50, signatureRequired: true, signature: { signedByName: 'Omar' }, formName: 'POD', form: null, status: 'DEPARTED' },
    { seq: 2, name: 'Site', plannedArrive: '2026-11-22T04:00:00Z', actualArrive: '2026-11-22T04:25:00Z', arriveTiming: 'LATE', arriveDiffMin: 25, legKm: 50, status: 'ARRIVED' },
  ],
  events: [{ type: 'ARRIVE_LATE', stopSeq: 1 }, { type: 'OFF_ROUTE' }],
  ...over,
})

describe('journey reports', () => {
  it('summary: planned vs actual times in UAE, delay, km, alerts, cost', () => {
    const [r] = summaryRows([j()])
    expect(r).toMatchObject({ pStart: '22/11/2026 06:00', aStart: '22/11/2026 06:10', aEnd: '22/11/2026 08:25', delay: '+25 min', pKm: '100', aKm: '104', alerts: 2, cost: '50.00' })
    const t = Object.fromEntries(summaryTotals([j(), j({ id: 'j2', stops: j().stops.map((s, i) => (i === 2 ? { ...s, arriveTiming: 'ON_TIME' } : s)) })]).map(x => [x.label, x.value]))
    expect(t['Arrived on time']).toBe('50%')
    expect(t.Cost).toBe('100.00')
  })

  it('detail: one row per stop with the result, signature and form', () => {
    const [t] = detailTables([j()])
    expect(t.rows.map(r => r.seq)).toEqual(['A', '1', 'B'])
    expect(t.rows[1]).toMatchObject({ state: 'Delivery', arr: 'Late +20 min', signature: 'Signed (Omar)', form: 'Pending', events: 1, legKm: '50' })
    expect(t.rows[0].dep).toBe('On time +10 min')
  })

  it('per vehicle / driver / customer, and the analytics', () => {
    const rows = [j(), j({ id: 'j2', vehicleLabel: 'AD 2', status: 'Cancelled', display: 'Cancelled', drivenKm: null })]
    const g = groupRows(rows, x => x.vehicleLabel)
    expect(g.map(x => [x.name, x.journeys, x.completed, x.cancelled])).toEqual([['AD 1', 1, 1, 0], ['AD 2', 1, 0, 1]])
    const a = analytics(rows)
    expect(a.kpis).toMatchObject({ journeys: 2, completed: 1, onTimePct: 0, avgDelayMin: 25, offRoute: 2 })
    expect(a.routes[0]).toMatchObject({ route: 'Depot → Site', journeys: 2, diff: '+4%' })
    expect(arrivedOnTime(j())).toBe(false)
  })

  it('the list and one journey as papers', () => {
    expect(statusRows([j()])[0]).toMatchObject({ stops: '2/2', eta: '08:25' })
    expect(listExport([j()], { dayText: '2026-11-22' }).tables[0].rows).toHaveLength(1)
    const d = detailExport({ ...j(), approvalStatus: 'APPROVED', decidedByName: 'HSE', priority: 'Normal', cost: { total: 50 } })
    expect(d.tables.map(t => t.key)).toEqual(['stops', 'events'])
    expect(d.pairs.filter(Boolean).find(p => p[0] === 'Cost')[1]).toBe('50.00')
  })
})
