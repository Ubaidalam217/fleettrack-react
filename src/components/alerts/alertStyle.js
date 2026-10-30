/**
 * How an alert looks wherever it appears: the severity colours and one icon per
 * alert type, shared by Settings > Alerts, the header bell and the Notifications
 * page so a Critical rule reads the same red in all three.
 *
 * Plain .js beside SeverityChip.jsx for the reason formStyles.js sits beside
 * FormKit.jsx — a module exporting anything but components drops out of Fast
 * Refresh.
 *
 * The colours are mid-tone with a translucent fill so one value works on both
 * the light and the dark card surfaces.
 */

import {
  Gauge, Hourglass, LogIn, LogOut, Power, PowerOff, WifiOff,
  Thermometer, Moon, IdCard, Bell,
} from 'lucide-react'

export const SEVERITY_TONE = {
  Low:      { color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.28)' },
  Medium:   { color: '#d97706', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)' },
  High:     { color: '#ea580c', bg: 'rgba(234,88,12,0.12)',   border: 'rgba(234,88,12,0.3)' },
  Critical: { color: '#dc2626', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.32)' },
}

export const severityTone = s => SEVERITY_TONE[s] ?? SEVERITY_TONE.Medium

/** Keyed by the ALERT_TYPES values (pages/settings/mockData.js). */
export const ALERT_TYPE_ICON = {
  overspeed:      Gauge,
  idle:           Hourglass,
  geofence_enter: LogIn,
  geofence_exit:  LogOut,
  ignition_on:    Power,
  ignition_off:   PowerOff,
  offline:        WifiOff,
  temperature:    Thermometer,
  night_driving:  Moon,
  license_expiry: IdCard,
}

export const alertTypeIcon = type => ALERT_TYPE_ICON[type] ?? Bell
