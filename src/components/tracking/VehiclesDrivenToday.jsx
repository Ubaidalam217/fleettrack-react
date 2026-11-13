import { useEffect, useMemo, useState } from 'react'
import { useFlespiData } from '../../hooks/useFlespiData'
import { useDrivers, useVehicles, ibuttonKey, driverForVehicleImei } from '../../data/settings'
import { useDriverDimension } from '../../hooks/useDriverDimension'
import { fetchTodayMessages } from '../../utils/todayMessages'
import { tripsByVehicle } from '../../utils/usageReports'
import { vehiclesDrivenBy } from '../../utils/vehiclesDrivenToday'

/**
 * Driver Info › Vehicles Driven Today (client requirement 8.3).
 *
 * One fleet-wide Flespi read of today (utils/todayMessages.js, shared with the
 * Dashboard), cut into trips the way the Trip reports
 * do it, and each trip given to the driver whose iButton was read in it — or,
 * untagged, to the driver assigned to the vehicle when it started
 * (utils/vehiclesDrivenToday.js, the assignment history).
 * A driver with no iButton can only have driven the vehicles assigned to them,
 * so only those are read.
 */

const time = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Note({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--c-text3)', lineHeight: 1.7, padding: '4px 0' }}>{children}</div>
}

export default function VehiclesDrivenToday({ driver }) {
  const { data } = useFlespiData()
  const drivers = useDrivers()
  const settingsVehicles = useVehicles()
  const driverDim = useDriverDimension()
  const code = ibuttonKey(driver?.ibuttonCode)

  // Re-keyed on the vehicle ids, not on each live poll's new array.
  const fleet = data?.vehicles ?? []
  // Without a tag, the vehicles assigned to the driver at any time today (history), else now.
  const dayStart = new Date().setHours(0, 0, 0, 0) / 1000
  const assignedTo = v => !!driver && (driverForVehicleImei(v.ident)?.id === driver.id
    || driverDim.assignedDuring(v, dayStart, Date.now() / 1000).some(w => w.key === `d:${driver.id}`))
  const candidates = code ? fleet : fleet.filter(assignedTo)
  const idsKey = candidates.map(v => v.id).sort((a, b) => a - b).join(',')

  const [state, setState] = useState({ loading: true, error: null, byDevice: null })
  useEffect(() => {
    if (!idsKey) { setState({ loading: false, error: null, byDevice: new Map() }); return }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    fetchTodayMessages(idsKey.split(',').map(Number))
      .then(byDevice => { if (!cancelled) setState({ loading: false, error: null, byDevice }) })
      .catch(err => { if (!cancelled) setState({ loading: false, error: err.message, byDevice: null }) })
    return () => { cancelled = true }
  }, [idsKey])

  const rows = useMemo(() => {
    if (!state.byDevice || !driver) return []
    const trips = tripsByVehicle(state.byDevice, fleet, { tzOffsetSec: -new Date().getTimezoneOffset() * 60 })
    // Assigned when the trip started: a vehicle handed over today counts only from then.
    const assignedAt = (v, ts) => driverDim.assignedFor(v, ts)?.key === `d:${driver.id}`
    return vehiclesDrivenBy(trips, { code, isAssigned: assignedAt })
  // fleet reads the stores below; the ids and the fetched day are what change the answer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.byDevice, driver, code, drivers, settingsVehicles, driverDim])

  if (!driver) return <Note>No driver assigned.</Note>
  if (state.loading) return <Note>Loading today’s trips…</Note>
  if (state.error) return <Note>Could not load today’s trips: {state.error}</Note>
  if (!rows.length) return <Note>No vehicles driven today.</Note>

  const th = { textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text3)', padding: '0 10px 6px 0' }
  const td = { fontSize: 13, fontWeight: 600, color: 'var(--c-text1)', padding: '6px 10px 6px 0', borderTop: '1px solid var(--c-border)', whiteSpace: 'nowrap' }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Vehicle</th>
            <th style={th}>First Trip</th>
            <th style={th}>Last Trip End</th>
            <th style={{ ...th, textAlign: 'right' }}>Trips</th>
            <th style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.deviceId}>
              <td style={td}>{r.name}</td>
              <td style={td}>{time(r.firstTs)}</td>
              <td style={td}>{time(r.lastTs)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.trips}</td>
              <td style={{ ...td, textAlign: 'right', paddingRight: 0 }}>{r.km.toFixed(1)} km</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
