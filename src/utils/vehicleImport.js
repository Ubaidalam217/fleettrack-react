/**
 * Bulk upload of vehicles from the client's "Master Data" sheet (Uffizio
 * template, client 2026-11-24): "existing 15-20 vehicles: we download the data
 * from the other system and upload it here". One vehicle per row, checked row by
 * row before anything is saved.
 *
 * Pure, with `.js` imports only: the browser (preview, before upload) and the
 * server (POST /api/vehicles/import, which re-checks every row itself) run the
 * SAME rules from this file.
 *
 * Where each column goes:
 *   Vehicle Name*  → Fleet No        Plate Number → Plate Number
 *   Object Model   → Model           Sim Card Number → SIM / Mobile No
 *   IMEI Number*   → IMEI            Odometer → the odometer correction (never a raw write)
 *   Everything else (secondary SIM, category, axles, dates, chassis, engine,
 *   seats, tracker id / serial, colour, registry, satellite IMEI, engine-hour
 *   source, EIDs) → the vehicle's custom fields, so nothing is dropped.
 *   Elock Unlock Password is a secret: it is NOT stored (custom fields are shown
 *   to everyone who can open the vehicle).
 */

/** The template's columns in order: key, header text, what to say when it is wrong. `required` = the starred ones. */
export const IMPORT_COLUMNS = Object.freeze([
  { key: 'name', label: 'Vehicle Name*', required: true },
  { key: 'plate', label: 'Plate Number' },
  { key: 'model', label: 'Object Model' },
  { key: 'sim', label: 'Sim Card Number' },
  { key: 'sim2', label: 'Secondary Sim Number' },
  { key: 'imei', label: 'IMEI Number*', required: true },
  { key: 'category', label: 'Object Category' },
  { key: 'axle', label: 'Object Axel' },
  { key: 'manufactureDate', label: 'Manufacture Date (YYYY-MM-DD)' },
  { key: 'purchaseDate', label: 'Purchase Date (YYYY-MM-DD)' },
  { key: 'installDate', label: 'Installation Date (YYYY-MM-DD)' },
  { key: 'gpsWarranty', label: 'GPS Warrenty' },
  { key: 'vin', label: 'VIN(Chassis Number)' },
  { key: 'engineNo', label: 'Engine Number' },
  { key: 'odometer', label: 'Odometer' },
  { key: 'seats', label: 'No. of Passenger seat' },
  { key: 'trackerId', label: 'GPS Tracker ID' },
  { key: 'trackerSerial', label: 'GPS Tracker Serial No' },
  { key: 'disposalDate', label: 'Disposal Date (YYYY-MM-DD)' },
  { key: 'color', label: 'Color' },
  { key: 'registry', label: 'National Registry of Motor Vehicles' },
  { key: 'satelliteImei', label: 'Satellite IMEI' },
  { key: 'engineHourMode', label: 'Engine Work Hour Consideration' },
  { key: 'eid', label: 'EID' },
  { key: 'eid2', label: 'Secondary EID' },
  { key: 'elockPassword', label: 'Elock Unlock Password' },
])

/** The notes the template carries on its first row (shown in the sample and on the page). */
export const IMPORT_NOTES = Object.freeze([
  'Vehicle Name (max 60 characters) and IMEI Number (unique, 10 to 20 digits) are mandatory.',
  'Sim Card Number and Secondary Sim Number: digits only, 6 to 20 digits.',
  'Vehicle Name and Plate Number (max 40 characters): letters, numbers, spaces and - _ . / ( ) # & , only.',
  'Dates must be in YYYY-MM-DD format.',
  'GPS Warrenty: up to 4 digits. VIN (Chassis Number) and Engine Number: unique, up to 100 letters or numbers. Odometer: km, a number. No. of Passenger seat: up to 8 digits.',
  'Satellite IMEI: exactly 22 digits (format the column as Text so Excel keeps every digit).',
  'Engine Work Hour Consideration: 0 = From Sensor Port (default), 1 = From Device CAN.',
  'Elock Unlock Password is not imported (it is a secret).',
])

/** Names the unmapped columns get in the vehicle's custom fields. */
export const CUSTOM_LABEL = Object.freeze({
  sim2: 'Secondary SIM Number',
  category: 'Object Category',
  axle: 'Axles',
  manufactureDate: 'Manufacture Date',
  purchaseDate: 'Purchase Date',
  installDate: 'Installation Date',
  gpsWarranty: 'GPS Warranty',
  vin: 'VIN (Chassis Number)',
  engineNo: 'Engine Number',
  seats: 'Passenger Seats',
  trackerId: 'GPS Tracker ID',
  trackerSerial: 'GPS Tracker Serial No',
  disposalDate: 'Disposal Date',
  color: 'Color',
  registry: 'National Registry of Motor Vehicles',
  satelliteImei: 'Satellite IMEI',
  engineHourMode: 'Engine Work Hour Consideration',
  eid: 'EID',
  eid2: 'Secondary EID',
})
/** The name an odometer reading that could not be applied yet is kept under. */
export const ODOMETER_PENDING_LABEL = 'Odometer (imported, not yet applied)'

export const MAX_IMPORT_ROWS = 500

// ── Header ──────────────────────────────────────────────────────────────────

/** "Manufacture Date (YYYY-MM-DD)" → "manufacturedate": lower case, brackets and punctuation gone. */
const norm = v => String(v ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')

const ALIASES = {
  name: ['vehiclename', 'name', 'objectname'],
  plate: ['platenumber', 'plateno', 'plate'],
  model: ['objectmodel', 'model'],
  sim: ['simcardnumber', 'simnumber', 'sim'],
  sim2: ['secondarysimnumber', 'secondarysim'],
  imei: ['imeinumber', 'imei'],
  category: ['objectcategory'],
  axle: ['objectaxel', 'objectaxle', 'objectaxles'],
  manufactureDate: ['manufacturedate'],
  purchaseDate: ['purchasedate'],
  installDate: ['installationdate', 'installdate'],
  gpsWarranty: ['gpswarrenty', 'gpswarranty'],
  vin: ['vin', 'vinchassisnumber', 'chassisnumber'],
  engineNo: ['enginenumber'],
  odometer: ['odometer'],
  seats: ['noofpassengerseat', 'noofpassengerseats'],
  trackerId: ['gpstrackerid'],
  trackerSerial: ['gpstrackerserialno'],
  disposalDate: ['disposaldate'],
  color: ['color', 'colour'],
  registry: ['nationalregistryofmotorvehicles'],
  satelliteImei: ['satelliteimei'],
  engineHourMode: ['engineworkhourconsideration'],
  eid: ['eid'],
  eid2: ['secondaryeid'],
  elockPassword: ['elockunlockpassword'],
}
const KEY_OF = new Map(Object.entries(ALIASES).flatMap(([k, list]) => list.map(a => [a, k])))
for (const c of IMPORT_COLUMNS) KEY_OF.set(norm(c.label), c.key)

/** Which column is which, from one header row: { key: columnIndex }. */
export function mapHeader(cells) {
  const out = {}
  ;(cells ?? []).forEach((h, i) => {
    const key = KEY_OF.get(norm(h))
    if (key && out[key] === undefined) out[key] = i
  })
  return out
}

/** The header row of the sheet: the first of the top rows that names both Vehicle Name and IMEI. -1 when none. */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows?.length ?? 0, 20); i++) {
    const m = mapHeader(rows[i])
    if (m.name !== undefined && m.imei !== undefined) return i
  }
  return -1
}

// ── One row ─────────────────────────────────────────────────────────────────

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const SAFE_TEXT = /^[\p{L}\p{N} _.\-/()#&,']+$/u
const digitsOf = v => clean(v).replace(/[\s\-+().]/g, '')

function validDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(clean(v))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const EXCEL_NUMBER = /^\d(\.\d+)?e\+\d+$/i

/**
 * One raw row (strings by column key) → { vehicle, problems }. `vehicle` has the
 * cleaned values; it is only meant to be used when `problems` is empty.
 * Empty cells stay empty strings (null for odometer).
 */
export function checkVehicleRow(raw) {
  const problems = []
  const v = {}
  const get = k => clean(raw?.[k])
  const date = (k, label) => {
    const s = get(k)
    if (!s) { v[k] = ''; return }
    const d = validDate(s)
    if (!d) problems.push(`${label}: use YYYY-MM-DD`)
    v[k] = d ?? s
  }

  v.name = get('name')
  if (!v.name) problems.push('Vehicle Name is required')
  else if (v.name.length > 60) problems.push('Vehicle Name: up to 60 characters')
  else if (!SAFE_TEXT.test(v.name)) problems.push('Vehicle Name: letters, numbers, spaces and - _ . / ( ) # & , only')

  v.plate = get('plate')
  if (v.plate.length > 40) problems.push('Plate Number: up to 40 characters')
  else if (v.plate && !SAFE_TEXT.test(v.plate)) problems.push('Plate Number: letters, numbers, spaces and - _ . / ( ) # & , only')

  v.model = get('model')
  if (v.model.length > 80) problems.push('Object Model: up to 80 characters')

  const rawImei = get('imei')
  if (!rawImei) problems.push('IMEI Number is required')
  else if (EXCEL_NUMBER.test(rawImei)) problems.push('IMEI Number: Excel turned it into a power of ten, format the column as Text')
  else {
    const imei = digitsOf(rawImei)
    if (!/^\d{10,20}$/.test(imei)) problems.push('IMEI Number: 10 to 20 digits, numbers only')
    v.imei = imei
  }
  v.imei ??= ''

  for (const [k, label] of [['sim', 'Sim Card Number'], ['sim2', 'Secondary Sim Number']]) {
    const s = get(k)
    if (!s) { v[k] = ''; continue }
    const d = digitsOf(s)
    if (EXCEL_NUMBER.test(s) || !/^\d{6,20}$/.test(d)) problems.push(`${label}: 6 to 20 digits, numbers only`)
    v[k] = d
  }

  v.category = get('category')
  if (v.category && !/^(movable|immovable)$/i.test(v.category)) problems.push('Object Category: Movable or Immovable')
  else if (v.category) v.category = v.category[0].toUpperCase() + v.category.slice(1).toLowerCase()
  v.axle = get('axle')

  date('manufactureDate', 'Manufacture Date')
  date('purchaseDate', 'Purchase Date')
  date('installDate', 'Installation Date')
  date('disposalDate', 'Disposal Date')

  v.gpsWarranty = get('gpsWarranty')
  if (v.gpsWarranty && !/^\d{1,4}$/.test(v.gpsWarranty)) problems.push('GPS Warrenty: up to 4 digits')

  for (const [k, label] of [['vin', 'VIN (Chassis Number)'], ['engineNo', 'Engine Number']]) {
    v[k] = get(k)
    if (v[k].length > 100) problems.push(`${label}: up to 100 characters`)
    else if (v[k] && !/^[A-Za-z0-9\-_/ ]+$/.test(v[k])) problems.push(`${label}: letters and numbers only`)
  }

  const odo = get('odometer')
  if (!odo) v.odometer = null
  else {
    const n = Number(odo.replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 0 || n >= 10_000_000) problems.push('Odometer: a number of km from 0 to 9,999,999')
    v.odometer = Number.isFinite(n) ? n : null
  }

  v.seats = get('seats')
  if (v.seats && !/^\d{1,8}$/.test(v.seats)) problems.push('No. of Passenger seat: up to 8 digits')

  v.trackerId = get('trackerId')
  v.trackerSerial = get('trackerSerial')
  v.color = get('color')
  v.registry = get('registry')
  v.eid = get('eid')
  v.eid2 = get('eid2')
  for (const k of ['trackerId', 'trackerSerial', 'color', 'registry', 'eid', 'eid2', 'axle']) {
    if (v[k].length > 200) problems.push(`${IMPORT_COLUMNS.find(c => c.key === k)?.label ?? k}: up to 200 characters`)
  }

  const sat = get('satelliteImei')
  if (!sat) v.satelliteImei = ''
  else {
    const d = digitsOf(sat)
    if (EXCEL_NUMBER.test(sat) || !/^\d{22}$/.test(d)) problems.push('Satellite IMEI: exactly 22 digits (format the column as Text)')
    v.satelliteImei = d
  }

  const mode = get('engineHourMode').toLowerCase()
  if (!mode) v.engineHourMode = ''
  else if (['0', 'sensor', 'from sensor port', 'sensor port'].includes(mode)) v.engineHourMode = 'From Sensor Port'
  else if (['1', 'can', 'from device can', 'device can'].includes(mode)) v.engineHourMode = 'From Device CAN'
  else { problems.push('Engine Work Hour Consideration: 0 (Sensor Port) or 1 (Device CAN)'); v.engineHourMode = mode }

  // Read so the caller can tell the user it was left out; never kept.
  v.hadElockPassword = !!get('elockPassword')
  return { vehicle: v, problems }
}

/**
 * The custom fields a vehicle takes from the unmapped columns, [{ name, value }],
 * in the sheet's column order, empty ones left out.
 */
export function customFieldsOf(v) {
  const out = []
  for (const c of IMPORT_COLUMNS) {
    const label = CUSTOM_LABEL[c.key]
    if (label && v[c.key] !== '' && v[c.key] != null) out.push({ name: label, value: String(v[c.key]) })
  }
  return out
}

// ── Whole sheet ─────────────────────────────────────────────────────────────

/**
 * Rows of cells (the sheet as read, blank rows kept so the numbers are the
 * sheet's own) → the checked rows.
 *
 * @param {string[][]} rows
 * @param {object} [o]
 * @param {Set<string>} [o.existingImeis]  IMEIs already registered
 * @param {Set<string>} [o.existingVins]   chassis numbers already on a vehicle (upper-case)
 * @param {Set<string>} [o.existingEngines] engine numbers already on a vehicle (upper-case)
 * @param {number} [o.maxRows]
 * @returns {{ fatal: string|null, headerRow: number, items: object[], vehicles: object[], errors: object[] }}
 *   items: one per data row { row, name, imei, vehicle, problems, ok }; `row` is the sheet row number.
 */
export function readVehicleRows(rows, { existingImeis = new Set(), existingVins = new Set(), existingEngines = new Set(), maxRows = MAX_IMPORT_ROWS } = {}) {
  const empty = { fatal: null, headerRow: -1, items: [], vehicles: [], errors: [] }
  if (!rows?.some(r => r?.some(c => clean(c) !== ''))) return { ...empty, fatal: 'The file is empty' }
  const h = findHeaderRow(rows)
  if (h < 0) return { ...empty, fatal: 'No header row with "Vehicle Name" and "IMEI Number": start from the sample file' }
  const col = mapHeader(rows[h])
  const items = []
  let extra = 0
  rows.slice(h + 1).forEach((cells, i) => {
    const row = h + 2 + i
    const raw = {}
    for (const c of IMPORT_COLUMNS) raw[c.key] = col[c.key] === undefined ? '' : cells?.[col[c.key]]
    if (IMPORT_COLUMNS.every(c => clean(raw[c.key]) === '')) return // a blank row
    if (items.length >= maxRows) { extra += 1; return }
    items.push({ row, raw })
  })

  const checked = checkRows(items, { existingImeis, existingVins, existingEngines })
  const errors = checked.filter(i => !i.ok).map(i => ({ row: i.row, name: i.vehicle.name, imei: i.vehicle.imei, message: i.problems.join('; ') }))
  if (extra) errors.push({ row: h + 2 + maxRows, name: '', imei: '', message: `Only the first ${maxRows} vehicles are read; ${extra} more were left out` })
  return { fatal: checked.length ? null : 'The file has no vehicle rows', headerRow: h + 1, items: checked, vehicles: checked.filter(i => i.ok).map(i => ({ row: i.row, ...i.vehicle })), errors }
}

/**
 * Check every row on its own, then against each other and against what is
 * registered already (the server passes the sets from its database; the
 * browser's preview passes the vehicles it can see).
 *
 * @param {{ row: number, raw: object }[]} items  raw = cells by column key
 * @returns {{ row, raw, vehicle, problems: string[], ok: boolean }[]}
 */
export function checkRows(items, { existingImeis = new Set(), existingVins = new Set(), existingEngines = new Set() } = {}) {
  const out = items.map(({ row, raw }) => ({ row, raw, ...checkVehicleRow(raw) }))
  const seen = { imei: new Map(), vin: new Map(), engine: new Map() }
  for (const it of out) {
    const v = it.vehicle
    const claim = (map, key, msg) => {
      if (!key) return
      if (map.has(key)) it.problems.push(`${msg} (same as row ${map.get(key)})`)
      else map.set(key, it.row)
    }
    if (v.imei && /^\d{10,20}$/.test(v.imei)) {
      if (existingImeis.has(v.imei)) it.problems.push('IMEI Number is already registered to a vehicle')
      claim(seen.imei, v.imei, 'IMEI Number appears twice in the file')
    }
    const vin = v.vin.toUpperCase(), eng = v.engineNo.toUpperCase()
    if (vin && existingVins.has(vin)) it.problems.push('VIN (Chassis Number) is already on another vehicle')
    claim(seen.vin, vin, 'VIN (Chassis Number) appears twice in the file')
    if (eng && existingEngines.has(eng)) it.problems.push('Engine Number is already on another vehicle')
    claim(seen.engine, eng, 'Engine Number appears twice in the file')
  }
  for (const it of out) it.ok = it.problems.length === 0
  return out
}

/** A cell of a sample or a result as CSV text. */
const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** An example row of the sample (made up). */
export const SAMPLE_ROW = Object.freeze({
  name: 'Sample Truck 1', plate: 'A 12345', model: 'Sample Model 1', sim: '971500000001', sim2: '', imei: '350000000000001', category: 'Movable',
  axle: '2', manufactureDate: '2022-01-15', purchaseDate: '2022-02-01', installDate: '2022-02-10', gpsWarranty: '2', vin: 'SAMPLEVIN0000001',
  engineNo: 'SAMPLEENG0001', odometer: '45200', seats: '3', trackerId: 'TRK-0001', trackerSerial: 'SN-0001', disposalDate: '', color: 'White',
  registry: '', satelliteImei: '', engineHourMode: '0', eid: '', eid2: '', elockPassword: '',
})

/** The sample as CSV: the header row, then one example row. */
export function sampleCsv() {
  return [
    IMPORT_COLUMNS.map(c => esc(c.label)).join(','),
    IMPORT_COLUMNS.map(c => esc(SAMPLE_ROW[c.key])).join(','),
  ].join('\n') + '\n'
}

/** The failed rows as a CSV the user can fix and upload again. */
export function errorsCsv(errors) {
  return ['Row,Vehicle Name,IMEI,Problem', ...errors.map(e => [e.row, e.name, e.imei, e.message].map(esc).join(','))].join('\n') + '\n'
}
