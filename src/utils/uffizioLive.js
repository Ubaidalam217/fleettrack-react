/**
 * Uffizio vehicles on the Live Map (client, 2026-11-25: "import these
 * vehicles to FleetmaxX and show ALL data here"). Pure: no React, no fetch.
 *
 * Al Jaber Leasing's fuel vehicles report only to the client's Uffizio
 * system. The server polls it about every 2 minutes (server/src/lib/uffizio.js)
 * and serves the latest row per vehicle at GET /api/live/uffizio. This file
 * turns those rows into the SAME shape the Flespi live store hands every
 * consumer (hooks/useFlespiMQTT.js), so markers, cards, the list, search,
 * filters, the tree and the status counts work on them unchanged.
 *
 * Their id is a string `uffizio:<vehicleId>`, never a number, so nothing can
 * mistake one for a Flespi device id. Code that talks to Flespi per device
 * checks isUffizioId() and either reads our own copy (utils/replay.js reads
 * GET /api/live/uffizio/:id/messages, in Flespi's message shape) or says the
 * feature is not available for this vehicle.
 */

export const UFFIZIO_ID_PREFIX = 'uffizio:'
export const UFFIZIO_SOURCE = 'UFFIZIO'
/** How the card says where the data comes from. */
export const UFFIZIO_NOTE = 'Source: Uffizio, updated every ~2 min'

export const isUffizioId = id => typeof id === 'string' && id.startsWith(UFFIZIO_ID_PREFIX)
export const isUffizioVehicle = v => !!v && (v.source === UFFIZIO_SOURCE || isUffizioId(v.id))
/** The register vehicle id inside a live id. */
export const uffizioVehicleId = id => (isUffizioId(id) ? id.slice(UFFIZIO_ID_PREFIX.length) : null)

const fin = v => typeof v === 'number' && Number.isFinite(v)
const KNOWN_TYPES = new Set(['car', 'truck', 'bus', 'bike', 'machine'])

/** Uffizio's "Vehicletype" → the Live Map's marker type ('' when unknown). */
export function markerType(t) {
  const s = String(t ?? '').trim().toLowerCase()
  if (KNOWN_TYPES.has(s)) return s
  if (/truck|lorry|tanker|trailer|tipper/.test(s)) return 'truck'
  if (/bus|coach/.test(s)) return 'bus'
  if (/car|sedan|suv|pick ?up|van/.test(s)) return 'car'
  return ''
}

/**
 * The Live Map's status, the same rule as the Flespi store (useFlespiMQTT
 * vehicleStatus): no reading for 24 h = Inactive; ignition on + moving =
 * Running; on + still = Idle; off = Stopped. When Uffizio sends no ignition,
 * its own Status (RUNNING / IDLING / STOPPED / INACTIVE) is used.
 */
export function liveStatus({ lastTs, ignition, speed, uffizioStatus }, nowSec = Date.now() / 1000) {
  if (lastTs == null) return 'NoData'
  if (nowSec - lastTs > 86400) return 'Inactive'
  if (ignition === true && (speed ?? 0) > 0) return 'Running'
  if (ignition === true) return 'Idle'
  if (ignition === false) return 'Stopped'
  const s = String(uffizioStatus ?? '').toUpperCase()
  if (/RUN|MOVING|DRIV/.test(s)) return 'Running'
  if (/IDL/.test(s)) return 'Idle'
  if (/STOP|PARK/.test(s)) return 'Stopped'
  if (/INACTIVE|OFFLINE|NO ?DATA/.test(s)) return 'Inactive'
  return 'NoData'
}

/** Litres when calibrated (and in range), else null. */
export const fuelLitresOf = f => (f && f.calibrated && fin(f.litres) ? f.litres : null)

/**
 * One GET /api/live/uffizio row → a live-store vehicle.
 * @param {object} row
 * @param {object} baseMaster  services/vehicleMaster.js normalizeMaster(null): the empty master
 * @param {number} [nowSec]
 */
export function uffizioToLive(row, baseMaster, nowSec) {
  const base = baseMaster ?? { plateNo: '', fleetNo: '', vehicleType: '', driver: {}, sensors: {} }
  const lastTs = fin(row?.ts) ? row.ts : null
  const ignition = typeof row?.ign === 'boolean' ? row.ign : null
  const speed = fin(row?.speed) ? row.speed : null
  const litres = fuelLitresOf(row?.fuel)
  const v = {
    id: row.id,
    source: UFFIZIO_SOURCE,
    vehicleId: row.vehicleId,
    name: row.imei || row.id,
    ident: row.imei ?? '',
    master: {
      ...base,
      vehicleType: markerType(row.vehicleType) || base.vehicleType || '',
      driver: { ...(base.driver ?? {}), name: row.driverName || base.driver?.name || '' },
    },
    speed,
    lat: fin(row?.lat) ? row.lat : null,
    lng: fin(row?.lng) ? row.lng : null,
    heading: fin(row?.heading) ? row.heading : null,
    ignition,
    lastTs,
    // The Sensors / card fields the Flespi store also carries.
    fuelLevel: litres,
    temperature: fin(row?.temperature) ? row.temperature : null,
    temperatureLast: fin(row?.temperature) ? row.temperature : null,
    temperatureLastTs: fin(row?.temperature) ? lastTs : null,
    ibutton: row?.driverTag ?? null,
    ibuttonTs: row?.driverTag ? lastTs : null,
    // Uffizio's own extras, for the card and the panel.
    uffizio: {
      status: row?.status ?? null,
      odometerKm: fin(row?.odometerKm) ? row.odometerKm : null,
      driverName: row?.driverName ?? null,
      driverTag: row?.driverTag ?? null,
      externalVolt: fin(row?.externalVolt) ? row.externalVolt : null,
      batteryPct: fin(row?.batteryPct) ? row.batteryPct : null,
      sos: typeof row?.sos === 'boolean' ? row.sos : null,
      power: typeof row?.power === 'boolean' ? row.power : null,
      satellites: fin(row?.satellites) ? row.satellites : null,
      location: row?.location ?? null,
      vehicleType: row?.vehicleType ?? null,
      fuel: row?.fuel ?? null,
      raw: row?.raw ?? null,
      updatedAt: row?.updatedAt ?? null,
    },
  }
  v.status = liveStatus({ lastTs, ignition, speed, uffizioStatus: row?.status }, nowSec)
  return v
}

/**
 * The Flespi vehicles followed by the Uffizio ones. A Flespi device that
 * carries the same IMEI wins (it should never happen: the feed refuses such
 * an IMEI), so a vehicle never shows twice.
 */
export function mergeLive(flespi, uffizio) {
  if (!uffizio?.length) return flespi
  const idents = new Set((flespi ?? []).map(v => String(v.ident ?? '').replace(/\D/g, '')).filter(Boolean))
  const extra = uffizio.filter(v => !idents.has(String(v.ident ?? '').replace(/\D/g, '')))
  return extra.length ? [...(flespi ?? []), ...extra] : flespi
}

/** Only the Flespi vehicles (reports, engines and anything that reads Flespi telemetry). */
export const withoutUffizio = list => (list ?? []).filter(v => !isUffizioVehicle(v))

/** "245.6 L" / "raw 3796" / null — the card's fuel line. */
export function fuelText(f) {
  if (!f) return null
  const l = fuelLitresOf(f)
  if (l !== null) return `${l.toFixed(1)} L${fin(f.tankCapacityL) && f.tankCapacityL > 0 ? ` of ${Math.round(f.tankCapacityL)} L` : ''}`
  if (f.calibrated && f.flag === 'out_of_range') return `Out of range (raw ${f.raw})`
  return fin(f.raw) ? `Raw ${f.raw} (not calibrated)` : null
}
