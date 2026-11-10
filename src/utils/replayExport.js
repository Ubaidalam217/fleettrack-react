// Live Map replay export: Excel, KML (Google Earth) and GPX.
//
// Exports exactly what the replay is showing — the selected trip, or the whole
// loaded range when no trip is picked. Nothing is fetched: the points are the
// ones already on the map. The pure builders live in replayTrips.js (tested);
// this file only turns them into downloads, in the report exports' house style
// (band-blue header row, size-9 cells, lazy exceljs).
import { download } from './reportExport'
import {
  buildKml, buildGpx, exportFileName, fmtDateTime, fmtHms, ignitionText, tripNoByIndex,
} from './replayTrips'
import { statusLabel } from './vehicleStatus'
import { shortenAddress, geocodeKey } from './geocode'

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB0C4DE' } }

/**
 * @typedef {object} ReplayExport
 * @property {string}   vehicle    display name (plate number)
 * @property {object[]} points     the points to export — a trip's, or the whole range
 * @property {object[]} trips      every trip of the loaded range (tripsFromPoints)
 * @property {object}   [trip]     the selected trip; omitted = whole range
 * @property {Map}      [places]   useTripPlaces' answer, for place names
 */

function titleOf({ vehicle, trip }) {
  return trip ? `${vehicle} — Trip ${trip.no}` : `${vehicle} — Replay`
}

function spanOf(points, trip) {
  const from = trip ? trip.startTs : points.find(p => Number.isFinite(p.ts))?.ts
  let to = trip ? trip.endTs : null
  for (let i = points.length - 1; to == null && i >= 0; i--) if (Number.isFinite(points[i].ts)) to = points[i].ts
  return from != null && to != null ? `${fmtDateTime(from)} → ${fmtDateTime(to)}` : ''
}

const placeText = (places, lat, lng) => {
  const p = places && lat != null && lng != null ? places.get(geocodeKey(lat, lng)) : null
  return p ? shortenAddress(p, 4) : ''
}

function endpointLabels(opts) {
  const { points, trip, places } = opts
  const first = trip ? { lat: trip.startLat, lng: trip.startLng } : points[0]
  const last = trip ? { lat: trip.endLat, lng: trip.endLng } : points[points.length - 1]
  return {
    startLabel: first ? placeText(places, first.lat, first.lng) : '',
    endLabel: last ? placeText(places, last.lat, last.lng) : '',
  }
}

function description(opts) {
  const { trip } = opts
  const span = spanOf(opts.points, trip)
  if (!trip) return span
  return `${span} · ${fmtHms(trip.durationSec)} · ${trip.distanceKm.toFixed(2)} km · max ${Math.round(trip.maxSpeed)} km/h`
}

/** @param {ReplayExport} opts */
export function exportReplayKml(opts) {
  const kml = buildKml(opts.points, { title: titleOf(opts), description: description(opts), ...endpointLabels(opts) })
  download(
    new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }),
    exportFileName(opts.vehicle, opts.points, opts.trip, 'kml')
  )
}

/** @param {ReplayExport} opts */
export function exportReplayGpx(opts) {
  const gpx = buildGpx(opts.points, { title: titleOf(opts), description: description(opts), ...endpointLabels(opts) })
  download(
    new Blob([gpx], { type: 'application/gpx+xml' }),
    exportFileName(opts.vehicle, opts.points, opts.trip, 'gpx')
  )
}

const POINT_COLUMNS = [
  { header: '#', width: 7 },
  { header: 'Date / Time', width: 22 },
  { header: 'Trip', width: 6 },
  { header: 'Speed (km/h)', width: 12 },
  { header: 'Status', width: 11 },
  { header: 'Ignition', width: 9 },
  { header: 'Heading (°)', width: 11 },
  { header: 'Latitude', width: 12 },
  { header: 'Longitude', width: 12 },
]

const TRIP_COLUMNS = [
  { header: 'Trip', width: 6 },
  { header: 'Start Time', width: 22 },
  { header: 'End Time', width: 22 },
  { header: 'Duration', width: 10 },
  { header: 'Drive Time', width: 10 },
  { header: 'Idle Time', width: 10 },
  { header: 'Distance (km)', width: 13 },
  { header: 'Max Speed (km/h)', width: 15 },
  { header: 'Start Location', width: 40 },
  { header: 'End Location', width: 40 },
  { header: 'Start Position', width: 22 },
  { header: 'End Position', width: 22 },
]

const pos = (lat, lng) => (lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '')

/** Title, subtitle, blank, header — the top of both sheets. Returns the header row's number. */
function sheetTop(ws, title, subtitle, columns) {
  ws.columns = columns.map(c => ({ width: c.width }))
  ws.addRow([title]).getCell(1).font = { bold: true, size: 14 }
  ws.addRow([subtitle]).getCell(1).font = { size: 9 }
  ws.addRow([])
  const header = ws.addRow(columns.map(c => c.header))
  header.eachCell(cell => { cell.fill = HEADER_FILL; cell.font = { bold: true, size: 9 } })
  return header.number
}

/**
 * One row per point, plus a Trips sheet: every trip of the range for a range
 * export, the one trip for a trip export.
 *
 * @param {ReplayExport} opts
 */
export async function exportReplayExcel(opts) {
  const { vehicle, points, trips = [], trip, places } = opts
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FleetmaxX'

  const title = titleOf(opts)
  const subtitle = spanOf(points, trip)

  // ── Points ──
  const ws = wb.addWorksheet('Points')
  const headerRow = sheetTop(ws, title, subtitle, POINT_COLUMNS)
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
  // A range export marks which trip each point belongs to; a trip export is one trip.
  const tripOf = trip ? () => trip.no : (byIndex => i => byIndex.get(i) ?? '')(tripNoByIndex(trips))
  points.forEach((p, i) => {
    const r = ws.addRow([
      i + 1,
      fmtDateTime(p.ts),
      tripOf(i),
      Number.isFinite(p.speed) ? p.speed : 0,
      statusLabel(p.status),
      ignitionText(p.ignition),
      Number.isFinite(p.heading) ? Math.round(p.heading) : '',
      Number.isFinite(p.lat) ? Number(p.lat.toFixed(6)) : '',
      Number.isFinite(p.lng) ? Number(p.lng.toFixed(6)) : '',
    ])
    r.font = { size: 9 }
  })

  // ── Trips ──
  const shown = trip ? [trip] : trips
  const tws = wb.addWorksheet('Trips')
  const tripHeader = sheetTop(tws, title, subtitle, TRIP_COLUMNS)
  tws.views = [{ state: 'frozen', ySplit: tripHeader }]
  if (!shown.length) {
    tws.addRow(['No trips in this range — the ignition never came on.']).font = { size: 9, italic: true }
  }
  let km = 0, dur = 0, drive = 0, idle = 0, max = 0
  for (const t of shown) {
    km += t.distanceKm; dur += t.durationSec; drive += t.driveSec; idle += t.idleSec
    if (t.maxSpeed > max) max = t.maxSpeed
    const r = tws.addRow([
      t.no,
      fmtDateTime(t.startTs),
      t.open ? `${fmtDateTime(t.endTs)} (still on)` : fmtDateTime(t.endTs),
      fmtHms(t.durationSec),
      fmtHms(t.driveSec),
      fmtHms(t.idleSec),
      Number(t.distanceKm.toFixed(2)),
      Math.round(t.maxSpeed),
      placeText(places, t.startLat, t.startLng),
      placeText(places, t.endLat, t.endLng),
      pos(t.startLat, t.startLng),
      pos(t.endLat, t.endLng),
    ])
    r.font = { size: 9 }
  }
  if (shown.length > 1) {
    const total = tws.addRow(['Total', '', '', fmtHms(dur), fmtHms(drive), fmtHms(idle), Number(km.toFixed(2)), Math.round(max)])
    total.font = { bold: true, size: 9 }
  }

  const buffer = await wb.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    exportFileName(vehicle, points, trip, 'xlsx')
  )
}
