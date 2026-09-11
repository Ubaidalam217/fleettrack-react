import { useEffect, useRef } from 'react'
import { generateNotifications } from '../services/notificationEngine'
import * as store from '../services/notificationStore'
import { sendPushNotification } from '../services/pushNotifications'
import { useFlespiMQTT } from './useFlespiMQTT'

const PREV_KEY = 'ft_eng_prev_snap'
const TIME_KEY = 'ft_eng_time_tracking'

function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) }
  catch { return null }
}
function writeSession(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// Map live MQTT vehicles onto the snapshot shape generateNotifications expects.
function toSnapshot(vehicles) {
  return vehicles.map(v => ({
    id:       v.id,
    name:     v.name,
    speed:    v.speed ?? 0,
    ignition: v.ignition ?? false,
    lat:      v.lat ?? null,
    lng:      v.lng ?? null,
    serverTs: v.lastTs ?? null,
  }))
}

// ── Dev logging ────────────────────────────────────────────────────────────
function devLog(snap, ruleResults, newNotifs) {
  if (!import.meta.env.DEV) return

  const now = Date.now()
  console.group(`[NotifEngine] Tick at ${new Date().toLocaleTimeString()}`)

  console.log('Vehicles from MQTT snapshot:', snap.length)

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
  const { vehicles } = useFlespiMQTT()
  const running = useRef(false)

  useEffect(() => {
    if (!vehicles.length) return
    if (running.current) return
    running.current = true

    try {
      const currentSnap    = toSnapshot(vehicles)
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
      // Silent failure — existing notifications persist, engine re-evaluates on next message
      if (import.meta.env.DEV) console.warn('[NotifEngine] Error (silent):', err.message)
    } finally {
      running.current = false
    }
  }, [vehicles])
}
