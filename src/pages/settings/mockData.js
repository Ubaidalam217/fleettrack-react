import { useMemo, useSyncExternalStore } from 'react'
import { defaultUserSetting } from './subuserSchema'
// Real mode keeps the stores and selectors below but replaces their data source.
// See the note above the localStorage section for what that changes.
import { IS_REAL as REAL_MODE } from '../../data/mode'

/**
 * Phase 2 mock backend for the Settings module.
 *
 * Everything here is in-memory: no fetch, no persistence, no Flespi. The point
 * of the file is the seam — pages only ever touch the const INDENT = '    '   // one level, as literal NBSPs
const GUIDE  = '└ '                       // └ + NBSP

export function branchOptionLabel(branch) {
  const depth = branch?.depth ?? 0
  if (!depth) return branch?.name ?? ''
  return INDENT.repeat(depth) + GUIDE + branch.name
}
ported hooks and
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

/**
 * Org hierarchy, in the client's vocabulary:
 *
 *   Super Admin > GGB > Group (optional) > BG > Branch > Sub-branches > Vehicles
 *
 * The store keys predate that vocabulary and deliberately keep the old names —
 * a GGB is a `reseller` row, a BG is a `company` row, and a vehicle still
 * points at `companyId`. Renaming the keys would touch every page, every seed
 * and every persisted blob in a browser, to buy nothing the display labels do
 * not already buy. The mapping lives here and nowhere else:
 *
 *   reseller  → GGB (Group Global Admin)
 *   company   → BG (Business Group)
 *   group     → Group (unchanged)
 *
 * GGB and Group are entities with their own stores, so a BG points at them by
 * id. A BG's `groupId` is nullable: when it is empty the BG acts as its own
 * group, which is why grouping labels render "— (own group)" rather than an
 * empty cell.
 *
 * Branches nest to any depth via `parentBranchId` — see emptyBranch() and the
 * branch tree helpers further down.
 */

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

export function emptyReseller() {
  return { id: null, name: '', email: '' }
}

export function emptyGroup() {
  return { id: null, resellerId: '', name: '' }
}

export function emptyCompany() {
  return {
    id: null,
    resellerId: '',
    // Nullable by design — blank means this company is its own group.
    groupId:    '',
    name:       '',
    // Becomes the account's login username in a later phase, which is why it
    // is required here rather than optional like the address block used to be.
    email:      '',
  }
}

/**
 * A branch, or a sub-branch of one.
 *
 * `parentBranchId` is '' for a top-level branch and otherwise the id of another
 * branch *of the same BG*. There is no depth limit: a sub-branch can itself be
 * a parent. `companyId` stays required at every depth rather than being
 * inherited from the parent, so one read answers "which BG owns this row"
 * without walking the chain — and so a row whose parent has gone missing is
 * still attributable.
 */
export function emptyBranch() {
  return {
    id: null,
    companyId:      '',
    parentBranchId: '',
    name:           '',
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
    // The join key for sub-user assignment and alert scope. Everything else on
    // this record can change shape; this one cannot without breaking both.
    companyId:     '',
    branchId:      '',
    // Normally derived from the company's groupId; selectable only when the
    // company has no group of its own.
    groupId:       '',
    // Free text for now. The client has not defined a Sub-Group entity; when
    // they do, this becomes a subGroupId pointing at its own store, the same
    // way groupId does here.
    subGroup:      '',
    vehicleNumber: '',
    // An internal identifier of the operator's own choosing — deliberately
    // distinct from the IMEI, which belongs to the tracking device.
    vehicleId:     '',
    imei:          '',
    odometer:      '',
    make:          '',
    model:         '',
    // The SIM number in the tracking unit and the unit's own model. Both are
    // asset paperwork rather than telemetry — Flespi reports neither — and both
    // are read by the Live Map's vehicle panel. Added after the Vehicle form
    // was written, so they are edited from the Live Map Console and simply
    // ride along untouched when a row is saved from Settings.
    mobileNo:      '',
    deviceType:    '',
  }
}

/**
 * Display label for a vehicle, used by the sub-user assignment panel and the
 * alert scope picker as well as this module's own tables.
 *
 * Centralised because those panels previously read `v.name || v.plateNo`
 * directly, and both of those fields have now been replaced — a hardcoded
 * field name there is how a shape change silently blanks every row.
 */
export function vehicleLabel(v) {
  if (!v) return '—'
  return v.vehicleNumber || v.vehicleId || v.imei || '—'
}

/** Secondary identifiers for the same panels; skips whatever is not set. */
export function vehicleSubLabel(v) {
  if (!v) return ''
  const makeModel = [v.make, v.model].filter(Boolean).join(' ')
  return [v.vehicleId, v.imei, makeModel].filter(Boolean).join(' · ')
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
//
// The six-tab form (see subuserSchema.js) added everything below the original
// five fields. All of it is additive and every key has a default, so rows
// written before the tabs existed — the seeds included — still load: see
// normalizeSubuser(), which is what the form reads through. That is why the
// storage key did not need a version bump.
//
// Deliberately absent: `confirmUsername` and `retypePassword`. Both are
// confirmation inputs the form validates against Email and Password, and a
// stored second copy of a credential is how the two drift apart.
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
    // A sub-user can be scoped to several branches as well as several
    // vehicles; the two lists are independent.
    branchIds:  [],

    // ── My Account ──
    shareVia:              { email: false, sms: false },
    mobileNumber:          '',
    enableSecurityPin:     false,
    passwordRecoveryEmail: '',

    // ── Data Access ──
    // 'object' | 'objectGroup'. Object Group has no entity in FleetmaX yet, so
    // the form offers the choice the reference shows but can only act on
    // 'object' — see the note on that tab.
    selectionMode: 'object',

    // ── Screen Access ──
    // { [screenRoute]: 'none'|'view'|'modify'|'addDelete'|'customize' }.
    // Sparse on purpose: an absent screen reads as DEFAULT_PERMISSION, so
    // adding a screen to the catalogue never has to migrate stored rows.
    permissions: {},

    // ── User Setting ──
    userSetting: defaultUserSetting(),

    // ── Authentication ──
    authRequiredFor: [],
    deleteAuthFor:   [],

    // ── SSO ──
    ssoProviders: [],
  }
}

/**
 * A stored sub-user widened to the full shape.
 *
 * Every read path for the form goes through here, so a row saved by an older
 * build — or a seed that predates the tabs — arrives with every key present
 * and the arrays copied. Without the copies an edit would mutate the stored
 * row in place and a Cancel would not actually cancel.
 */
export function normalizeSubuser(row) {
  const base = emptySubuser()
  if (!row) return base
  return {
    ...base,
    ...row,
    vehicleIds:      Array.isArray(row.vehicleIds) ? [...row.vehicleIds] : [],
    branchIds:       Array.isArray(row.branchIds)  ? [...row.branchIds]  : [],
    shareVia:        { ...base.shareVia,    ...(row.shareVia    || {}) },
    permissions:     { ...(row.permissions || {}) },
    userSetting:     { ...base.userSetting, ...(row.userSetting || {}) },
    authRequiredFor: Array.isArray(row.authRequiredFor) ? [...row.authRequiredFor] : [],
    deleteAuthFor:   Array.isArray(row.deleteAuthFor)   ? [...row.deleteAuthFor]   : [],
    ssoProviders:    Array.isArray(row.ssoProviders)
      ? row.ssoProviders.map(p => ({ ...p }))
      : [],
  }
}

// ── Seed rows ──────────────────────────────────────────────────────────────

const SEED_COMPANIES = [
  // c4 deliberately has no group — it is its own group, which is the case the
  // Company table and the Vehicle form both have to render without looking
  // broken.
  { id: 'c1', resellerId: 'r1', groupId: 'g1', name: 'Al Habtoor Logistics',  email: 'hassan@alhabtoorlog.ae' },
  { id: 'c2', resellerId: 'r2', groupId: 'g3', name: 'Desert Rose Transport', email: 'ops@desertrose.ae' },
  { id: 'c3', resellerId: 'r3', groupId: 'g4', name: 'Emirates Cold Chain',   email: 'y.kareem@emiratescold.ae' },
  { id: 'c4', resellerId: 'r1', groupId: '',   name: 'Northern Gulf Haulage', email: 'a.nasser@ngh.sa' },
]

const SEED_RESELLERS = [
  { id: 'r1', name: 'FleetmaX Solutions',     email: 'partners@fleetmax.ae' },
  { id: 'r2', name: 'Solves Inn',             email: 'hello@solvesinn.com' },
  { id: 'r3', name: 'Gulf Telematics LLC',    email: 'sales@gulftelematics.ae' },
  { id: 'r4', name: 'Emirates Fleet Systems', email: '' },
  { id: 'r5', name: 'Al Nahda Trading',       email: '' },
]

const SEED_GROUPS = [
  { id: 'g1', resellerId: 'r1', name: 'Abu Dhabi Operations' },
  { id: 'g2', resellerId: 'r1', name: 'Western Region' },
  { id: 'g3', resellerId: 'r2', name: 'Dubai Metro' },
  { id: 'g4', resellerId: 'r3', name: 'Cold Chain Division' },
]

// Seeded three deep under Mussafah Depot on purpose: two levels would read as
// "branch and sub-branch" and leave the unlimited part untested, so the tree
// rendering, the cycle exclusion and the subtree delete all have a real case to
// exercise from first load.
const SEED_BRANCHES = [
  { id: 'b1', companyId: 'c1', parentBranchId: '',   name: 'Mussafah Depot' },
  { id: 'b5', companyId: 'c1', parentBranchId: 'b1', name: 'Mussafah — Bay 1' },
  { id: 'b6', companyId: 'c1', parentBranchId: 'b1', name: 'Mussafah — Bay 2' },
  { id: 'b7', companyId: 'c1', parentBranchId: 'b6', name: 'Bay 2 — Night Shift' },
  { id: 'b2', companyId: 'c1', parentBranchId: '',   name: 'Al Ain Yard' },
  { id: 'b3', companyId: 'c2', parentBranchId: '',   name: 'Jebel Ali Hub' },
  { id: 'b8', companyId: 'c2', parentBranchId: 'b3', name: 'JA — Container Yard' },
  { id: 'b4', companyId: 'c3', parentBranchId: '',   name: 'Sharjah Cold Store' },
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
// `imei` is the key that matches a row here against a Flespi device — see
// settingsProfileForImei() below, which is what the Live Map's vehicle panel
// reads. `fleetNo` and `type` predate the Vehicle form and it does not collect
// them — they stay on the seeds as extra identifiers and are simply absent on
// anything added since.
const SEED_VEHICLES = [
  { id: 'v1', companyId: 'c1', branchId: 'b1', groupId: 'g1', subGroup: 'Heavy',  vehicleNumber: 'AD 12345-G1', vehicleId: 'FL-01', imei: '863071011234501', odometer: '184320', make: 'Volvo',      model: 'FH16',     deviceType: 'Teltonika FMB920', mobileNo: '+971 50 111 2201' },
  { id: 'v2', companyId: 'c1', branchId: 'b1', groupId: 'g1', subGroup: 'Heavy',  vehicleNumber: 'AD 55401-B2', vehicleId: 'FL-02', imei: '863071011234502', odometer: '96110',  make: 'Volvo',      model: 'FH16',     deviceType: 'Teltonika FMB920', mobileNo: '+971 50 111 2202' },
  { id: 'v3', companyId: 'c1', branchId: 'b2', groupId: 'g1', subGroup: 'Light',  vehicleNumber: 'AD 77120-A4', vehicleId: 'FL-03', imei: '863071011234503', odometer: '52400',  make: 'Toyota',     model: 'HiAce',    deviceType: 'Teltonika FMB130', mobileNo: '+971 50 111 2203' },
  { id: 'v4', companyId: 'c1', branchId: '',   groupId: 'g1', subGroup: '',       vehicleNumber: 'AD 30988-C1', vehicleId: 'FL-04', imei: '863071011234504', odometer: '31875',  make: 'Nissan',     model: 'Navara',   deviceType: 'Teltonika FMB130', mobileNo: '' },
  { id: 'v5', companyId: 'c2', branchId: 'b3', groupId: 'g3', subGroup: 'Trunk',  vehicleNumber: 'DXB 44012-K', vehicleId: 'DR-01', imei: '863071011234505', odometer: '240900', make: 'Scania',     model: 'R450',     deviceType: 'Queclink GV300',   mobileNo: '+971 55 404 7701' },
  { id: 'v6', companyId: 'c2', branchId: 'b3', groupId: 'g3', subGroup: 'City',   vehicleNumber: 'DXB 88231-M', vehicleId: 'DR-02', imei: '863071011234506', odometer: '68240',  make: 'Ford',       model: 'Transit',  deviceType: 'Queclink GV300',   mobileNo: '+971 55 404 7702' },
  { id: 'v7', companyId: 'c2', branchId: '',   groupId: 'g3', subGroup: '',       vehicleNumber: 'DXB 10577-P', vehicleId: 'DR-03', imei: '863071011234507', odometer: '155300', make: 'Mercedes',   model: 'Actros',   deviceType: '',                 mobileNo: '' },
  { id: 'v8', companyId: 'c3', branchId: 'b4', groupId: 'g4', subGroup: 'Reefer', vehicleNumber: 'SHJ 20114-T', vehicleId: 'EC-01', imei: '863071011234508', odometer: '78450',  make: 'Isuzu',      model: 'NQR',      deviceType: 'Teltonika FMC130', mobileNo: '+971 56 882 3310' },
  { id: 'v9', companyId: 'c3', branchId: 'b4', groupId: 'g4', subGroup: 'Reefer', vehicleNumber: 'SHJ 66302-R', vehicleId: 'EC-02', imei: '863071011234509', odometer: '91020',  make: 'Isuzu',      model: 'NQR',      deviceType: 'Teltonika FMC130', mobileNo: '+971 56 882 3311' },
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
  { id: 's1', companyId: 'c1', name: 'Mussafah Dispatch', email: 'dispatch@alhabtoorlog.ae', password: DEFAULT_PASSWORD, vehicleIds: ['v1', 'v2'], branchIds: ['b1'] },
  { id: 's2', companyId: 'c2', name: 'Jebel Ali Ops',     email: 'jebelali@desertrose.ae',   password: DEFAULT_PASSWORD, vehicleIds: ['v5', 'v6', 'v7'], branchIds: ['b3'] },
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
 * The key is versioned — bump it and every browser holding the old shape falls
 * back to seed on next load rather than hydrating rows that no longer match the
 * form. v3 is the nested-branch shape: v2 branches have no `parentBranchId`, so
 * hydrating them would render a tree with every row silently at the top level.
 */
const STORAGE_KEY = 'fleetmax-mock-v3'

/**
 * Phase 2: in real mode this file is still the store, but not the data source.
 *
 * The stores and every selector below are shared by both modes — real mode fills
 * the same arrays from the API (see data/settings.js), translated into the shapes
 * this file already uses. That is what lets `branchTreeForCompany`,
 * `settingsProfileForImei`, `isImeiTaken` and ~30 others work unchanged against
 * live data instead of being reimplemented.
 *
 * Only two things must differ, and both are below:
 *
 *  - the stores start EMPTY rather than seeded, so a real session never flashes
 *    fictional GGBs before the first fetch resolves;
 *  - persist() is a no-op, so live tenant data is never written into the mock's
 *    localStorage key — where it would reappear as "mock data" the next time
 *    someone ran without VITE_API_URL.
 *
 * In mock mode REAL_MODE is false and every path below is byte-for-byte what it
 * was before this phase.
 */

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

// Real mode has a server to read from, so the saved blob is not even consulted.
const saved = REAL_MODE ? null : readSaved()

// Only accept a saved slice that is still the right shape.
// Real mode starts empty: the hydrator in data/settings.js fills these from the
// API, and seeding first would show fictional rows for one frame.
const hydrate = (key, seed) =>
  REAL_MODE ? [] : Array.isArray(saved?.[key]) ? saved[key] : [...seed]

function persist() {
  if (REAL_MODE) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      // The id counter rides along with the rows. Saving rows but not the
      // counter would restart it at 100 after a refresh and re-issue ids that
      // the saved data already uses.
      nextId,
      resellers: resellerStore.get(),
      groups:    groupStore.get(),
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

const resellerStore = createStore(hydrate('resellers', SEED_RESELLERS))
const groupStore    = createStore(hydrate('groups',    SEED_GROUPS))
const companyStore = createStore(hydrate('companies', SEED_COMPANIES))
const branchStore  = createStore(hydrate('branches',  SEED_BRANCHES))
const userStore    = createStore(hydrate('users',     SEED_USERS))
const subuserStore = createStore(hydrate('subusers',  SEED_SUBUSERS))
const vehicleStore = createStore(hydrate('vehicles',  SEED_VEHICLES))
const alertStore   = createStore(hydrate('alerts',    SEED_ALERTS))

let nextId = Number.isFinite(saved?.nextId) ? saved.nextId : 100
const makeId = prefix => `${prefix}${nextId++}`

/**
 * Real-mode entry point: replace one store's rows wholesale.
 *
 * Used only by data/settings.js after a fetch. A whole-array replacement rather
 * than a merge because the server is authoritative — a merge would keep a row the
 * server has deleted, and "deleted elsewhere but still on my screen" is the exact
 * staleness this is meant to avoid.
 *
 * Rows must already be in this file's shape; adapters.js does that conversion.
 * The double-underscore marks it as plumbing: no page calls it.
 */
const STORES = {
  resellers: resellerStore,
  groups: groupStore,
  companies: companyStore,
  branches: branchStore,
  users: userStore,
  subusers: subuserStore,
  vehicles: vehicleStore,
  alerts: alertStore,
}

export function __replaceStore(key, rows) {
  const store = STORES[key]
  if (!store) throw new Error(`__replaceStore: unknown store "${key}"`)
  store.set(Array.isArray(rows) ? rows : [])
}

/**
 * One store's current rows, outside React.
 *
 * The exported use*() hooks cover every component; this is for the mutators in
 * data/settings.js, which need to compare a submitted row against the stored one
 * (has the sub-user's BG changed?) from a plain async function.
 */
export function __snapshot(key) {
  const store = STORES[key]
  if (!store) throw new Error(`__snapshot: unknown store "${key}"`)
  return store.get()
}

/** The store keys, so the hydrator does not hardcode a list that can drift. */
export const __STORE_KEYS = Object.keys(STORES)

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
  resellerStore.set([...SEED_RESELLERS])
  groupStore.set([...SEED_GROUPS])
  companyStore.set([...SEED_COMPANIES])
  branchStore.set([...SEED_BRANCHES])
  userStore.set([...SEED_USERS])
  subuserStore.set([...SEED_SUBUSERS])
  vehicleStore.set([...SEED_VEHICLES])
  alertStore.set([...SEED_ALERTS])
  // Each set() above persisted already; this one carries the reset counter.
  persist()
}

// Mock-mode only. In real mode there is no seed to reset to and nothing in
// localStorage, so advertising fleetmaxResetData() would offer a developer a
// button that silently does nothing to the data they are actually looking at.
if (typeof window !== 'undefined' && !REAL_MODE) {
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

/**
 * Every branch below `branchId`, at any depth. Excludes the branch itself.
 *
 * Iterative rather than recursive, with a `seen` set: stored data can be
 * hand-edited or restored from an older shape, and a parent chain that loops
 * would otherwise recurse until the stack gives out. Callers get a plain array
 * either way.
 */
export function branchDescendantIds(branchId) {
  if (!branchId) return []
  const all = branchStore.get()
  const out = []
  const seen = new Set([branchId])
  const stack = [branchId]
  while (stack.length) {
    const parent = stack.pop()
    for (const b of all) {
      if (b.parentBranchId === parent && !seen.has(b.id)) {
        seen.add(b.id)
        out.push(b.id)
        stack.push(b.id)
      }
    }
  }
  return out
}

/** A branch plus everything under it — what a delete actually removes. */
export function branchSubtreeIds(branchId) {
  return branchId ? [branchId, ...branchDescendantIds(branchId)] : []
}

/**
 * One BG's branches, flattened depth-first with a `depth` on each row: the
 * order and indentation the table and both pickers render from.
 *
 * Two guards, both about never losing a row from the page:
 *  - a `parentBranchId` that does not resolve inside this BG (deleted parent,
 *    or a parent belonging to another BG) is treated as top-level rather than
 *    dropped, so the row stays visible and therefore fixable;
 *  - anything left unvisited after the walk sat in a parent cycle, and is
 *    appended flat for the same reason.
 */
export function branchTreeForCompany(companyId) {
  if (!companyId) return []
  const all  = branchStore.get().filter(b => b.companyId === companyId)
  const byId = new Map(all.map(b => [b.id, b]))

  const childrenOf = new Map()
  for (const b of all) {
    const parent = b.parentBranchId && byId.has(b.parentBranchId) ? b.parentBranchId : ''
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(b)
  }

  const out  = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const b of childrenOf.get(parent) || []) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      out.push({ ...b, depth })
      walk(b.id, depth + 1)
    }
  }
  walk('', 0)
  for (const b of all) if (!seen.has(b.id)) out.push({ ...b, depth: 0 })
  return out
}

/**
 * Indented label for a branch inside a native <select>.
 *
 * Non-breaking spaces rather than CSS padding because an <option> ignores
 * padding in most browsers — this is the one place where whitespace in the
 * string is the mechanism rather than a workaround.
 */
// One indent level and the child guide, written as escapes: these are
// non-breaking spaces, and a literal NBSP in source is invisible to the next
// person to touch this line and is exactly what an editor's trim-whitespace
// setting eats without anyone noticing.
const BRANCH_INDENT = '\u00A0\u00A0\u00A0\u00A0'
const BRANCH_GUIDE  = '\u2514\u00A0'

export function branchOptionLabel(branch) {
  const depth = branch?.depth ?? 0
  if (!depth) return branch?.name ?? ''
  return BRANCH_INDENT.repeat(depth) + BRANCH_GUIDE + branch.name
}

/**
 * Deletes a branch AND everything under it — a sub-branch cannot outlive its
 * parent without becoming unreachable from the tree.
 *
 * Returns a summary so the page can say what happened: the caller has already
 * shown a count in the confirm dialog, and detached vehicles are worth a toast
 * because nothing else on screen would reveal them.
 */
export function removeBranch(id) {
  const doomed = new Set(branchSubtreeIds(id))
  if (!doomed.size) return { removed: 0, subBranches: 0, vehiclesDetached: 0 }

  // Counted before the write, while the rows still point at the old ids.
  const vehiclesDetached = vehicleStore.get().filter(v => doomed.has(v.branchId)).length

  branchStore.set(list => list.filter(b => !doomed.has(b.id)))

  // A sub-user scoped to any of these branches would otherwise keep a dangling
  // id and report a branch count higher than the branches it can actually see —
  // the same cleanup removeVehicle already does for vehicle ids.
  subuserStore.set(list => list.map(s => (
    s.branchIds?.some(x => doomed.has(x))
      ? { ...s, branchIds: s.branchIds.filter(x => !doomed.has(x)) }
      : s
  )))

  // A vehicle keeps its BG and simply stops being filed under a branch. '' and
  // not null: the Vehicle form binds this straight into a <select value>, and
  // null would flip that control to uncontrolled mid-edit.
  vehicleStore.set(list => list.map(v => (
    doomed.has(v.branchId) ? { ...v, branchId: '' } : v
  )))

  return { removed: doomed.size, subBranches: doomed.size - 1, vehiclesDetached }
}

/** BG name for a branch row, tolerant of an id that no longer resolves. */
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

/** Every vehicle belonging to one BG; empty array for an unknown id. */
export function vehiclesForCompany(companyId) {
  if (!companyId) return []
  return vehicleStore.get().filter(v => v.companyId === companyId)
}

/**
 * Every branch belonging to one BG, at every depth, in no particular order.
 *
 * This is the *set* — "how many branches does this BG have", and what
 * "All Branches" covers. Anything that draws the hierarchy wants
 * branchTreeForCompany instead, which returns the same rows ordered and
 * carrying a depth.
 */
export function branchesForCompany(companyId) {
  if (!companyId) return []
  return branchStore.get().filter(b => b.companyId === companyId)
}

/** Branch name for a vehicle row, tolerant of an id that no longer resolves. */
export function branchNameFor(branchId) {
  if (!branchId) return '—'
  return branchStore.get().find(b => b.id === branchId)?.name || '—'
}

// ── Flespi ↔ Settings link ─────────────────────────────────────────────────
// The Live Map shows Flespi devices; BG, Group, Sub-Group, make/model and the
// ODO reading only exist here. The IMEI is the only identifier both sides
// carry, so it is the join key.

/**
 * Comparison key for an IMEI. Digits only, because the two sides arrive from
 * different places: Settings collects the IMEI by hand (so it can carry a
 * space or a stray dash) while Flespi reports it from the device's
 * `configuration.ident`. Comparing the raw strings would miss a match any
 * human would call obvious.
 */
export function imeiKey(imei) {
  return String(imei ?? '').replace(/\D/g, '')
}

/** The Settings vehicle registered to this IMEI, or null when there is none. */
export function vehicleByImei(imei) {
  const key = imeiKey(imei)
  if (!key) return null
  return vehicleStore.get().find(v => imeiKey(v.imei) === key) ?? null
}

/**
 * Everything the Live Map's vehicle panel needs about a device's Settings
 * registration, resolved and flattened: a BG *name* rather than a companyId, a
 * group name rather than a groupId.
 *
 * `linked: false` is a first-class answer rather than an error — a device that
 * has never been registered under Settings > Object > Vehicle is the normal
 * state for a tracker that was just added to the Flespi account, and the panel
 * says so instead of rendering blanks that look like a bug.
 */
export function settingsProfileForImei(imei) {
  const key = imeiKey(imei)
  const row = vehicleByImei(imei)
  if (!row) return { linked: false, imeiKey: key, vehicle: null }

  const company = companyStore.get().find(c => c.id === row.companyId) ?? null
  // The vehicle's own groupId is authoritative: the Vehicle form copies the
  // BG's group into it on save, and only leaves it free to choose when the BG
  // has no group of its own. Falling back to the company covers rows written
  // before that rule existed.
  const groupId = row.groupId || company?.groupId || ''

  return {
    linked:     true,
    imeiKey:    key,
    vehicle:    row,
    bgId:       row.companyId,
    bgName:     company?.name || '—',
    groupName:  groupId ? groupNameFor(groupId) : (company ? 'BG is its own group' : '—'),
    branchName: branchNameFor(row.branchId),
    subGroup:   row.subGroup   || '',
    plateNo:    row.vehicleNumber || '',
    // `vehicleId` is the operator's own identifier for the asset, and Fleet No
    // is what the Live Map calls it — the same field under the two names each
    // side of the app grew up with.
    fleetNo:    row.vehicleId  || '',
    make:       row.make       || '',
    model:      row.model      || '',
    makeModel:  [row.make, row.model].filter(Boolean).join(' '),
    deviceType: row.deviceType || '',
    mobileNo:   row.mobileNo   || '',
    // No odometer here on purpose. The Settings record still carries one (the
    // Vehicle form collects it), but the Live Map's ODO Reading is the
    // tracker's own figure — one odometer, from the device that measures it.
  }
}

/**
 * Live version of settingsProfileForImei for the vehicle panel.
 *
 * Subscribes to all four stores the profile reads from, not just vehicles: a
 * BG renamed on the Company page has to change the panel's BG Name, and that
 * write never touches the vehicle row. Each hook returns a reference-stable
 * array, so the memo only recomputes when one of them is actually replaced.
 */
export function useSettingsProfile(imei) {
  const vehicles  = useVehicles()
  const companies = useCompanies()
  const groups    = useGroups()
  const branches  = useBranches()
  return useMemo(
    () => settingsProfileForImei(imei),
    [imei, vehicles, companies, groups, branches]
  )
}

// ── Resellers ──────────────────────────────────────────────────────────────

export function useResellers() {
  return useSyncExternalStore(resellerStore.subscribe, resellerStore.get, resellerStore.get)
}

export function addReseller(reseller) {
  const row = { ...reseller, id: makeId('r') }
  resellerStore.set(list => [...list, row])
  return row
}

export function updateReseller(id, patch) {
  resellerStore.set(list => list.map(r => (r.id === id ? { ...r, ...patch, id } : r)))
}

export function removeReseller(id) {
  resellerStore.set(list => list.filter(r => r.id !== id))
}

/** GGB name for a row, tolerant of an id that no longer resolves. */
export function resellerNameFor(resellerId) {
  if (!resellerId) return '—'
  return resellerStore.get().find(r => r.id === resellerId)?.name || '—'
}

// ── Groups ─────────────────────────────────────────────────────────────────

export function useGroups() {
  return useSyncExternalStore(groupStore.subscribe, groupStore.get, groupStore.get)
}

export function addGroup(group) {
  const row = { ...group, id: makeId('g') }
  groupStore.set(list => [...list, row])
  return row
}

export function updateGroup(id, patch) {
  groupStore.set(list => list.map(g => (g.id === id ? { ...g, ...patch, id } : g)))
}

export function removeGroup(id) {
  groupStore.set(list => list.filter(g => g.id !== id))
}

/** Every group under one GGB — the BG form's Group options. */
export function groupsForReseller(resellerId) {
  if (!resellerId) return []
  return groupStore.get().filter(g => g.resellerId === resellerId)
}

/** Group name for a row, tolerant of an id that no longer resolves. */
export function groupNameFor(groupId) {
  if (!groupId) return '—'
  return groupStore.get().find(g => g.id === groupId)?.name || '—'
}

/**
 * How a BG's group reads in a table. A BG with no group is its own group,
 * which is a real state rather than missing data — so it gets a label of its
 * own instead of a bare dash.
 */
export function groupLabelForCompany(company) {
  if (!company) return '—'
  return company.groupId ? groupNameFor(company.groupId) : '— (own group)'
}

/** The groups a vehicle may belong to, derived from its BG's GGB. */
export function groupsForCompany(companyId) {
  const company = companyStore.get().find(c => c.id === companyId)
  if (!company) return []
  return groupsForReseller(company.resellerId)
}

/** A BG's own group id, or '' when it acts as its own group. */
export function groupIdForCompany(companyId) {
  return companyStore.get().find(c => c.id === companyId)?.groupId || ''
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

/** True when another BG already uses this email (it is their login). */
export function isCompanyEmailTaken(email, exceptId = null) {
  const v = normEmail(email)
  if (!v) return false
  return companyStore.get().some(c => c.id !== exceptId && normEmail(c.email) === v)
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
