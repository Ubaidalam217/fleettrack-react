/**
 * Bulk upload of stops (client 2026-11-21, after Uffizio's checkpoint bulk
 * upload): an Excel or CSV sheet, one stop per row, checked row by row before
 * anything is added. A row may name an address-book entry instead of giving
 * coordinates. "Save as address" adds the row to the address book too.
 *
 * Pure: New Journey, Route Optimization and Checkpoints & Routes read the file
 * (exceljs for .xlsx) into rows of cells and pass them here.
 */

export const STOP_PURPOSES = Object.freeze(['LOADING', 'UNLOADING', 'DELIVERY', 'REST', 'OTHER'])
export const PURPOSE_LABEL = Object.freeze({ LOADING: 'Loading', UNLOADING: 'Unloading', DELIVERY: 'Delivery', REST: 'Rest', OTHER: 'Other' })

/** The sample sheet's columns, in order. `*` = needed (Latitude/Longitude unless the name is in the address book). */
export const IMPORT_COLUMNS = Object.freeze([
  { key: 'name', label: 'Name *', example: 'ADNOC Ruwais Gate 2' },
  { key: 'lat', label: 'Latitude', example: '24.1105' },
  { key: 'lng', label: 'Longitude', example: '52.7302' },
  { key: 'radiusM', label: 'Radius (m)', example: '300' },
  { key: 'stayMin', label: 'Stay (min)', example: '30' },
  { key: 'purpose', label: 'State (Loading/Unloading/Delivery/Rest/Other)', example: 'Delivery' },
  { key: 'visitVia', label: 'Visited via (Map/QR)', example: 'Map' },
  { key: 'signature', label: 'Signature (Yes/No)', example: 'Yes' },
  { key: 'weight', label: 'Weight', example: '1200' },
  { key: 'windowFrom', label: 'Window from (HH:mm)', example: '08:00' },
  { key: 'windowTo', label: 'Window to (HH:mm)', example: '12:00' },
  { key: 'saveAddress', label: 'Save as address (Yes/No)', example: 'No' },
])

/** The sample as CSV text (the same columns as the Excel sample). */
export function sampleCsv() {
  const esc = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [
    IMPORT_COLUMNS.map(c => esc(c.label)).join(','),
    IMPORT_COLUMNS.map(c => esc(c.example)).join(','),
    ['Mussafah Yard', '24.3522', '54.4996', '250', '0', 'Loading', 'Map', 'No', '', '', '', 'Yes'].map(esc).join(','),
  ].join('\n') + '\n'
}

/** CSV text → rows of cells (quotes, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text, { keepBlank = false } = {}) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text ?? '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  // keepBlank: the row numbers stay the sheet's own (the vehicle import says "row 7").
  return keepBlank ? rows : rows.filter(r => r.some(c => String(c).trim() !== ''))
}

const norm = v => String(v ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')

/** Which column is which, from the header row (by its words, any order). */
export function mapHeader(header) {
  const keys = {}
  header.forEach((h, i) => {
    const n = norm(h)
    const key = n.startsWith('name') ? 'name'
      : n.startsWith('lat') ? 'lat'
        : n.startsWith('lon') || n.startsWith('lng') ? 'lng'
          : n.startsWith('radius') ? 'radiusM'
            : n.startsWith('stay') ? 'stayMin'
              : n.startsWith('state') || n.startsWith('purpose') ? 'purpose'
                : n.startsWith('visit') ? 'visitVia'
                  : n.startsWith('sign') ? 'signature'
                    : n.startsWith('weight') ? 'weight'
                      : n.startsWith('windowfrom') ? 'windowFrom'
                        : n.startsWith('windowto') ? 'windowTo'
                          : n.startsWith('save') ? 'saveAddress' : null
    if (key && keys[key] === undefined) keys[key] = i
  })
  return keys
}

const yes = v => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase())
const num = v => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const hhmm = v => {
  if (v == null || String(v).trim() === '') return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return NaN
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * Rows of cells (header first) → { stops, errors }.
 * stops: [{ row, name, lat, lng, radiusM, stayMin, purpose, visitVia, signatureRequired, weight, windowFrom, windowTo, saveAddress, addressId? }]
 * errors: [{ row, message }] — `row` is the sheet's row number (header = 1).
 * `addressByName(name)` returns an address-book entry for a row without coordinates.
 */
export function readStopRows(rows, { addressByName = () => null, defaultRadiusM = 300, maxRows = 200 } = {}) {
  const errors = []
  const stops = []
  if (!rows?.length) return { stops, errors: [{ row: 1, message: 'The file is empty' }] }
  const col = mapHeader(rows[0])
  if (col.name === undefined) return { stops, errors: [{ row: 1, message: 'No "Name" column: start from the sample file' }] }
  const body = rows.slice(1)
  if (body.length > maxRows) errors.push({ row: maxRows + 2, message: `Only the first ${maxRows} rows are read` })
  body.slice(0, maxRows).forEach((cells, i) => {
    const row = i + 2
    const cell = k => (col[k] === undefined ? '' : cells[col[k]])
    const problems = []
    const name = String(cell('name') ?? '').trim().slice(0, 120)
    if (!name) problems.push('no name')
    let lat = num(cell('lat')), lng = num(cell('lng'))
    let address = null
    if (lat == null && lng == null && name) {
      address = addressByName(name)
      if (address) { lat = address.lat; lng = address.lng }
      else problems.push('no latitude/longitude and no address-book entry with this name')
    } else {
      if (lat == null || Number.isNaN(lat) || lat < -90 || lat > 90) problems.push('latitude must be a number from -90 to 90')
      if (lng == null || Number.isNaN(lng) || lng < -180 || lng > 180) problems.push('longitude must be a number from -180 to 180')
      if (lat === 0 && lng === 0) problems.push('0, 0 is not a real place')
    }
    let radiusM = num(cell('radiusM'))
    if (Number.isNaN(radiusM) || (radiusM != null && (radiusM < 30 || radiusM > 20000))) problems.push('radius must be 30 to 20000 m')
    let stayMin = num(cell('stayMin'))
    if (Number.isNaN(stayMin) || (stayMin != null && (stayMin < 0 || stayMin > 1440))) problems.push('stay must be 0 to 1440 min')
    const p = norm(cell('purpose'))
    const purpose = p ? STOP_PURPOSES.find(x => x.toLowerCase() === p) : (address?.purpose ?? 'OTHER')
    if (!purpose) problems.push('state must be Loading, Unloading, Delivery, Rest or Other')
    const v = norm(cell('visitVia'))
    const visitVia = !v || v === 'map' ? 'MAP' : v === 'qr' || v === 'qrscan' ? 'QR' : null
    if (!visitVia) problems.push('visited via must be Map or QR')
    const weight = num(cell('weight'))
    if (Number.isNaN(weight) || (weight != null && weight < 0)) problems.push('weight must be a number ≥ 0')
    const windowFrom = hhmm(cell('windowFrom')), windowTo = hhmm(cell('windowTo'))
    if (Number.isNaN(windowFrom) || Number.isNaN(windowTo)) problems.push('a time window is HH:mm')
    if (problems.length) { errors.push({ row, message: `${name || 'Row'}: ${problems.join('; ')}` }); return }
    if (radiusM == null) radiusM = address?.radiusM ?? defaultRadiusM
    if (stayMin == null) stayMin = 0
    stops.push({
      row, name, lat, lng, radiusM: Math.round(radiusM), stayMin: Math.round(stayMin), purpose, visitVia,
      signatureRequired: yes(cell('signature')), weight: weight ?? null, windowFrom, windowTo,
      saveAddress: !address && yes(cell('saveAddress')), addressId: address?.id ?? null,
      arrivalType: address?.arrivalType ?? 'RADIUS', geofenceId: address?.geofenceId ?? null,
    })
  })
  return { stops, errors }
}
