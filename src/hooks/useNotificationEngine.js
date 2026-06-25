import { useEffect, useRef } from 'react'
import { generateNotifications } from '../services/notificationEngine'
import * as store from '../services/notificationStore'
import { sendPushNotification } from '../services/pushNotifications'
import { BASE_URL, HEADERS } from './useFlespiData'

const PREV_KEY = 'ft_eng_prev_snap'
const TIME_KEY = 'ft_eng_time_tracking'

function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) }
  catch { return null }
}
function writeSession(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)) } catch {}
}

async function fetchEngineSnapshot() {
  const [devRes, telRes] = await Promise.all([
    fetch(`${BASE_URL}/gw/devices/all`, { headers: HEADERS }),
    fetch(
      `${BASE_URL}/gw/devices/all/telemetry/position.latitude,position.longitude,position.speed,engine.ignition.status,timestamp`,
      { headers: HEADERS }
    ),
  ])

  if (!devRes.ok) throw new Error(`devices ${devRes.status}`)
  if (!telRes.ok) throw new Error(`telemetry ${telRes.status}`)

  const [dd, td] = await Promise.all([devRes.json(), telRes.json()])
  const devices = dd.result || []

  // Build telemetry lookup by device id
  const telMap = {}
  ;(td.result || []).forEach(r => { telMap[r.id] = r.telemetry || {} })

  return devices.map(d => {
    const tel = telMap[d.id] || {}

    // Use the highest .ts value across all telemetry fields as "server saw this device at"
    const tss = Object.values(tel).map(p => p?.ts).filter(Boolean)
    const serverTs = tss.length ? Math.max(...tss) : null

    return {
      id:       d.id,
      name:     d.name || d.ident || `Device ${d.id}`,
      speed:    tel['position.speed']?.value ?? 0,
      ignition: tel['engine.ignition.status']?.value ?? false,
      lat:      tel['position.latitude']?.value ?? null,
      lng:      tel['position.longitude']?.value ?? null,
      serverTs, // unix seconds
    }
  })
}

// ── Dev logging ────────────────────────────────────────────────────────────
function devLog(snap, ruleResults, newNotifs) {
  if (!import.meta.env.DEV) return

  const now = Date.now()
  console.group(`[NotifEngine] Tick at ${new Date().toLocaleTimeString()}`)

  console.log('Vehicles fetched from Flespi:', snap.length)

  console.table(snap.map(v => ({
    id:                  v.id,
    name:                v.name,
    speed_kmh:           v.speed,
    ignition:            v.ignition,
    lat:                 v.lat !== null ? +v.lat.toFixed(5) : null,
    lng:                 v.lng !== null ? +v.lng.toFixed(5) : null,
    last_update_ago_min: v.serverTs
      ? Math.round((now - v.serverTs * 1000) / 60_000)
      : null,
  })))

  if (ruleResults.length) {
    console.log('Rules evaluated:')
    console.table(ruleResults)
  } else {
    console.log('Rules evaluated: (no previous snapshot yet — baseline tick)')
  }

  console.log(`New notifications added: ${newNotifs.length}`)
  if (newNotifs.length) {
    newNotifs.forEach(n =>
      console.log(`  ➕ [${n.severity.toUpperCase()}] ${n.ruleId} → ${n.vehicleName}: ${n.title}`)
    )
  }

  console.groupEnd()
}

// ── Engine hook ────────────────────────────────────────────────────────────
export function useNotificationEngine() {
  const running = useRef(false)

  const tick = async () => {
    if (running.current) return
    running.current = true
    try {
      const currentSnap    = await fetchEngineSnapshot()
      const previousSnap   = readSession(PREV_KEY)
      const timeTracking   = readSession(TIME_KEY) || {}
      const existingNotifs = store.getAll()

      const { newNotifs, updatedTimeTracking, ruleResults } = generateNotifications(
        currentSnap, previousSnap, existingNotifs, timeTracking
      )

      writeSession(PREV_KEY, currentSnap)
      writeSession(TIME_KEY, updatedTimeTracking)

      if (newNotifs.length) {
        store.addMany(newNotifs)
        newNotifs.forEach(notif =>
          sendPushNotification(notif.title, {
            body:     notif.message,
            tag:      `${notif.ruleId}-${notif.vehicleId}`,
            severity: notif.severity,
          })
        )
      }

      devLog(currentSnap, ruleResults ?? [], newNotifs)
    } catch (err) {
      // Silent failure — existing notifications persist, engine retries next tick
      if (import.meta.env.DEV) console.warn('[NotifEngine] Error (silent):', err.message)
    } finally {
      running.current = false
    }
  }

  useEffect(() => {
    tick() // run immediately on mount
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
