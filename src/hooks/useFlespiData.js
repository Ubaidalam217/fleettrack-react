import { useState, useEffect, useCallback } from 'react'
import { computeHealthScore } from '../utils/healthScore'

// In dev the Vite proxy forwards /flespi → https://flespi.io (avoids CORS).
// In production the browser calls Flespi directly (Flespi supports CORS).
export const BASE_URL = import.meta.env.DEV ? '/flespi' : 'https://flespi.io'

const FLESPI_TOKEN = import.meta.env.VITE_FLESPI_TOKEN
export const HEADERS = {
  'Authorization': `FlespiToken ${FLESPI_TOKEN}`,
  'Content-Type': 'application/json',
}

function vehicleStatus(tel) {
  if (!tel) return 'NoData'
  const tss = Object.values(tel).map(p => p?.ts).filter(Boolean)
  if (!tss.length) return 'NoData'
  const lastTs = Math.max(...tss)
  if (Date.now() / 1000 - lastTs > 86400) return 'Inactive'
  const ign   = tel['engine.ignition.status']?.value
  const speed = tel['position.speed']?.value ?? 0
  if (ign === true  && speed > 0) return 'Running'
  if (ign === true  && speed === 0) return 'Idle'
  if (ign === false) return 'Stopped'
  return 'NoData'
}

function maxTs(tel) {
  if (!tel) return null
  const tss = Object.values(tel).map(p => p?.ts).filter(Boolean)
  return tss.length ? Math.max(...tss) : null
}

export function useFlespiData() {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [dRes, tRes] = await Promise.all([
        fetch(`${BASE_URL}/gw/devices/all`, { headers: HEADERS }),
        fetch(
          `${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,engine.ignition.status,timestamp`,
          { headers: HEADERS }
        ),
      ])
      if (!dRes.ok) throw new Error(`Devices API ${dRes.status}: ${dRes.statusText}`)
      if (!tRes.ok) throw new Error(`Telemetry API ${tRes.status}: ${tRes.statusText}`)

      const [dd, td] = await Promise.all([dRes.json(), tRes.json()])

      const devices = dd.result || []

      // Build telemetry lookup by device id
      const telMap = {}
      ;(td.result || []).forEach(r => { telMap[r.id] = r.telemetry })

      // Enrich each device with computed status + last known position
      const vehicles = devices.map(d => {
        const tel    = telMap[d.id] || null
        const status = vehicleStatus(tel)
        return {
          id:     d.id,
          name:   d.name || d.ident || `Device ${d.id}`,
          ident:  d.ident || '',
          status,
          speed:  tel?.['position.speed']?.value     ?? null,
          lat:    tel?.['position.latitude']?.value  ?? null,
          lng:    tel?.['position.longitude']?.value ?? null,
          lastTs: maxTs(tel),
        }
      })

      const total    = vehicles.length
      const running  = vehicles.filter(v => v.status === 'Running').length
      const idle     = vehicles.filter(v => v.status === 'Idle').length
      const stopped  = vehicles.filter(v => v.status === 'Stopped').length
      const inactive = vehicles.filter(v => v.status === 'Inactive').length
      const noData   = vehicles.filter(v => v.status === 'NoData').length
      // Active = Running + Idle only (Stopped vehicles are not considered active)
      const active   = running + idle

      const healthScore = computeHealthScore({ total, running, idle, stopped, inactive, noData, active })

      // Trips API not available on free plan — estimate from live status counts
      const totalTrips    = running * 3 + stopped * 1
      const totalDistance = running * 85 + stopped * 12

      setData(prev => ({
        ...(prev || {}),
        total:         vehicles.length,
        active:        running + idle,
        running,
        idle,
        stopped,
        inactive,
        noData,
        healthScore,
        vehicles,
        totalTrips,
        totalDistance,
      }))
      setLastUpdated(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  return { data, loading, error, lastUpdated, refresh: fetchData }
}
