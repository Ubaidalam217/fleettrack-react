import { useSyncExternalStore } from 'react'

/**
 * Phase 2 mock backend for the Settings module.
 *
 * Everything here is in-memory: no fetch, no persistence, no Flespi. The point
 * of the file is the seam — pages only ever touch the exported hooks and
 * mutators, never the arrays, so a later phase can replace the bodies of
 * addCompany/updateCompany/removeCompany with real API calls and the two pages
 * carry on unchanged.
 *
 * State is module-level rather than per-page useState on purpose. A branch's
 * Company dropdown has to show a company you just added on the other page, and
 * page-local state would also reset every time you navigated away and back,
 * which reads as data loss rather than as a mock.
 */

// ── Dropdown vocabularies ──────────────────────────────────────────────────

export const RESELLERS = [
  'FleetmaX Solutions',
  'Solves Inn',
  'Gulf Telematics LLC',
  'Emirates Fleet Systems',
  'Al Nahda Trading',
]

/**
 * Alert types. Temperature is the only one the client needs today, but the
 * registry is the extension point: a new type is one entry here, one settings
 * block and one validator in Alerts.jsx. The dropdown, the table's Type column
 * and the conditional settings section all read from this list, so nothing
 * else has to learn the new name.
 *
 * `defaults()` returns the blank `settings` bag for that type, which is what
 * the form swaps in when the type changes.
 */
export const ALERT_TYPES = [
  {
    value: 'temperature',
    label: 'Temperature High/Low',
    defaults: () => ({ minTemp: '', maxTemp: '' }),
  },
]

export function alertTypeLabel(value) {
  return ALERT_TYPES.find(t => t.value === value)?.label || '—'
}

// ── Blank records ──────────────────────────────────────────────────────────
// Also the field contract: a form's initial values and a saved row have the
// same shape, so nothing has to guard against a missing key.

export function emptyCompany() {
  return {
    id: null,
    reseller: RESELLERS[0],
    name:     '',
    // Becomes the account's login username in a later phase, which is why it
    // is required here rather than optional like the address block used to be.
    email:    '',
  }
}

export function emptyBranch() {
  return {
    id: null,
    companyId: '',
    name:      '',
  }
}

/**
 * Seeded into every new account form. Editable — it is a starting value the
 * operator is expected to hand over, not a constant.
 */
export const DEFAULT_PASSWORD = 'Aa@123456'

// A login account for a whole company. There is deliberately no `username`
// field: the username IS the email, and keeping a second copy of it is how the
// two drift apart the first time someone edits one and not the other. The form
// shows a read-only Username box rendered straight from `email`, and the table
// column labelled Username reads `email` too.
export function emptyUser() {
  return {
    id: null,
    companyId:   '',
    email:       '',
    password:    DEFAULT_PASSWORD,
    forceChange: true,
    // Not on the form — new accounts are Active and status changes belong to a
    // later phase alongside suspend/reactivate.
    status:      'Active',
  }
}

// A tracked vehicle. `imei` is the device identifier the Flespi integration
// will key on later; `branchId` is optional and always belongs to `companyId`.
export function emptyVehicle() {
  return {
    id: null,
    companyId: '',
    branchId:  '',
    name:      '',
    imei:      '',
    plateNo:   '',
  }
}

/**
 * A rule watching some slice of a company's fleet.
 *
 * `allVehicles` is a mode, not a snapshot. Storing "all" as an expanded list of
 * ids would quietly exclude every vehicle added after the alert was written —
 * the fleet grows and coverage silently does not. `vehicleIds` is only read
 * when the toggle is off.
 */
export function emptyAlert() {
  return {
    id: null,
    name:        '',
    type:        ALERT_TYPES[0].value,
    companyId:   '',
    allVehicles: true,
    vehicleIds:  [],
    settings:    ALERT_TYPES[0].defaults(),
    // UI only this phase — nothing dispatches on these yet.
    notify:      { inApp: true, email: false, sms: false },
    status:      'Active',
  }
}

// A restricted account under a company, limited to the vehicles assigned to it.
export function emptySubuser() {
  return {
    id: null,
    companyId:  '',
    // Keyed `name` rather than `shortName` so the shared SettingsTable can use
    // it for row action labels the same way Company and Branch rows do.
    name:       '',
    email:      '',
    password:   DEFAULT_PASSWORD,
    vehicleIds: [],
  }
}

// ── Seed rows ──────────────────────────────────────────────────────────────

const SEED_COMPANIES = [
  { id: 'c1', reseller: 'FleetmaX Solutions',    name: 'Al Habtoor Logistics',  email: 'hassan@alhabtoorlog.ae' },
  { id: 'c2', reseller: 'Solves Inn',            name: 'Desert Rose Transport', email: 'ops@desertrose.ae' },
  { id: 'c3', reseller: 'Gulf Telematics LLC',   name: 'Emirates Cold Chain',   email: 'y.kareem@emiratescold.ae' },
  { id: 'c4', reseller: 'FleetmaX Solutions',    name: 'Northern Gulf Haulage', email: 'a.nasser@ngh.sa' },
]

const SEED_BRANCHES = [
  { id: 'b1', companyId: 'c1', name: 'Mussafah Depot' },
  { id: 'b2', companyId: 'c1', name: 'Al Ain Yard' },
  { id: 'b3', companyId: 'c2', name: 'Jebel Ali Hub' },
  { id: 'b4', companyId: 'c3', name: 'Sharjah Cold Store' },
]

const SEED_USERS = [
  { id: 'u1', companyId: 'c1', email: 'hassan@alhabtoorlog.ae',  password: DEFAULT_PASSWORD, forceChange: false, status: 'Active'   },
  { id: 'u2', companyId: 'c2', email: 'ops@desertrose.ae',       password: DEFAULT_PASSWORD, forceChange: true,  status: 'Active'   },
  { id: 'u3', companyId: 'c3', email: 'y.kareem@emiratescold.ae',password: DEFAULT_PASSWORD, forceChange: false, status: 'Inactive' },
]

// The fleet each company owns. Owned by the Object > Vehicle page; the sub-user
// assignment panel reads the same list so an edit here shows up there. Note c4
// has none, which is the case the assignment panel has to handle without
// looking broken.
//
// `imei` is the key that will match a row here against a Flespi device once
// this stops being mock data, which is why the form requires it. `fleetNo` and
// `type` predate the Vehicle form and it does not collect them — they stay on
// the seeds as extra identifiers and are simply absent on anything added since.
const SEED_VEHICLES = [
  { id: 'v1', companyId: 'c1', branchId: 'b1', name: 'Mussafah Truck 1', imei: '863071011234501', plateNo: 'AD 12345-G1', fleetNo: 'FL-01', type: 'Truck'  },
  { id: 'v2', companyId: 'c1', branchId: 'b1', name: 'Mussafah Truck 2', imei: '863071011234502', plateNo: 'AD 55401-B2', fleetNo: 'FL-02', type: 'Truck'  },
  { id: 'v3', companyId: 'c1', branchId: 'b2', name: 'Al Ain Van',       imei: '863071011234503', plateNo: 'AD 77120-A4', fleetNo: 'FL-03', type: 'Van'    },
  { id: 'v4', companyId: 'c1', branchId: '',   name: 'Site Pickup',      imei: '863071011234504', plateNo: 'AD 30988-C1', fleetNo: 'FL-04', type: 'Pickup' },
  { id: 'v5', companyId: 'c2', branchId: 'b3', name: 'Jebel Ali Hauler', imei: '863071011234505', plateNo: 'DXB 44012-K', fleetNo: 'DR-01', type: 'Trailer'},
  { id: 'v6', companyId: 'c2', branchId: 'b3', name: 'City Van 1',       imei: '863071011234506', plateNo: 'DXB 88231-M', fleetNo: 'DR-02', type: 'Van'    },
  { id: 'v7', companyId: 'c2', branchId: '',   name: 'Long Haul 7',      imei: '863071011234507', plateNo: 'DXB 10577-P', fleetNo: 'DR-03', type: 'Truck'  },
  { id: 'v8', companyId: 'c3', branchId: 'b4', name: 'Reefer North',     imei: '863071011234508', plateNo: 'SHJ 20114-T', fleetNo: 'EC-01', type: 'Reefer' },
  { id: 'v9', companyId: 'c3', branchId: 'b4', name: 'Reefer South',     imei: '863071011234509', plateNo: 'SHJ 66302-R', fleetNo: 'EC-02', type: 'Reefer' },
]

const SEED_ALERTS = [
  {
    id: 'a1', name: 'Reefer temperature breach', type: 'temperature',
    companyId: 'c3', allVehicles: true, vehicleIds: [],
    settings: { minTemp: '-18', maxTemp: '-2' },
    notify: { inApp: true, email: true, sms: false }, status: 'Active',
  },
  {
    id: 'a2', name: 'Cabin overheat — city vans', type: 'temperature',
    companyId: 'c2', allVehicles: false, vehicleIds: ['v6'],
    settings: { minTemp: '', maxTemp: '45' },
    notify: { inApp: true, email: false, sms: false }, status: 'Inactive',
  },
]

const SEED_SUBUSERS = [
  { id: 's1', companyId: 'c1', name: 'Mussafah Dispatch', email: 'dispatch@alhabtoorlog.ae', password: DEFAULT_PASSWORD, vehicleIds: ['v1', 'v2'] },
  { id: 's2', companyId: 'c2', name: 'Jebel Ali Ops',     email: 'jebelali@desertrose.ae',   password: DEFAULT_PASSWORD, vehicleIds: ['v5', 'v6', 'v7'] },
]

// ── localStorage persistence ───────────────────────────────────────────────
/**
 * TEMPORARY testing aid. Wraps the store seam so a record added in the UI
 * survives a hard refresh instead of snapping back to seed mid-demo.
 *
 * Deliberately a wrapper and not a change to the public API: every exported
 * mutator and selector below behaves exactly as before, so this whole section
 * deletes in one piece once the real APIs land.
 *
 * The key is versioned — bump v1 to v2 and every browser holding the old shape
 * falls back to seed on next load rather than hydrating rows that no longer
 * match the form.
 */
const STORAGE_KEY = 'fleetmax-mock-v1'

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // Corrupt JSON or a locked-down browser: fall through to seed rather than
    // taking the whole Settings module down with it.
    return null
  }
}

const saved = readSaved()

// Only accept a saved slice that is still the right shape.
const hydrate = (key, seed) => (Array.isArray(saved?.[key]) ? saved[key] : [...seed])

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      // The id counter rides along with the rows. Saving rows but not the
      // counter would restart it at 100 after a refresh and re-issue ids that
      // the saved data already uses.
      nextId,
      companies: companyStore.get(),
      branches:  branchStore.get(),
      users:     userStore.get(),
      subusers:  subuserStore.get(),
      vehicles:  vehicleStore.get(),
      alerts:    alertStore.get(),
    }))
  } catch { /* private mode or quota — the session still works in memory */ }
}

// ── Minimal observable store ───────────────────────────────────────────────

function createStore(initial) {
  let data = initial
  const listeners = new Set()
  return {
    // Stable reference between writes — useSyncExternalStore compares by
    // identity and would loop forever on a fresh array each call.
    get: () => data,
    set(next) {
      data = typeof next === 'function' ? next(data) : next
      // Before the notify, so a subscriber that reads storage sees the write.
      persist()
      listeners.forEach(fn => fn())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

const companyStore = createStore(hydrate('companies', SEED_COMPANIES))
const branchStore  = createStore(hydrate('branches',  SEED_BRANCHES))
const userStore    = createStore(hydrate('users',     SEED_USERS))
const subuserStore = createStore(hydrate('subusers',  SEED_SUBUSERS))
const vehicleStore = createStore(hydrate('vehicles',  SEED_VEHICLES))
const alertStore   = createStore(hydrate('alerts',    SEED_ALERTS))

let nextId = Number.isFinite(saved?.nextId) ? saved.nextId : 100
const makeId = prefix => `${prefix}${nextId++}`

// First run on this browser: write the seed out so the saved copy and what is
// on screen agree from the very first render.
if (!saved) persist()

/**
 * Wipe the saved copy and put every store back to seed. Exposed on window so a
 * developer can reset mid-session without clearing site data by hand.
 */
export function resetMockData() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* nothing to clear */ }
  nextId = 100
  // Copies, so a later mutation can never write through to the seed arrays.
  companyStore.set([...SEED_COMPANIES])
  branchStore.set([...SEED_BRANCHES])
  userStore.set([...SEED_USERS])
  subuserStore.set([...SEED_SUBUSERS])
  vehicleStore.set([...SEED_VEHICLES])
  alertStore.set([...SEED_ALERTS])
  // Each set() above persisted already; this one carries the reset counter.
  persist()
}

if (typeof window !== 'undefined') {
  window.fleetmaxResetData = () => {
    resetMockData()
    console.log('[FleetmaX] Mock data reset to seed.')
    return 'Mock data reset to seed.'
  }
  console.log(
    `[FleetmaX] Settings mock data persists in localStorage ("${STORAGE_KEY}") — run fleetmaxResetData() to wipe back to seed.`
  )
}

// ── Companies ──────────────────────────────────────────────────────────────

export function useCompanies() {
  return useSyncExternalStore(companyStore.subscribe, companyStore.get, companyStore.get)
}

export function addCompany(company) {
  const row = { ...company, id: makeId('c') }
  companyStore.set(list => [...list, row])
  return row
}

export function updateCompany(id, patch) {
  companyStore.set(list => list.map(c => (c.id === id ? { ...c, ...patch, id } : c)))
}

export function removeCompany(id) {
  companyStore.set(list => list.filter(c => c.id !== id))
}

// ── Branches ───────────────────────────────────────────────────────────────

export function useBranches() {
  return useSyncExternalStore(branchStore.subscribe, branchStore.get, branchStore.get)
}

export function addBranch(branch) {
  const row = { ...branch, id: makeId('b') }
  branchStore.set(list => [...list, row])
  return row
}

export function updateBranch(id, patch) {
  branchStore.set(list => list.map(b => (b.id === id ? { ...b, ...patch, id } : b)))
}

export function removeBranch(id) {
  branchStore.set(list => list.filter(b => b.id !== id))
}

/** Company name for a branch row, tolerant of an id that no longer resolves. */
export function companyNameFor(companyId) {
  return companyStore.get().find(c => c.id === companyId)?.name || '—'
}

// ── Users (company login accounts) ─────────────────────────────────────────

export function useUsers() {
  return useSyncExternalStore(userStore.subscribe, userStore.get, userStore.get)
}

export function addUser(user) {
  const row = { ...user, id: makeId('u') }
  userStore.set(list => [...list, row])
  return row
}

export function updateUser(id, patch) {
  userStore.set(list => list.map(u => (u.id === id ? { ...u, ...patch, id } : u)))
}

export function removeUser(id) {
  userStore.set(list => list.filter(u => u.id !== id))
}

// ── Sub-users ──────────────────────────────────────────────────────────────

export function useSubusers() {
  return useSyncExternalStore(subuserStore.subscribe, subuserStore.get, subuserStore.get)
}

export function addSubuser(subuser) {
  const row = { ...subuser, id: makeId('s') }
  subuserStore.set(list => [...list, row])
  return row
}

export function updateSubuser(id, patch) {
  subuserStore.set(list => list.map(s => (s.id === id ? { ...s, ...patch, id } : s)))
}

export function removeSubuser(id) {
  subuserStore.set(list => list.filter(s => s.id !== id))
}

// ── Vehicles ───────────────────────────────────────────────────────────────
// One store, two readers: the Vehicle page owns the records, and the sub-user
// assignment panel picks from the same list — so a vehicle added on one shows
// up on the other without any wiring between the pages.

export function useVehicles() {
  return useSyncExternalStore(vehicleStore.subscribe, vehicleStore.get, vehicleStore.get)
}

export function addVehicle(vehicle) {
  const row = { ...vehicle, id: makeId('v') }
  vehicleStore.set(list => [...list, row])
  return row
}

export function updateVehicle(id, patch) {
  vehicleStore.set(list => list.map(v => (v.id === id ? { ...v, ...patch, id } : v)))
}

export function removeVehicle(id) {
  vehicleStore.set(list => list.filter(v => v.id !== id))
  // A sub-user assigned to this vehicle would otherwise keep a dangling id,
  // which inflates its "n of m" count above the fleet it can actually see.
  subuserStore.set(list => list.map(s => (
    s.vehicleIds.includes(id)
      ? { ...s, vehicleIds: s.vehicleIds.filter(x => x !== id) }
      : s
  )))
  // Same for an alert scoped to specific vehicles: "3 vehicles" should not
  // outlive the vehicles. Alerts set to all-vehicles hold no ids and are
  // untouched — they simply cover one fewer vehicle from now on.
  alertStore.set(list => list.map(a => (
    a.vehicleIds.includes(id)
      ? { ...a, vehicleIds: a.vehicleIds.filter(x => x !== id) }
      : a
  )))
}

/** Every vehicle belonging to one company; empty array for an unknown id. */
export function vehiclesForCompany(companyId) {
  if (!companyId) return []
  return vehicleStore.get().filter(v => v.companyId === companyId)
}

/** Every branch belonging to one company — the Vehicle form's Branch options. */
export function branchesForCompany(companyId) {
  if (!companyId) return []
  return branchStore.get().filter(b => b.companyId === companyId)
}

/** Branch name for a vehicle row, tolerant of an id that no longer resolves. */
export function branchNameFor(branchId) {
  if (!branchId) return '—'
  return branchStore.get().find(b => b.id === branchId)?.name || '—'
}

// ── Uniqueness ─────────────────────────────────────────────────────────────
/**
 * `exceptId` is the record being edited, excluded so a form does not flag a
 * value against the very row it belongs to. A new record passes id `null`,
 * which matches nothing since every saved id is a string.
 */

// Emails are compared case-insensitively: treating Ops@x.ae and ops@x.ae as
// two different logins is the duplicate this check exists to prevent.
const normEmail = v => String(v ?? '').trim().toLowerCase()

/** True when another vehicle already carries this IMEI. */
export function isImeiTaken(imei, exceptId = null) {
  const v = String(imei ?? '').trim()
  if (!v) return false
  return vehicleStore.get().some(x => x.id !== exceptId && String(x.imei ?? '').trim() === v)
}

/** True when another user account already uses this email. */
export function isUserEmailTaken(email, exceptId = null) {
  const v = normEmail(email)
  if (!v) return false
  return userStore.get().some(u => u.id !== exceptId && normEmail(u.email) === v)
}

/** True when another sub-user already uses this email. */
export function isSubuserEmailTaken(email, exceptId = null) {
  const v = normEmail(email)
  if (!v) return false
  return subuserStore.get().some(s => s.id !== exceptId && normEmail(s.email) === v)
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export function useAlerts() {
  return useSyncExternalStore(alertStore.subscribe, alertStore.get, alertStore.get)
}

export function addAlert(alert) {
  const row = { ...alert, id: makeId('a') }
  alertStore.set(list => [...list, row])
  return row
}

export function updateAlert(id, patch) {
  alertStore.set(list => list.map(a => (a.id === id ? { ...a, ...patch, id } : a)))
}

export function removeAlert(id) {
  alertStore.set(list => list.filter(a => a.id !== id))
}
