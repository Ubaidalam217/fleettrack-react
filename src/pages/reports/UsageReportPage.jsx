import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileSpreadsheet, Printer, X, AlertTriangle } from 'lucide-react'
import ReportFrame from '../../components/reports/ReportFrame'
import { useReportTitle, fileNameOf } from '../../components/reports/useReportTitle'
import PaperTable from '../../components/reports/PaperTable'
import ColumnPicker from '../../components/reports/ColumnPicker'
import { useHiddenColumns, useVisibleColumns } from '../../utils/reportColumns'
import LocationMapModal from '../../components/reports/LocationMapModal'
import TripRouteModal from '../../components/reports/TripRouteModal'
import { LABEL, FIELD, Chip, MultiSelect, CheckRow, ToolbarButton } from '../../components/reports/controls'
import { useFlespiData } from '../../hooks/useFlespiData'
import { driverNameForDevice, driverForIbutton, ibuttonKey } from '../../data/settings'
import { fetchMovementMessages, formatDateTime, formatDateLabel, formatTime, formatPrintDate, isAbortError } from '../../utils/movementReport'
import { resolveRowLocations } from '../../utils/reportLocations'
import { locationUrl } from '../../utils/mapLink'
import { exportGeoZonePdf, exportGeoZoneExcel } from '../../utils/geoZoneExport'
import { IS_REAL } from '../../data/mode'
import { useVehicles as useRegisteredVehicles, branchNameFor, imeiKey } from '../settings/mockData'
import DistanceDrivenCharts from '../../components/reports/DistanceDrivenCharts'
import {
  DEFAULT_USAGE_OPTS, tripsByVehicle, byDay, sumTrips, visibleTrips, tripUsage, gyrScore, hms, km,
} from '../../utils/usageReports'

/**
 * The trip-based reports of the client's 2026-11-06 list, one page with a
 * variant each: Full Usage, Trip, Summary Usage, Time Sheet, Private Usage and
 * GYR. They share the fetch (the Movement Report's messages), the trips
 * (utils/usageReports.js) and the paper layout; a variant only chooses its
 * columns, its grouping and which settings it shows.
 *
 * Settings recompute from the fetched messages — changing the speed limit or
 * hiding 0 km trips never fetches again.
 *
 * Scope: vehicles come from useFlespiData(), already narrowed to what the
 * signed-in user may see (see components/sidebar/reportsNav.js).
 */

const MAX_RANGE_DAYS = 31
const DAY_MS = 86_400_000

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'lastWeek',  label: 'Last Week' },
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'd30',       label: 'Last 30 days' },
  { key: 'custom',    label: 'Custom' },
]

const pad = n => String(n).padStart(2, '0')
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
function startOfWeek(d) {
  const s = startOfDay(d)
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}
function presetRange(key, now = new Date()) {
  const today = startOfDay(now)
  switch (key) {
    case 'today':     return { from: today, to: now, toEndOfDay: false }
    case 'yesterday': { const y = new Date(today.getTime() - DAY_MS); return { from: y, to: y, toEndOfDay: true } }
    case 'thisWeek':  return { from: startOfWeek(now), to: now, toEndOfDay: false }
    case 'lastWeek':  {
      const thisMon = startOfWeek(now)
      return { from: new Date(thisMon.getTime() - 7 * DAY_MS), to: new Date(thisMon.getTime() - DAY_MS), toEndOfDay: true }
    }
    case 'd7':  return { from: new Date(today.getTime() - 6 * DAY_MS), to: now, toEndOfDay: false }
    case 'd30': return { from: new Date(today.getTime() - 29 * DAY_MS), to: now, toEndOfDay: false }
    default:    return null
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RATING_STYLE = {
  Green:  { background: '#bbf7d0', color: '#14532d', fontWeight: 700 },
  Yellow: { background: '#fef08a', color: '#713f12', fontWeight: 700 },
  Red:    { background: '#fecaca', color: '#7f1d1d', fontWeight: 700 },
}
const USAGE_STYLE = {
  Business: { color: '#0a7e9c', fontWeight: 700 },
  Private:  { color: '#c2410c', fontWeight: 700 },
}

const round = v => (Number.isFinite(v) ? Math.round(v) : '—')
const band = (key, label) => ({ kind: 'band', key, label })
const endPoint = t => ({ lat: t.endLat, lng: t.endLng })

function totalsText(s, { idle = true, exceptions = true } = {}) {
  const parts = [`Trips ${s.trips}`, `Drive ${hms(s.driveSec)}`]
  if (idle) parts.push(`Idle ${hms(s.idleSec)}`)
  parts.push(`${km(s.distanceKm)} km`, `Max ${round(s.maxSpeed)} km/h`)
  if (exceptions) parts.push(`Over Speed ${s.overSpeedCount}`, `HB ${s.hbCount}`, `HA ${s.haCount}`, `XI ${s.xiCount}`)
  return parts.join('   ·   ')
}


// ── Oil & Gas (client, 2026-11-11): the Ctrack MaXx reports of the client's
// PDFs — Trip Details, Trip Locations, Trip Summary and Distance Driven. Same
// trips as the reports above; their columns, grouping and the "Report Summary"
// block that ends each one follow the client's samples.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = n => String(n).padStart(2, '0')
/** "01 Oct, 2026" */
const ctrackDate = d => `${two(d.getDate())} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
/** "01 Oct, 2026 00:32:10" */
const ctrackDateTime = ts => {
  const d = new Date(ts * 1000)
  return `${ctrackDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const km3 = v => (Number.isFinite(v) ? v.toFixed(3) : '—')
/** Ctrack's Standing: the part of the trip the vehicle was not moving. */
const standingSec = t => Math.max(0, (t.durationSec ?? 0) - (t.driveSec ?? 0))
const maxOrNA = v => (v > 0 ? Math.round(v) : 'N/A')

function ctrackTotals(trips) {
  const s = sumTrips(trips)
  const durationSec = trips.reduce((a, t) => a + (t.durationSec ?? 0), 0)
  const standSec = trips.reduce((a, t) => a + standingSec(t), 0)
  return { ...s, durationSec, standSec }
}

function reportSummary(trips) {
  const s = ctrackTotals(trips)
  return [
    { label: 'Total Trips', value: s.trips },
    { label: 'Total Trip Duration', value: hms(s.durationSec) },
    { label: 'Total Driving Time', value: hms(s.driveSec) },
    { label: 'Total Standing Time', value: hms(s.standSec) },
    { label: 'Max Speed (Kph)', value: maxOrNA(s.maxSpeed) },
    { label: 'Total Distance (Km)', value: km3(s.distanceKm) },
  ]
}

/**
 * Trip Details, Trip Locations and Trip Summary list finished trips only — an
 * ignition-on run that has not ended yet is left out (client, 2026-11-12), so
 * the rows and the Report Summary count the same trips.
 */
const finishedTrips = trips => trips.filter(t => !t.open)
const inProgressNote = n => (n ? `${n} trip${n === 1 ? '' : 's'} still in progress not shown` : null)
const joinNotes = (...notes) => notes.filter(Boolean).join(' · ') || null

/**
 * One trip as a Trip Details / Trip Locations row. `route` lets the Map link
 * draw the whole trip (TripRouteModal) instead of one point.
 */
const ctrackTripRow = (t, naSpeed, v) => ({
  key: t.startTs, ...endPoint(t), startLat: t.startLat, startLng: t.startLng,
  route: { deviceId: v.deviceId, vehicle: v.vehicleId, startTs: t.startTs, endTs: t.endTs, distanceKm: t.distanceKm, startLat: t.startLat, startLng: t.startLng, endLat: t.endLat, endLng: t.endLng },
  driver: t.driver, start: ctrackDateTime(t.startTs), end: ctrackDateTime(t.endTs),
  duration: hms(t.durationSec), driving: hms(t.driveSec), standing: hms(standingSec(t)),
  distance: km(t.distanceKm), speed: naSpeed ? maxOrNA(t.maxSpeed) : (t.maxSpeed > 0 ? Math.round(t.maxSpeed) : 0), map: 'Map',
})

function ctrackTripGroups(vs, ctx, naSpeed) {
  let hidden = 0
  let running = 0
  const all = []
  const groups = vs.map(v => {
    const done = finishedTrips(v.trips)
    running += v.trips.length - done.length
    const vis = visibleTrips(done, ctx.hideZero)
    hidden += vis.hidden
    all.push(...vis.trips)
    return { key: v.deviceId, label: v.vehicleId, rows: vis.trips.map(t => ctrackTripRow(t, naSpeed, v)), total: false }
  })
  const zeroNote = hidden ? `${hidden} trip${hidden === 1 ? '' : 's'} of 0 km hidden` : null
  return { groups, summary: reportSummary(all), note: joinNotes(zeroNote, inProgressNote(running)) }
}

// Each variant: its columns, its settings and how it groups the trips.
// columns: [{ key, label, width, pdf, align?, locate? }]
const VARIANTS = {
  fullUsage: {
    title: 'Full Usage Report',
    file: 'Full_Usage_Report',
    desc: 'Every trip with drive, idle and stop time, distance and exceptions, with daily and vehicle totals.',
    settings: ['speed', 'idle', 'hideZero'],
    columns: [
      { key: 'start',    label: 'Start',          width: '6.5%', pdf: 6 },
      { key: 'stop',     label: 'Stop',           width: '6.5%', pdf: 6 },
      { key: 'drive',    label: 'Drive Time',     width: '6%',   pdf: 5 },
      { key: 'idle',     label: 'Idle Time',      width: '6%',   pdf: 5 },
      { key: 'stopTime', label: 'Stop Time',      width: '6%',   pdf: 5 },
      { key: 'distance', label: 'Distance (km)',  width: '5.5%', pdf: 5, align: 'right' },
      { key: 'max',      label: 'Max km/h',       width: '4.5%', pdf: 4, align: 'right' },
      { key: 'os',       label: 'Over Speed',     width: '4.5%', pdf: 4, align: 'right' },
      { key: 'osDur',    label: 'Over Spd Dur.',  width: '6%',   pdf: 5 },
      { key: 'hb',       label: 'HB',             width: '3%',   pdf: 3, align: 'right' },
      { key: 'ha',       label: 'HA',             width: '3%',   pdf: 3, align: 'right' },
      { key: 'xi',       label: 'XI',             width: '3%',   pdf: 3, align: 'right' },
      { key: 'xiDur',    label: 'XI Duration',    width: '6%',   pdf: 5 },
      { key: 'driver',   label: 'Driver',         width: '8.5%', pdf: 7 },
      { key: 'location', label: 'Location (stop)', width: '25%', pdf: 24, locate: true },
    ],
    build(vs, ctx) {
      let hidden = 0
      const groups = vs.map(v => {
        const vis = visibleTrips(v.trips, ctx.hideZero)
        hidden += vis.hidden
        const rows = byDay(vis.trips).flatMap(d => [
          band(`d-${d.key}`, formatDateLabel(d.date)),
          ...d.trips.map(t => ({
            key: t.startTs, ...endPoint(t), endLat: t.endLat, endLng: t.endLng,
            start: formatTime(t.startTs), stop: t.open ? `${formatTime(t.endTs)} (on)` : formatTime(t.endTs),
            drive: hms(t.driveSec), idle: hms(t.idleSec), stopTime: hms(t.stopSec), distance: km(t.distanceKm),
            max: round(t.maxSpeed), os: t.overSpeedCount, osDur: hms(t.overSpeedSec), hb: t.hbCount, ha: t.haCount,
            xi: t.xiCount, xiDur: hms(t.xiSec), driver: t.driver,
          })),
          band(`t-${d.key}`, `Daily Total   ·   ${totalsText(sumTrips(d.trips))}`),
        ])
        return { key: v.deviceId, label: v.vehicleId, rows, total: `Vehicle Total   ·   ${totalsText(sumTrips(vis.trips))}` }
      })
      return { groups, note: hidden ? `${hidden} trip${hidden === 1 ? '' : 's'} of 0 km hidden` : null }
    },
  },

  trip: {
    title: 'Trip Report',
    file: 'Trip_Report',
    desc: 'Each trip from ignition on to off: start and stop time and place, duration, distance and speed.',
    settings: ['hideZero'],
    columns: [
      { key: 'start',    label: 'Trip Start',     width: '7%',  pdf: 6 },
      { key: 'stop',     label: 'Trip Stop',      width: '7%',  pdf: 6 },
      { key: 'duration', label: 'Duration',       width: '6%',  pdf: 5 },
      { key: 'distance', label: 'Distance (km)',  width: '6%',  pdf: 5, align: 'right' },
      { key: 'max',      label: 'Max km/h',       width: '5%',  pdf: 4, align: 'right' },
      { key: 'avg',      label: 'Avg km/h',       width: '5%',  pdf: 4, align: 'right' },
      { key: 'driver',   label: 'Driver',         width: '9%',  pdf: 8 },
      { key: 'startLocation', label: 'Start Location', width: '27.5%', pdf: 28 },
      { key: 'location', label: 'Stop Location',  width: '27.5%', pdf: 28, locate: true },
    ],
    build(vs, ctx) {
      let hidden = 0
      const groups = vs.map(v => {
        const vis = visibleTrips(v.trips, ctx.hideZero)
        hidden += vis.hidden
        const rows = byDay(vis.trips).flatMap(d => [
          band(`d-${d.key}`, formatDateLabel(d.date)),
          ...d.trips.map(t => ({
            key: t.startTs, ...endPoint(t), startLat: t.startLat, startLng: t.startLng,
            start: formatTime(t.startTs), stop: t.open ? `${formatTime(t.endTs)} (on)` : formatTime(t.endTs),
            duration: hms(t.durationSec), distance: km(t.distanceKm), max: round(t.maxSpeed),
            avg: t.driveSec > 0 ? round((t.distanceKm / t.driveSec) * 3600) : '—', driver: t.driver,
          })),
          band(`t-${d.key}`, `Daily Total   ·   ${totalsText(sumTrips(d.trips), { idle: false, exceptions: false })}`),
        ])
        return { key: v.deviceId, label: v.vehicleId, rows, total: `Vehicle Total   ·   ${totalsText(sumTrips(vis.trips), { idle: false, exceptions: false })}` }
      })
      return { groups, note: hidden ? `${hidden} trip${hidden === 1 ? '' : 's'} of 0 km hidden` : null }
    },
  },

  summary: {
    title: 'Summary Usage Report',
    file: 'Summary_Usage_Report',
    desc: 'One line per vehicle for the whole period: first start, last stop and the totals of every trip.',
    settings: ['speed', 'idle'],
    columns: [
      { key: 'vehicle',  label: 'Vehicle',        width: '10%', pdf: 9 },
      { key: 'first',    label: 'First Start',    width: '10%', pdf: 9 },
      { key: 'last',     label: 'Last Stop',      width: '10%', pdf: 9 },
      { key: 'trips',    label: 'Trips',          width: '4%',  pdf: 4, align: 'right' },
      { key: 'drive',    label: 'Drive Time',     width: '6.5%', pdf: 6 },
      { key: 'idle',     label: 'Idle Time',      width: '6.5%', pdf: 6 },
      { key: 'distance', label: 'Distance (km)',  width: '6.5%', pdf: 6, align: 'right' },
      { key: 'max',      label: 'Max km/h',       width: '5%',  pdf: 4, align: 'right' },
      { key: 'os',       label: 'Over Speed',     width: '5%',  pdf: 4, align: 'right' },
      { key: 'osDur',    label: 'Over Spd Dur.',  width: '6.5%', pdf: 6 },
      { key: 'hb',       label: 'HB',             width: '3.5%', pdf: 3, align: 'right' },
      { key: 'ha',       label: 'HA',             width: '3.5%', pdf: 3, align: 'right' },
      { key: 'xi',       label: 'XI',             width: '3.5%', pdf: 3, align: 'right' },
      { key: 'xiDur',    label: 'XI Duration',    width: '6.5%', pdf: 6 },
      { key: 'driver',   label: 'Driver',         width: '13%', pdf: 10 },
    ],
    build(vs) {
      const all = []
      const rows = vs.map(v => {
        all.push(...v.trips)
        const s = sumTrips(v.trips)
        return {
          key: v.deviceId, vehicle: v.vehicleId,
          first: s.firstStart ? formatDateTime(s.firstStart) : '—', last: s.lastStop ? formatDateTime(s.lastStop) : '—',
          trips: s.trips, drive: hms(s.driveSec), idle: hms(s.idleSec), distance: km(s.distanceKm), max: round(s.maxSpeed),
          os: s.overSpeedCount, osDur: hms(s.overSpeedSec), hb: s.hbCount, ha: s.haCount, xi: s.xiCount, xiDur: hms(s.xiSec),
          driver: v.driver,
        }
      })
      return { groups: [{ key: 'fleet', label: `All vehicles (${vs.length})`, rows, total: `Fleet Total   ·   ${totalsText(sumTrips(all))}` }] }
    },
  },

  timeSheet: {
    title: 'Time Sheet Report',
    file: 'Time_Sheet_Report',
    desc: 'Each day per vehicle: first ignition on and last ignition off with their places, and the engine-on time.',
    settings: [],
    columns: [
      { key: 'date',     label: 'Date',            width: '9%',  pdf: 8 },
      { key: 'first',    label: 'First Ign. On',   width: '7%',  pdf: 6 },
      { key: 'startLocation', label: 'Start Location', width: '24%', pdf: 23 },
      { key: 'last',     label: 'Last Ign. Off',   width: '7%',  pdf: 6 },
      { key: 'location', label: 'End Location',    width: '24%', pdf: 23, locate: true },
      { key: 'onTime',   label: 'Engine On',       width: '7%',  pdf: 6 },
      { key: 'drive',    label: 'Drive Time',      width: '7%',  pdf: 6 },
      { key: 'trips',    label: 'Trips',           width: '4%',  pdf: 4, align: 'right' },
      { key: 'distance', label: 'Distance (km)',   width: '6%',  pdf: 5, align: 'right' },
    ],
    build(vs) {
      const groups = vs.map(v => {
        const days = byDay(v.trips)
        const rows = days.map(d => {
          const s = sumTrips(d.trips)
          const firstTrip = d.trips[0]
          const lastTrip = d.trips[d.trips.length - 1]
          return {
            key: d.key, lat: lastTrip.endLat, lng: lastTrip.endLng, startLat: firstTrip.startLat, startLng: firstTrip.startLng,
            date: formatDateLabel(d.date), first: formatTime(s.firstStart),
            last: lastTrip.open ? `${formatTime(s.lastStop)} (on)` : formatTime(s.lastStop),
            onTime: hms(s.driveSec + s.idleSec), drive: hms(s.driveSec), trips: s.trips, distance: km(s.distanceKm),
          }
        })
        const s = sumTrips(v.trips)
        return { key: v.deviceId, label: v.vehicleId, rows, total: `Vehicle Total   ·   Days ${days.length}   ·   Engine On ${hms(s.driveSec + s.idleSec)}   ·   Drive ${hms(s.driveSec)}   ·   ${km(s.distanceKm)} km` }
      })
      return { groups }
    },
  },

  privateUsage: {
    title: 'Private Usage Report',
    file: 'Private_Usage_Report',
    desc: 'Every trip marked Business or Private by your working days and hours, with the private share of the distance.',
    settings: ['hideZero', 'workHours'],
    columns: [
      { key: 'start',    label: 'Start',          width: '7%',  pdf: 6 },
      { key: 'stop',     label: 'Stop',           width: '7%',  pdf: 6 },
      { key: 'drive',    label: 'Drive Time',     width: '6%',  pdf: 5 },
      { key: 'distance', label: 'Distance (km)',  width: '6%',  pdf: 5, align: 'right' },
      { key: 'usage',    label: 'Usage',          width: '6%',  pdf: 5 },
      { key: 'driver',   label: 'Driver',         width: '10%', pdf: 9 },
      { key: 'startLocation', label: 'Start Location', width: '29%', pdf: 29 },
      { key: 'location', label: 'Stop Location',  width: '29%', pdf: 29, locate: true },
    ],
    build(vs, ctx) {
      let hidden = 0
      const split = trips => {
        const b = trips.filter(t => tripUsage(t, ctx.rule) === 'Business')
        const p = trips.filter(t => tripUsage(t, ctx.rule) === 'Private')
        const bk = sumTrips(b).distanceKm, pk = sumTrips(p).distanceKm
        const share = bk + pk > 0 ? Math.round((pk / (bk + pk)) * 100) : 0
        return `Business ${km(bk)} km (${b.length})   ·   Private ${km(pk)} km (${p.length})   ·   Private share ${share}%`
      }
      const groups = vs.map(v => {
        const vis = visibleTrips(v.trips, ctx.hideZero)
        hidden += vis.hidden
        const rows = byDay(vis.trips).flatMap(d => [
          band(`d-${d.key}`, formatDateLabel(d.date)),
          ...d.trips.map(t => {
            const usage = tripUsage(t, ctx.rule)
            return {
              key: t.startTs, ...endPoint(t), startLat: t.startLat, startLng: t.startLng,
              start: formatTime(t.startTs), stop: t.open ? `${formatTime(t.endTs)} (on)` : formatTime(t.endTs),
              drive: hms(t.driveSec), distance: km(t.distanceKm), usage, driver: t.driver,
              cellStyle: { usage: USAGE_STYLE[usage] },
            }
          }),
          band(`t-${d.key}`, `Daily Total   ·   ${split(d.trips)}`),
        ])
        return { key: v.deviceId, label: v.vehicleId, rows, total: `Vehicle Total   ·   ${split(vis.trips)}` }
      })
      return { groups, note: hidden ? `${hidden} trip${hidden === 1 ? '' : 's'} of 0 km hidden` : null }
    },
  },

  gyr: {
    title: 'GYR Report',
    file: 'GYR_Report',
    desc: 'A Green / Yellow / Red driving score per vehicle from over speed, harsh braking, harsh acceleration and excess idle per 100 km.',
    settings: ['speed', 'idle', 'gyrBands'],
    columns: [
      { key: 'vehicle',  label: 'Vehicle',          width: '11%', pdf: 10 },
      { key: 'driver',   label: 'Driver',           width: '11%', pdf: 10 },
      { key: 'distance', label: 'Distance (km)',    width: '7%',  pdf: 7, align: 'right' },
      { key: 'drive',    label: 'Drive Time',       width: '7%',  pdf: 7 },
      { key: 'os',       label: 'Over Speed',       width: '6%',  pdf: 6, align: 'right' },
      { key: 'hb',       label: 'Harsh Brake',      width: '6%',  pdf: 6, align: 'right' },
      { key: 'ha',       label: 'Harsh Accel.',     width: '6%',  pdf: 6, align: 'right' },
      { key: 'xi',       label: 'Excess Idle',      width: '6%',  pdf: 6, align: 'right' },
      { key: 'osRate',   label: 'OS /100km (×5)',   width: '7%',  pdf: 7, align: 'right' },
      { key: 'hbRate',   label: 'HB /100km (×4)',   width: '7%',  pdf: 7, align: 'right' },
      { key: 'haRate',   label: 'HA /100km (×3)',   width: '7%',  pdf: 7, align: 'right' },
      { key: 'xiRate',   label: 'XI /100km (×2)',   width: '7%',  pdf: 7, align: 'right' },
      { key: 'score',    label: 'GYR Score',        width: '6%',  pdf: 6, align: 'right' },
      { key: 'rating',   label: 'Rating',           width: '6%',  pdf: 6 },
    ],
    build(vs, ctx) {
      const scores = []
      const rows = vs.map(v => {
        const s = sumTrips(v.trips)
        const g = gyrScore(s, ctx.bands)
        if (g.score !== null) scores.push(g.score)
        const rate = k => (g.rates ? g.rates[k].toFixed(2) : '—')
        return {
          key: v.deviceId, vehicle: v.vehicleId, driver: v.driver, distance: km(s.distanceKm), drive: hms(s.driveSec),
          os: s.overSpeedCount, hb: s.hbCount, ha: s.haCount, xi: s.xiCount,
          osRate: rate('overSpeed'), hbRate: rate('harshBrake'), haRate: rate('harshAccel'), xiRate: rate('excessIdle'),
          score: g.score ?? '—', rating: g.rating,
          cellStyle: { rating: RATING_STYLE[g.rating], score: RATING_STYLE[g.rating] },
        }
      })
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
      const count = r => rows.filter(x => x.rating === r).length
      return {
        groups: [{
          key: 'fleet', label: `All vehicles (${vs.length})`, rows,
          total: `Average Score ${avg ?? '—'}   ·   Green ${count('Green')}   ·   Yellow ${count('Yellow')}   ·   Red ${count('Red')}   ·   Green ≥ ${ctx.bands.green}, Red < ${ctx.bands.red}`,
        }],
      }
    },
  },

  tripDetails: {
    title: 'Trip Details',
    file: 'Trip_Details_Report',
    desc: 'Every trip of each vehicle: driver, start and end, duration, driving and standing time, distance and top speed.',
    settings: ['hideZero'],
    defaults: { hideZero: false },
    groupedBy: 'Asset',
    noAddresses: true,
    columns: [
      { key: 'driver',   label: 'Driver',         width: '22%', pdf: 20 },
      { key: 'start',    label: 'Start',          width: '15%', pdf: 13 },
      { key: 'end',      label: 'End',            width: '15%', pdf: 13 },
      { key: 'duration', label: 'Duration',       width: '8%',  pdf: 7 },
      { key: 'driving',  label: 'Driving',        width: '8%',  pdf: 7 },
      { key: 'standing', label: 'Standing',       width: '8%',  pdf: 7 },
      { key: 'distance', label: 'Distance (Km)',  width: '8%',  pdf: 7, align: 'right' },
      { key: 'speed',    label: 'Speed (Kph)',    width: '8%',  pdf: 7, align: 'right' },
      { key: 'map',      label: 'Map',            width: '5%',  pdf: 4, locate: true },
    ],
    build: (vs, ctx) => ctrackTripGroups(vs, ctx, false),
  },

  tripLocations: {
    title: 'Trips Locations',
    file: 'Trip_Locations_Report',
    desc: 'Every trip of each vehicle with where it started and ended, its duration, driving and standing time, distance and top speed.',
    settings: ['hideZero'],
    defaults: { hideZero: false },
    groupedBy: 'Asset',
    columns: [
      { key: 'driver',        label: 'Driver',          width: '13%', pdf: 12 },
      { key: 'start',         label: 'Start',           width: '9%',  pdf: 8 },
      { key: 'startLocation', label: 'Start Location',  width: '19%', pdf: 18 },
      { key: 'end',           label: 'End',             width: '9%',  pdf: 8 },
      { key: 'location',      label: 'End Location',    width: '19%', pdf: 18, locate: true },
      { key: 'duration',      label: 'Duration',        width: '6.5%', pdf: 6 },
      { key: 'driving',       label: 'Driving',         width: '6.5%', pdf: 6 },
      { key: 'standing',      label: 'Standing',        width: '6.5%', pdf: 6 },
      { key: 'distance',      label: 'Distance (Km)',   width: '5.5%', pdf: 5, align: 'right' },
      { key: 'speed',         label: 'Max Speed (Kph)', width: '6%',  pdf: 5, align: 'right' },
    ],
    build: (vs, ctx) => ctrackTripGroups(vs, ctx, true),
  },

  tripSummary: {
    title: 'Trip Summary',
    file: 'Trip_Summary_Report',
    desc: 'Each day, one line per vehicle and driver: trip duration, driving and standing time, distance, top speed and number of trips.',
    settings: ['hideZero'],
    defaults: { hideZero: false },
    groupedBy: 'Day',
    noAddresses: true,
    columns: [
      { key: 'vehicle',  label: 'Vehicle',         width: '17%', pdf: 15 },
      { key: 'site',     label: 'Site',            width: '11%', pdf: 10 },
      { key: 'driver',   label: 'Driver',          width: '21%', pdf: 19 },
      { key: 'duration', label: 'Duration',        width: '8%',  pdf: 7 },
      { key: 'driving',  label: 'Driving',         width: '8%',  pdf: 7 },
      { key: 'standing', label: 'Standing',        width: '8%',  pdf: 7 },
      { key: 'distance', label: 'Distance (Km)',   width: '9%',  pdf: 8, align: 'right' },
      { key: 'speed',    label: 'Max Speed (Kph)', width: '9%',  pdf: 8, align: 'right' },
      { key: 'trips',    label: 'No. of Trips',    width: '9%',  pdf: 8, align: 'right' },
    ],
    build(vs, ctx) {
      let hidden = 0
      let running = 0
      const all = []
      for (const v of vs) {
        const done = finishedTrips(v.trips)
        running += v.trips.length - done.length
        const vis = visibleTrips(done, ctx.hideZero)
        hidden += vis.hidden
        for (const t of vis.trips) all.push({ ...t, _vehicle: v })
      }
      all.sort((a, b) => a.startTs - b.startTs)
      const line = (key, list, head) => {
        const s = ctrackTotals(list)
        return {
          key, ...head, duration: hms(s.durationSec), driving: hms(s.driveSec), standing: hms(s.standSec),
          distance: km3(s.distanceKm), speed: maxOrNA(s.maxSpeed), trips: s.trips,
        }
      }
      const groups = byDay(all).map(d => {
        const pairs = new Map()
        for (const t of d.trips) {
          const k = `${t._vehicle.vehicleId}\u0000${t.driver}`
          if (!pairs.has(k)) pairs.set(k, [])
          pairs.get(k).push(t)
        }
        const rows = [...pairs.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, list]) => line(k, list, { vehicle: list[0]._vehicle.vehicleId, site: ctx.siteOf(list[0]._vehicle), driver: list[0].driver }))
        const label = ctrackDate(d.date)
        rows.push({ ...line(`sum-${d.key}`, d.trips, { vehicle: `${label} Summary`, site: '', driver: '' }), strong: true })
        return { key: d.key, label: `Day : ${label}`, rows, total: false }
      })
      const zeroNote = hidden ? `${hidden} trip${hidden === 1 ? '' : 's'} of 0 km hidden` : null
      return { groups, summary: reportSummary(all), note: joinNotes(zeroNote, inProgressNote(running)) }
    },
  },

  distanceDriven: {
    title: 'Distance Driven',
    file: 'Distance_Driven_Report',
    desc: 'Distance driven each day, per driver or per vehicle, with the daily totals and the average per vehicle on graphs.',
    settings: ['entity'],
    groupedBy: 'Day',
    noAddresses: true,
    columns: [
      { key: 'date',     label: 'Date',           width: '20%', pdf: 18 },
      { key: 'entity',   label: 'Driver',         width: '60%', pdf: 55 },
      { key: 'distance', label: 'Distance (km)',  width: '20%', pdf: 18, align: 'right' },
    ],
    build(vs, ctx) {
      const all = []
      for (const v of vs) for (const t of v.trips) all.push({ ...t, _vehicle: v })
      all.sort((a, b) => a.startTs - b.startTs)
      const nameOf = t => (ctx.entity === 'asset' ? t._vehicle.vehicleId : t.driver)
      const entities = new Set()
      const rows = []
      const chart = []
      let total = 0
      for (const d of byDay(all)) {
        const per = new Map()
        for (const t of d.trips) per.set(nameOf(t), (per.get(nameOf(t)) ?? 0) + (t.distanceKm || 0))
        const date = ctrackDate(d.date)
        let dayKm = 0
        for (const [name, dist] of [...per.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          if (dist < 0.0005) continue // Ctrack lists only who moved
          entities.add(name)
          dayKm += dist
          rows.push({ key: `${d.key}-${name}`, date, entity: name, distance: km3(dist) })
        }
        total += dayKm
        // The average is over every vehicle that made a trip that day (client's sample).
        const assets = new Set(d.trips.map(t => t._vehicle.deviceId)).size
        chart.push({ day: date.slice(0, 6), total: Math.round(dayKm * 10) / 10, avg: assets ? Math.round((dayKm / assets) * 10) / 10 : 0 })
      }
      if (rows.length) rows.push({ key: 'total', date: 'Total', entity: `Entity Count: ${entities.size}`, distance: Math.round(total), strong: true })
      return {
        groups: [{ key: 'all', label: `Grouped by Day · ${ctx.entity === 'asset' ? 'Asset' : 'Driver'}`, rows, total: false }],
        summary: rows.length ? [{ label: 'Total Distance (Km)', value: km3(total) }] : [],
        chart,
      }
    },
  },
}

/**
 * A trip's track from the messages the report already loaded: every valid fix
 * from its start to its end, with the trip's own start and end points at the
 * two ends so the pins sit where the table says.
 */
function routePoints(byDevice, route) {
  const msgs = byDevice?.get?.(route.deviceId)?.messages ?? []
  const pts = []
  for (const m of msgs) {
    if (m.timestamp < route.startTs || m.timestamp > route.endTs) continue
    const lat = m['position.latitude'], lng = m['position.longitude']
    if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0) || m['position.valid'] === false) continue
    const last = pts[pts.length - 1]
    if (!last || last[0] !== lat || last[1] !== lng) pts.push([lat, lng])
  }
  const same = (a, lat, lng) => a && a[0] === lat && a[1] === lng
  if (route.startLat != null && route.startLng != null && !same(pts[0], route.startLat, route.startLng)) pts.unshift([route.startLat, route.startLng])
  if (route.endLat != null && route.endLng != null && !same(pts[pts.length - 1], route.endLat, route.endLng)) pts.push([route.endLat, route.endLng])
  return pts
}

const coords = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—')

// A new variant starts fresh: the routes share this component, so without the
// key a switch from one report to another kept the old one's settings.
export default function UsageReportPage(props) {
  return <UsageReport key={props.variant} {...props} />
}

function UsageReport({ variant, ...props }) {
  const V = VARIANTS[variant]
  const title = useReportTitle(V.title)
  const [entity, setEntity] = useState('driver')
  const file = title === V.title ? V.file : fileNameOf(title)
  const [hiddenCols, setHiddenCols] = useHiddenColumns(`usage-${variant}`)
  const columns = useMemo(
    () => V.columns.map(c => (c.key === 'entity' && entity === 'asset' ? { ...c, label: 'Asset' } : c)),
    [V, entity]
  )
  const shownCols = useVisibleColumns(columns, hiddenCols)
  const { data } = useFlespiData()
  // The live feed hands over a new vehicle array on every poll. The report only
  // cares which vehicles there are and what they are called, so it keys on that:
  // otherwise each poll rebuilt the report and restarted the address lookup
  // before it could finish.
  const liveVehicles = data?.vehicles ?? []
  const vehiclesKey = liveVehicles.map(v => `${v.id}:${v.master?.plateNo || v.name}:${v.ident}`).sort().join('|')
  const vehicles = useMemo(
    () => liveVehicles.slice().sort((a, b) => (a.master?.plateNo || a.name).localeCompare(b.master?.plateNo || b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehiclesKey]
  )

  const now = useRef(new Date()).current
  const [selectedIds, setSelectedIds] = useState(null) // null = all
  const [preset, setPreset] = useState('today')
  const [fromDate, setFromDate] = useState(() => dateStr(startOfDay(now)))
  const [toDate, setToDate] = useState(() => dateStr(now))
  const [fromTime, setFromTime] = useState('00:00')
  const [toTime, setToTime] = useState(() => timeStr(now))

  const [overSpeedKmh, setOverSpeedKmh] = useState(String(DEFAULT_USAGE_OPTS.overSpeedKmh))
  const [xiMinutes, setXiMinutes] = useState(String(DEFAULT_USAGE_OPTS.xiMinutes))
  const [hideZero, setHideZero] = useState(V.defaults?.hideZero ?? true)
  const registered = useRegisteredVehicles()
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5])
  const [workFrom, setWorkFrom] = useState('08:00')
  const [workTo, setWorkTo] = useState('18:00')
  const [green, setGreen] = useState('80')
  const [red, setRed] = useState('60')

  const [raw, setRaw] = useState(null)        // { byDevice, applied }
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [geoTick, setGeoTick] = useState(0)
  const [geoProgress, setGeoProgress] = useState(null) // { done, total } while addresses load
  const [located, setLocated] = useState(null)
  const closeLocated = useCallback(() => setLocated(null), [])
  const [tripRoute, setTripRoute] = useState(null)
  const closeTripRoute = useCallback(() => setTripRoute(null), [])
  const abortRef = useRef(null)
  const busy = progress !== null

  const effectiveIds = selectedIds ?? vehicles.map(v => v.id)
  const allSelected = selectedIds === null || (vehicles.length > 0 && selectedIds.length === vehicles.length)
  const fromTs = useMemo(() => Math.floor(new Date(`${fromDate}T${fromTime}:00`).getTime() / 1000), [fromDate, fromTime])
  const toTs = useMemo(() => Math.floor(new Date(`${toDate}T${toTime}:59`).getTime() / 1000), [toDate, toTime])
  const rangeValid = Number.isFinite(fromTs) && Number.isFinite(toTs) && fromTs < toTs
  const rangeTooLong = rangeValid && (toTs - fromTs) / 86400 > MAX_RANGE_DAYS

  const vehicleName = v => v.master?.plateNo || v.name
  const selectionLabel = allSelected
    ? `All (${vehicles.length})`
    : effectiveIds.length === 0 ? 'Select vehicles'
      : effectiveIds.length === 1 ? (vehicleName(vehicles.find(v => v.id === effectiveIds[0]) ?? {}) || '1 vehicle')
        : `${effectiveIds.length} vehicles`

  const applyPreset = key => {
    setPreset(key)
    const range = presetRange(key)
    if (!range) return
    setFromDate(dateStr(range.from))
    setToDate(dateStr(range.to))
    setFromTime('00:00')
    setToTime(range.toEndOfDay ? '23:59' : timeStr(range.to))
  }
  const toggleVehicle = id => {
    const current = selectedIds ?? vehicles.map(v => v.id)
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    setSelectedIds(next.length === vehicles.length ? null : next)
  }

  const generate = useCallback(async () => {
    if (!rangeValid || rangeTooLong || effectiveIds.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setRaw(null)
    setProgress({ text: 'Generating report...' })
    try {
      const byDevice = await fetchMovementMessages(effectiveIds, fromTs, toTs, {
        signal: controller.signal,
        onProgress: p => setProgress({ text: p.text }),
      })
      if (controller.signal.aborted) return
      setRaw({ byDevice, applied: { fromTs, toTs, selectionLabel, printDate: formatPrintDate() } })
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [rangeValid, rangeTooLong, effectiveIds, fromTs, toTs, selectionLabel])

  const cancel = () => abortRef.current?.abort()

  const speedNum = Math.min(300, Math.max(10, Number(overSpeedKmh) || DEFAULT_USAGE_OPTS.overSpeedKmh))
  const idleNum = Math.min(240, Math.max(1, Number(xiMinutes) || DEFAULT_USAGE_OPTS.xiMinutes))
  const bands = { green: Number(green) || 80, red: Number(red) || 60 }
  const rule = { days: workDays, from: workFrom || '08:00', to: workTo || '18:00' }

  // Trips depend on the speed limit and idle minutes; the grouping on the rest.
  const vehicleTrips = useMemo(() => {
    if (!raw) return null
    return tripsByVehicle(raw.byDevice, vehicles, { overSpeedKmh: speedNum, xiMinutes: idleNum, tzOffsetSec: -new Date().getTimezoneOffset() * 60 })
      .map(v => {
        const assigned = driverNameForDevice({ ...v.vehicle, ibutton: null }) || '—'
        // Each trip's driver is the iButton tag read during it; the assigned driver otherwise.
        // The Driver ID always shows with a card read during the trip, and a card
        // nobody holds is an "Unregistered Driver" (client, 2026-11-09).
        const tagLabel = code => {
          const key = ibuttonKey(code)
          if (!key) return ''
          const d = driverForIbutton(key)
          return d ? `${d.name} · ID ${key}` : `Unregistered Driver · ID ${key}`
        }
        const trips = v.trips.map(t => ({ ...t, driver: tagLabel(t.ibutton) || assigned }))
        const names = [...new Set(trips.map(t => t.driver))]
        return { ...v, trips, driver: names.length === 1 ? names[0] : names.length ? names.join(', ') : assigned }
      })
  }, [raw, vehicles, speedNum, idleNum])

  const built = useMemo(() => {
    if (!vehicleTrips) return null
    // Site: the vehicle's branch in Settings, blank without one (as in the client's sample).
    const regByImei = new Map((registered ?? []).map(r => [imeiKey(r.imei), r]))
    const siteOf = v => {
      const reg = regByImei.get(imeiKey(v.vehicle?.ident))
      return reg?.branchId ? branchNameFor(reg.branchId) : ''
    }
    return V.build(vehicleTrips, { hideZero, rule, bands, entity, siteOf })
  // rule / bands are rebuilt each render from their own state, listed below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleTrips, V, hideZero, workDays, workFrom, workTo, green, red, entity, registered])

  useEffect(() => {
    // Trip Details / Summary / Distance Driven show no address: nothing to look up.
    if (!built || V.noAddresses) return
    const controller = new AbortController()
    resolveRowLocations(built.groups, {
      limit: IS_REAL ? 2000 : 200,
      signal: controller.signal,
      onChunk: (done, total) => {
        if (controller.signal.aborted) return
        setGeoTick(t => t + 1)
        setGeoProgress(done < total ? { done, total } : null)
      },
    })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setGeoProgress(null) })
    return () => controller.abort()
  }, [built, V.noAddresses])

  const groups = useMemo(() => {
    if (!built) return []
    return built.groups.map(g => ({
      ...g,
      rows: g.rows.map(r => {
        if (r.kind === 'band') return r
        const location = r.locationText || coords(r.lat, r.lng)
        return {
          ...r,
          location,
          startLocation: r.startLocationText || coords(r.startLat, r.startLng),
          mapUrl: r.lat != null ? locationUrl({ lat: r.lat, lng: r.lng, vehicle: g.label, address: location }) : undefined,
        }
      }),
    }))
  // geoTick: resolveRowLocations fills the address text in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, geoTick])

  const applied = raw?.applied
  const filters = applied ? [
    ['Selection', applied.selectionLabel],
    ...(V.groupedBy ? [['Grouped By', V.groupedBy]] : []),
    ...(V.settings.includes('entity') ? [['Entity Grouping', entity === 'asset' ? 'Asset' : 'Driver']] : []),
    ['From Date', formatDateTime(applied.fromTs)],
    ['To Date', formatDateTime(applied.toTs)],
    ...(V.settings.includes('speed') ? [['Over Speed', `> ${speedNum} km/h`]] : []),
    ...(V.settings.includes('idle') ? [['Excess Idle', `≥ ${idleNum} min`]] : []),
    ...(V.settings.includes('hideZero') ? [['0 km trips', hideZero ? 'Hidden' : 'Shown']] : []),
    ...(V.settings.includes('workHours') ? [['Working Hours', `${workDays.map(d => WEEKDAYS[d]).join(', ') || 'None'} ${rule.from}–${rule.to}`]] : []),
  ] : []

  const dataRows = groups.reduce((n, g) => n + g.rows.filter(r => r.kind !== 'band').length, 0)

  const exportOpts = () => ({
    title,
    subtitle: 'FleetmaxX',
    filtersText: filters.map(([k, v]) => `${k}: ${v}`).join('     '),
    printDate: applied?.printDate,
    systemName: 'FleetmaxX',
    reportSummary: built?.summary ?? [],
    tables: groups.map(g => ({
      heading: g.total === false ? g.label : `${g.label} — ${g.total}`,
      columns: shownCols.map(c => ({ key: c.key, label: c.label, width: c.pdf, align: c.align, hrefKey: c.locate ? 'mapUrl' : undefined })),
      rows: g.rows, // date/total bands print as the Movement PDF's yellow bands
    })),
  })

  const truncated = raw && [...raw.byDevice.values()].some(e => e?.truncated)

  return (
    <ReportFrame title={title} desc={V.desc} {...props}>
      <div className="report-screen-only" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESETS.map(p => <Chip key={p.key} active={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</Chip>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <MultiSelect label="VEHICLES" summary={selectionLabel} disabled={vehicles.length === 0}>
            <CheckRow checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : null)}><strong>All vehicles</strong></CheckRow>
            <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 2px' }} />
            {vehicles.map(v => (
              <CheckRow key={v.id} checked={effectiveIds.includes(v.id)} onChange={() => toggleVehicle(v.id)}
                note={v.master?.plateNo && v.master.plateNo !== v.name ? v.name : null}>
                {vehicleName(v)}
              </CheckRow>
            ))}
          </MultiSelect>
          <div>
            <label style={LABEL}>FROM DATE</label>
            <input type="date" style={FIELD} value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>FROM TIME</label>
            <input type="time" style={FIELD} value={fromTime} onChange={e => { setFromTime(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO DATE</label>
            <input type="date" style={FIELD} value={toDate} onChange={e => { setToDate(e.target.value); setPreset('custom') }} />
          </div>
          <div>
            <label style={LABEL}>TO TIME</label>
            <input type="time" style={FIELD} value={toTime} onChange={e => { setToTime(e.target.value); setPreset('custom') }} />
          </div>
          {V.settings.includes('speed') && (
            <div>
              <label style={LABEL}>OVER SPEED ABOVE (KM/H)</label>
              <input type="number" min="10" max="300" style={FIELD} value={overSpeedKmh} onChange={e => setOverSpeedKmh(e.target.value)} />
            </div>
          )}
          {V.settings.includes('idle') && (
            <div>
              <label style={LABEL}>EXCESS IDLE AFTER (MIN)</label>
              <input type="number" min="1" max="240" style={FIELD} value={xiMinutes} onChange={e => setXiMinutes(e.target.value)} />
            </div>
          )}
          {V.settings.includes('workHours') && (
            <>
              <div>
                <label style={LABEL}>WORK STARTS</label>
                <input type="time" style={FIELD} value={workFrom} onChange={e => setWorkFrom(e.target.value)} />
              </div>
              <div>
                <label style={LABEL}>WORK ENDS</label>
                <input type="time" style={FIELD} value={workTo} onChange={e => setWorkTo(e.target.value)} />
              </div>
            </>
          )}
          {V.settings.includes('entity') && (
            <div>
              <label style={LABEL}>ENTITY GROUPING</label>
              <select style={FIELD} value={entity} onChange={e => setEntity(e.target.value)}>
                <option value="driver">Driver</option>
                <option value="asset">Asset</option>
              </select>
            </div>
          )}
          {V.settings.includes('gyrBands') && (
            <>
              <div>
                <label style={LABEL}>GREEN AT SCORE ≥</label>
                <input type="number" min="1" max="100" style={FIELD} value={green} onChange={e => setGreen(e.target.value)} />
              </div>
              <div>
                <label style={LABEL}>RED BELOW SCORE</label>
                <input type="number" min="1" max="100" style={FIELD} value={red} onChange={e => setRed(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {V.settings.includes('hideZero') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--c-text2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} style={{ accentColor: 'var(--ft-accent)', width: 15, height: 15 }} />
                Skip trips of 0 km
              </label>
            )}
            {V.settings.includes('workHours') && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...LABEL, marginBottom: 0, marginRight: 4 }}>WORKING DAYS</span>
                {[1, 2, 3, 4, 5, 6, 0].map(d => (
                  <Chip key={d} active={workDays.includes(d)} onClick={() => setWorkDays(w => (w.includes(d) ? w.filter(x => x !== d) : [...w, d]))}>
                    {WEEKDAYS[d]}
                  </Chip>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {rangeTooLong && <span style={{ fontSize: 11.5, color: '#ef4444' }}>Choose {MAX_RANGE_DAYS} days or fewer.</span>}
            {busy && <ToolbarButton onClick={cancel} icon={X}>Cancel</ToolbarButton>}
            <button
              type="button"
              onClick={generate}
              disabled={busy || !rangeValid || rangeTooLong || effectiveIds.length === 0}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: busy || !rangeValid || rangeTooLong ? 'color-mix(in srgb, var(--ft-accent) 45%, #fff)' : 'var(--ft-accent)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || !rangeValid || rangeTooLong ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? progress.text : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="report-screen-only" style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#ef4444', display: 'flex', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {built && (
        <>
          <div className="report-screen-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>
              <strong style={{ color: 'var(--c-text1)' }}>{dataRows.toLocaleString()}</strong> row{dataRows === 1 ? '' : 's'}
              {' · '}{vehicleTrips.length} vehicle{vehicleTrips.length === 1 ? '' : 's'}
              {built.note && <span style={{ color: 'var(--c-text3)' }}> · {built.note}</span>}
              {geoProgress && <span style={{ color: 'var(--ft-accent)' }}> · Resolving addresses {geoProgress.done}/{geoProgress.total}…</span>}
              {truncated && <span style={{ color: '#f97316' }}> · some days hit the message limit — narrow the range for full detail</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <ColumnPicker columns={columns} hidden={hiddenCols} onChange={setHiddenCols} />
              <ToolbarButton onClick={() => exportGeoZonePdf(exportOpts(), file)} icon={FileDown} primary disabled={!dataRows}>Download PDF</ToolbarButton>
              <ToolbarButton onClick={() => exportGeoZoneExcel(exportOpts(), file)} icon={FileSpreadsheet} disabled={!dataRows}>Download Excel</ToolbarButton>
              <ToolbarButton onClick={() => window.print()} icon={Printer} disabled={!dataRows}>Print</ToolbarButton>
            </div>
          </div>

          <PaperTable
            title={title}
            company="FleetmaxX"
            filters={filters}
            columns={shownCols}
            groups={groups}
            printDate={applied.printDate}
            onLocate={r => (r.route
              ? setTripRoute({ ...r.route, driver: r.driver, distance: km(r.route.distanceKm), points: routePoints(raw?.byDevice, r.route) })
              : setLocated({ lat: r.lat, lng: r.lng, ts: r.key, vehicleId: r.vehicle, status: title, location: r.location }))}
            emptyText="No trips in this period for the selected vehicles."
            summary={built.summary}
          />
          {built.chart?.length > 0 && <DistanceDrivenCharts data={built.chart} />}
        </>
      )}

      <LocationMapModal point={located} onClose={closeLocated} />
      <TripRouteModal trip={tripRoute} onClose={closeTripRoute} />
    </ReportFrame>
  )
}
