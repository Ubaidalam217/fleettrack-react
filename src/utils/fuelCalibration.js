/**
 * Fuel calibration (client, 2026-11-24): a fuel level sensor reports a raw
 * value — millivolts for an analogue or BLE level sensor — and the vehicle's
 * calibration table turns it into litres. Pure and shared: the web page uses it
 * for the upload preview and the server (lib/fuel.js) for the report and the
 * alerts, so both always agree. `.js` imports only, so Node can load it.
 *
 * A table is points { litres, mv }, read piecewise-linearly. The voltage may
 * rise with the level (most sensors) or fall with it; either works, but it must
 * do one or the other all the way (a table that goes up and down again cannot
 * be inverted, and is refused). A reading a little outside the table is held
 * to its nearest end ('clamped'); one FAR outside it (more than 10 % of the
 * table's span beyond an end — a sensor fault, a dropout to 0, or another
 * sensor's scale such as 30022) gives no litres at all ('out_of_range') rather
 * than an invented figure.
 *
 * Reading methods: 'PORT' (a named fuel port of the Uffizio feed), 'AIN1' /
 * 'AIN2' (analogue input 1 / 2 of a tracker), 'CAN' (the vehicle's own fuel
 * level in percent — no table, only the tank capacity).
 */

export const METHODS = Object.freeze([
  { value: 'PORT', label: 'Uffizio fuel port', table: true },
  { value: 'AIN1', label: 'Input 1 (analog, volts)', table: true },
  { value: 'AIN2', label: 'Input 2 (analog, volts)', table: true },
  { value: 'CAN',  label: 'CAN percent (fuel level %, x tank)', table: false },
  { value: 'CAN_VOLUME', label: 'CAN litres (fuel volume, no table)', table: false },
])
export const METHOD_VALUES = METHODS.map(m => m.value)
export const methodLabel = v => METHODS.find(m => m.value === v)?.label ?? v

/** The port a method reads, when it is not a named Uffizio port. */
export const METHOD_PORT = Object.freeze({ AIN1: 'ain.1', AIN2: 'ain.2', CAN: 'can.fuel.level', CAN_VOLUME: 'can.fuel.volume' })

/**
 * Where a Flespi tracker's reading of each method comes from (client,
 * 2026-11-27, Smart5): the telemetry parameter, the stored port name and the
 * unit Flespi gives it in. An analogue input is volts there and is stored as
 * millivolts, so the client's mV tables apply.
 */
export const FLESPI_FUEL_SOURCES = Object.freeze({
  AIN1: { field: 'ain.1', port: 'ain.1', unit: 'V' },
  AIN2: { field: 'ain.2', port: 'ain.2', unit: 'V' },
  CAN: { field: 'can.fuel.level', port: 'can.fuel.level', unit: '%' },
  CAN_VOLUME: { field: 'can.fuel.volume', port: 'can.fuel.volume', unit: 'L' },
})
export const FLESPI_FUEL_METHODS = Object.freeze(Object.keys(FLESPI_FUEL_SOURCES))

/** How far outside the table (share of its span) a reading may be and still be held to the end. */
export const OUT_OF_RANGE_FRACTION = 0.1
export const MAX_POINTS = 500

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * "1,234.5", "1,500", "12,5", " 300 " → a number; '' / text → null.
 * A comma is a thousands separator when a dot is there too or it groups
 * three digits ("1,500" mV); otherwise it is a decimal mark ("12,5" L).
 */
export function toNumber(v) {
  if (isNum(v)) return v
  let s = String(v ?? '').trim().replace(/\s+/g, '')
  if (!s) return null
  s = s.includes('.') || /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Check a table and put it in order.
 *
 * @param {{litres:number, mv:number, row?:number}[]} input
 * @param {{ tankCapacityL?: number|null }} opts
 * @returns {{ points: {litres:number, mv:number}[], errors: {row:number|null, message:string}[],
 *             warnings: {row:number|null, message:string}[], direction: 'rising'|'falling'|null }}
 */
export function validateCalibration(input, { tankCapacityL = null } = {}) {
  const errors = []
  const warnings = []
  const seen = new Map() // "litres|mv" → row
  const list = []
  for (const [i, p] of (input ?? []).entries()) {
    const row = p?.row ?? i + 1
    const litres = toNumber(p?.litres)
    const mv = toNumber(p?.mv)
    if (litres === null || mv === null) { errors.push({ row, message: litres === null ? 'Fuel Liter is not a number' : 'Voltage is not a number' }); continue }
    if (litres < 0) { errors.push({ row, message: 'Fuel Liter cannot be negative' }); continue }
    if (mv < 0) { errors.push({ row, message: 'Voltage cannot be negative' }); continue }
    const key = `${litres}|${mv}`
    if (seen.has(key)) { warnings.push({ row, message: `Same as row ${seen.get(key)} — used once` }); continue }
    seen.set(key, row)
    list.push({ litres, mv, row })
  }
  if (list.length > MAX_POINTS) errors.push({ row: null, message: `Up to ${MAX_POINTS} rows` })

  // One voltage with two levels, or one level at two voltages, cannot be read back.
  const byMv = new Map()
  const byL = new Map()
  for (const p of list) {
    if (byMv.has(p.mv)) errors.push({ row: p.row, message: `Voltage ${p.mv} is also on row ${byMv.get(p.mv).row} with another Fuel Liter` })
    else byMv.set(p.mv, p)
    if (byL.has(p.litres)) errors.push({ row: p.row, message: `Fuel Liter ${p.litres} is also on row ${byL.get(p.litres).row} with another Voltage` })
    else byL.set(p.litres, p)
  }

  const sorted = [...list].sort((a, b) => a.mv - b.mv)
  let direction = null
  if (sorted.length >= 2 && !errors.length) {
    direction = sorted[1].litres > sorted[0].litres ? 'rising' : 'falling'
    for (let k = 1; k < sorted.length; k++) {
      const up = sorted[k].litres > sorted[k - 1].litres
      if (up !== (direction === 'rising')) {
        errors.push({ row: sorted[k].row, message: `The level goes ${up ? 'up' : 'down'} again at ${sorted[k].mv} mV — the table must only rise or only fall with the voltage` })
        break
      }
    }
  }
  if (list.length < 2 && !errors.some(e => e.row === null)) errors.push({ row: null, message: 'The table needs at least 2 rows' })

  const tank = toNumber(tankCapacityL)
  if (tank !== null && tank > 0 && sorted.length) {
    const top = Math.max(...sorted.map(p => p.litres))
    if (top > tank * 1.05) warnings.push({ row: null, message: `The table goes up to ${top} L, more than the ${tank} L tank` })
    else if (top < tank * 0.8) warnings.push({ row: null, message: `The table stops at ${top} L of a ${tank} L tank — a fuller tank reads as ${top} L` })
  }
  return { points: sorted.map(({ litres, mv }) => ({ litres, mv })), errors, warnings, direction }
}

/**
 * Raw reading → litres with one calibration.
 * @param {number} raw
 * @param {{ method: string, points?: {litres,mv}[], tankCapacityL?: number|null }} cal
 * @returns {{ litres: number|null, flag: null|'clamped'|'out_of_range'|'no_calibration'|'no_tank' }}
 */
export function rawToLitres(raw, cal) {
  const r = toNumber(raw)
  if (r === null) return { litres: null, flag: 'out_of_range' }
  if (!cal) return { litres: null, flag: 'no_calibration' }
  if (cal.method === 'CAN_VOLUME') {
    // Litres as the vehicle reports them; no table. A figure far above the tank is a fault.
    const tank = toNumber(cal.tankCapacityL)
    if (r < 0 || (tank > 0 && r > tank * (1 + OUT_OF_RANGE_FRACTION))) return { litres: null, flag: 'out_of_range' }
    return { litres: round2(r), flag: null }
  }
  if (cal.method === 'CAN') {
    if (r < 0 || r > 100 * (1 + OUT_OF_RANGE_FRACTION)) return { litres: null, flag: 'out_of_range' }
    const tank = toNumber(cal.tankCapacityL)
    if (!tank || tank <= 0) return { litres: null, flag: 'no_tank' }
    const pct = Math.min(100, r)
    return { litres: round2((pct / 100) * tank), flag: r > 100 ? 'clamped' : null }
  }
  const pts = Array.isArray(cal.points) ? [...cal.points].filter(p => isNum(p?.mv) && isNum(p?.litres)).sort((a, b) => a.mv - b.mv) : []
  if (pts.length < 2) return { litres: null, flag: 'no_calibration' }
  const lo = pts[0], hi = pts[pts.length - 1]
  const slack = (hi.mv - lo.mv) * OUT_OF_RANGE_FRACTION
  if (r < lo.mv - slack || r > hi.mv + slack) return { litres: null, flag: 'out_of_range' }
  if (r <= lo.mv) return { litres: round2(lo.litres), flag: r < lo.mv ? 'clamped' : null }
  if (r >= hi.mv) return { litres: round2(hi.litres), flag: r > hi.mv ? 'clamped' : null }
  // Binary search for the segment that holds r.
  let a = 0, b = pts.length - 1
  while (b - a > 1) {
    const m = (a + b) >> 1
    if (pts[m].mv <= r) a = m
    else b = m
  }
  const p = pts[a], q = pts[b]
  const t = (r - p.mv) / (q.mv - p.mv)
  return { litres: round2(p.litres + t * (q.litres - p.litres)), flag: null }
}

const round2 = v => Math.round(v * 100) / 100

/**
 * A sensor port as one name: Uffizio calls the same kind of port "BLE Fuel Level #1" on
 * one tracker model and "BLE Fuel Level 1" on another. Both are the same port (the
 * calibration of 8 of the 11 client vehicles did not apply because of the "#").
 */
export const canonicalPort = p => String(p ?? '').replace(/#/g, '').replace(/\s+/g, ' ').trim()
export const samePort = (a, b) => canonicalPort(a).toLowerCase() === canonicalPort(b).toLowerCase()

/** The port a calibration reads: the named Uffizio port, or ain.1 / ain.2 / can.fuel.level / can.fuel.volume. */
export const calibrationPort = cal => (cal?.method === 'PORT' ? cal.port : METHOD_PORT[cal?.method] ?? cal?.port ?? null)

/**
 * One stored reading → litres with the vehicle's calibration, or null with why.
 * A reading of another port than the calibration's is not converted.
 */
export function readingLitres(reading, cal) {
  if (!cal) return { litres: null, flag: 'no_calibration' }
  const port = calibrationPort(cal)
  if (port && reading?.port && !samePort(reading.port, port)) return { litres: null, flag: 'other_port' }
  return rawToLitres(reading?.raw, cal)
}

// ── the client's upload file ────────────────────────────────────────────────

const norm = s => String(s ?? '').toLowerCase().replace(/[*:()]/g, ' ').replace(/\s+/g, ' ').trim()
const isLitresHead = s => /^(fuel )?lit(er|re)s?( l)?$/.test(norm(s)) || norm(s) === 'fuel liter' || norm(s) === 'fuel litre'
const isVoltHead = s => /^(voltage|volt|mv|millivolts?)( mv)?$/.test(norm(s))

/**
 * The client's template: a header row with `Fuel Liter *` and `Voltage *`
 * (millivolts), then one row per point. `rows` are the sheet's rows as cell
 * text (utils/vehicleImportFiles.js readVehicleSheet). Blank rows are skipped;
 * every other row comes back with its sheet row number, so the preview can
 * point at it.
 *
 * Without that header, a sheet laid out as the installer's test sheet is —
 * pairs of number columns side by side (litres, millivolts, litres,
 * millivolts…) under a few lines of notes — is read pair by pair ('pairs').
 *
 * @returns {{ points: {row:number, litres:number|null, mv:number|null}[], errors: {row:number|null, message:string}[],
 *             warnings: {row:number|null, message:string}[], layout: 'template'|'pairs'|null }}
 */
export function parseCalibrationRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  let head = -1, li = -1, vi = -1
  for (let r = 0; r < Math.min(list.length, 30) && head < 0; r++) {
    const cells = list[r] ?? []
    const l = cells.findIndex(isLitresHead)
    const v = cells.findIndex(isVoltHead)
    if (l >= 0 && v >= 0) { head = r; li = l; vi = v }
  }
  if (head < 0) {
    const pairs = parsePairs(list)
    if (pairs) return pairs
    return { points: [], errors: [{ row: null, message: 'No header row with “Fuel Liter” and “Voltage” was found. Use the sample file’s layout.' }], warnings: [], layout: null }
  }
  const points = []
  const errors = []
  for (let r = head + 1; r < list.length; r++) {
    const cells = list[r] ?? []
    const lt = String(cells[li] ?? '').trim()
    const vt = String(cells[vi] ?? '').trim()
    if (!lt && !vt) continue
    const row = r + 1
    const litres = toNumber(lt)
    const mv = toNumber(vt)
    if (litres === null) errors.push({ row, message: lt ? `Fuel Liter “${lt}” is not a number` : 'Fuel Liter is empty' })
    if (mv === null) errors.push({ row, message: vt ? `Voltage “${vt}” is not a number` : 'Voltage is empty' })
    points.push({ row, litres, mv })
  }
  if (!points.length && !errors.length) errors.push({ row: null, message: 'The file has a header but no rows' })
  return { points, errors, warnings: [], layout: 'template' }
}

/**
 * The headerless pairs layout: the first row with at least two numbers (an
 * even count) fixes the columns — (1st, 2nd) is litres / mV, (3rd, 4th) the
 * next pair… — and every row after it is read in those columns. A row with a
 * litres figure and no voltage (the sensor's top) is skipped with a warning.
 * Null when no such table is found.
 */
function parsePairs(list) {
  const numericCols = cells => cells.map((c, i) => (toNumber(c) !== null ? i : -1)).filter(i => i >= 0)
  let start = -1, cols = null
  for (let r = 0; r < list.length; r++) {
    const idx = numericCols(list[r] ?? [])
    if (idx.length >= 2 && idx.length % 2 === 0) {
      // The next row must look the same, or this is a stray pair of numbers.
      const nxt = numericCols(list[r + 1] ?? [])
      if (idx.filter((_, j) => j % 2 === 0).every(i => nxt.includes(i))) { start = r; cols = idx; break }
    }
  }
  if (start < 0) return null
  const points = []
  const warnings = []
  for (let k = 0; k < cols.length; k += 2) {
    for (let r = start; r < list.length; r++) {
      const cells = list[r] ?? []
      const litres = toNumber(cells[cols[k]])
      const mv = toNumber(cells[cols[k + 1]])
      if (litres === null && mv === null) continue
      if (litres === null || mv === null) {
        warnings.push({ row: r + 1, message: litres === null ? 'A voltage with no Fuel Liter — skipped' : `${litres} L has no voltage — skipped` })
        continue
      }
      points.push({ row: r + 1, litres, mv })
    }
  }
  if (points.length < 2) return null
  return { points, errors: [], warnings, layout: 'pairs' }
}

/** An invented 200 L table for the sample download (rising voltage). */
export const SAMPLE_POINTS = Object.freeze([
  [0, 500], [20, 880], [40, 1270], [60, 1650], [80, 2040], [100, 2420],
  [120, 2810], [140, 3190], [160, 3580], [180, 3960], [200, 4350],
].map(([litres, mv]) => ({ litres, mv })))

/** The sample as CSV, in the client's column names. */
export const sampleCalibrationCsv = () => ['Fuel Liter *,Voltage *', ...SAMPLE_POINTS.map(p => `${p.litres},${p.mv}`)].join('\r\n') + '\r\n'
