/**
 * The fixture every scoping test asserts against, and the helpers to drive it.
 *
 * Two GGBs, built so that every role's scope is a *different* non-trivial subset
 * of the data. A fixture where two roles happen to see the same rows proves
 * nothing — the test would pass with the scope helper deleted.
 *
 *   ggbA  "Gulf Telematics"
 *     groupA1  "Dubai Metro"
 *       bgA1a  "Al Habtoor Logistics"   branches: depot → bay1 → nightShift, yard
 *                                       vehicles: v1 v2 v3 v4
 *       bgA1b  "Desert Rose Transport"  branches: jebelAli
 *                                       vehicles: v5 v6
 *     bgA2     "Northern Gulf Haulage"  groupId: null — its own group
 *                                       vehicles: v7
 *   ggbB  "Emirates Fleet Systems"
 *     groupB1  "Cold Chain Division"
 *       bgB1a  "Emirates Cold Chain"    branches: sharjah
 *                                       vehicles: v8 v9
 *
 * Which gives these expected scopes — the table the suite checks row by row:
 *
 *   superAdmin     4 BGs, 9 vehicles
 *   ggbAdminA      3 BGs (A1a A1b A2), 7 vehicles (v1-v7)
 *   ggbAdminB      1 BG  (B1a),        2 vehicles (v8 v9)
 *   groupAdminA1   2 BGs (A1a A1b),    6 vehicles (v1-v6)   ← excludes A2, same GGB
 *   bgUserA1a      1 BG  (A1a),        4 vehicles (v1-v4)
 *   subUserA1a     —                   2 vehicles (v1 v2)   ← the assigned pair
 *
 * groupAdminA1 is the interesting row: bgA2 is in the same GGB but not in the
 * group, so a filter that accidentally widens to the GGB shows 3 BGs and 7
 * vehicles instead of 2 and 6. That is the single assertion most likely to catch
 * a regression in lib/scope.js.
 */

import prisma from '../src/prisma.js'
import { hashPassword } from '../src/lib/password.js'
import { signToken } from '../src/lib/jwt.js'

/** What every fixture account's password is, except where a test says otherwise. */
export const TEST_PASSWORD = 'Test@123456'

/**
 * Empties every table.
 *
 * Table names are read from the catalogue rather than hardcoded, so a new model
 * is included the moment it is migrated — a hardcoded list silently stops
 * truncating the table it was never told about, and the leftover rows show up as
 * an unrelated test failing three files later.
 */
export async function resetDb() {
  const rows = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `
  if (!rows.length) return
  const list = rows.map(r => `"public"."${r.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

async function makeUser({ email, role, ggbId = null, groupId = null, bgId = null, mustChangePassword = false, password = TEST_PASSWORD, status = 'Active', shortName = null }) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role,
      ggbId,
      groupId,
      bgId,
      mustChangePassword,
      status,
      shortName,
    },
  })
}

/**
 * Builds the whole fixture and returns it, plus a bearer token per account.
 *
 * Tokens are minted directly rather than by POSTing to /api/auth/login: the login
 * flow has its own tests, and routing 8 accounts through bcrypt on every one of
 * the suite's beforeEach hooks is the difference between a 4-second run and a
 * 40-second one.
 */
export async function seedFixture() {
  const ggbA = await prisma.ggb.create({
    data: { name: 'Gulf Telematics', email: 'sales@gulftelematics.ae' },
  })
  const ggbB = await prisma.ggb.create({
    data: { name: 'Emirates Fleet Systems', email: null },
  })

  const groupA1 = await prisma.group.create({ data: { name: 'Dubai Metro', ggbId: ggbA.id } })
  // Deliberately has no BGs: a group admin scoped here must see zero BGs and zero
  // vehicles, which is the case an `if (ids.length)` guard gets wrong by
  // returning everything.
  const groupA2 = await prisma.group.create({ data: { name: 'Western Region', ggbId: ggbA.id } })
  const groupB1 = await prisma.group.create({ data: { name: 'Cold Chain Division', ggbId: ggbB.id } })

  const bgA1a = await prisma.businessGroup.create({
    data: {
      name: 'Al Habtoor Logistics',
      email: 'hassan@alhabtoorlog.ae',
      ggbId: ggbA.id,
      groupId: groupA1.id,
    },
  })
  const bgA1b = await prisma.businessGroup.create({
    data: {
      name: 'Desert Rose Transport',
      email: 'ops@desertrose.ae',
      ggbId: ggbA.id,
      groupId: groupA1.id,
    },
  })
  // No group — its own group. In ggbA, so it is inside the GGB admin's scope but
  // outside the group admin's.
  const bgA2 = await prisma.businessGroup.create({
    data: { name: 'Northern Gulf Haulage', email: 'a.nasser@ngh.sa', ggbId: ggbA.id, groupId: null },
  })
  const bgB1a = await prisma.businessGroup.create({
    data: {
      name: 'Emirates Cold Chain',
      email: 'y.kareem@emiratescold.ae',
      ggbId: ggbB.id,
      groupId: groupB1.id,
    },
  })

  // Three deep on purpose: two levels would leave the "unlimited nesting" part of
  // the subtree delete and the cycle check untested.
  const depot = await prisma.branch.create({ data: { name: 'Mussafah Depot', bgId: bgA1a.id } })
  const bay1 = await prisma.branch.create({
    data: { name: 'Mussafah — Bay 1', bgId: bgA1a.id, parentBranchId: depot.id },
  })
  const nightShift = await prisma.branch.create({
    data: { name: 'Bay 1 — Night Shift', bgId: bgA1a.id, parentBranchId: bay1.id },
  })
  const yard = await prisma.branch.create({ data: { name: 'Al Ain Yard', bgId: bgA1a.id } })
  const jebelAli = await prisma.branch.create({ data: { name: 'Jebel Ali Hub', bgId: bgA1b.id } })
  const sharjah = await prisma.branch.create({ data: { name: 'Sharjah Cold Store', bgId: bgB1a.id } })

  const vehicle = (n, bgId, branchId, extra = {}) =>
    prisma.vehicle.create({
      data: {
        bgId,
        branchId,
        imei: `86307101123450${n}`,
        plateNo: `PLATE-${n}`,
        fleetNo: `FL-0${n}`,
        ...extra,
      },
    })

  const v1 = await vehicle(1, bgA1a.id, depot.id, { make: 'Volvo', model: 'FH16' })
  const v2 = await vehicle(2, bgA1a.id, bay1.id, { make: 'Volvo', model: 'FH16' })
  const v3 = await vehicle(3, bgA1a.id, yard.id, { make: 'Toyota', model: 'HiAce' })
  // No branch: the "unfiled vehicle" case a BG user still has to see.
  const v4 = await vehicle(4, bgA1a.id, null, { make: 'Nissan', model: 'Navara' })
  const v5 = await vehicle(5, bgA1b.id, jebelAli.id, { make: 'Scania', model: 'R450' })
  const v6 = await vehicle(6, bgA1b.id, null, { make: 'Ford', model: 'Transit' })
  const v7 = await vehicle(7, bgA2.id, null, { make: 'Mercedes', model: 'Actros' })
  const v8 = await vehicle(8, bgB1a.id, sharjah.id, { make: 'Isuzu', model: 'NQR' })
  const v9 = await vehicle(9, bgB1a.id, sharjah.id, { make: 'Isuzu', model: 'NQR' })

  const superAdmin = await makeUser({ email: 'super@fleetmax.test', role: 'SUPER_ADMIN' })
  const ggbAdminA = await makeUser({ email: 'ggba@fleetmax.test', role: 'GGB_ADMIN', ggbId: ggbA.id })
  const ggbAdminB = await makeUser({ email: 'ggbb@fleetmax.test', role: 'GGB_ADMIN', ggbId: ggbB.id })
  const groupAdminA1 = await makeUser({ email: 'groupa1@fleetmax.test', role: 'GROUP_ADMIN', groupId: groupA1.id })
  const groupAdminA2 = await makeUser({ email: 'groupa2@fleetmax.test', role: 'GROUP_ADMIN', groupId: groupA2.id })
  const bgUserA1a = await makeUser({ email: 'hassan@alhabtoorlog.ae', role: 'BG_USER', bgId: bgA1a.id })
  const bgUserB1a = await makeUser({ email: 'y.kareem@emiratescold.ae', role: 'BG_USER', bgId: bgB1a.id })

  const subUserA1a = await prisma.user.create({
    data: {
      email: 'dispatch@alhabtoorlog.ae',
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: 'SUB_USER',
      bgId: bgA1a.id,
      shortName: 'Mussafah Dispatch',
      mustChangePassword: false,
      // The assigned pair. v3 and v4 are in the same BG and deliberately NOT
      // assigned, so "sees its BG" and "sees its assignments" give different
      // answers and the test can tell which one is in force.
      vehicles: { create: [{ vehicleId: v1.id }, { vehicleId: v2.id }] },
      // A branch assignment that must NOT grant that branch's vehicles this
      // phase: depot holds v1 (assigned) and bay1/nightShift sit under it.
      branches: { create: [{ branchId: depot.id }] },
    },
  })

  // Still on the password it was handed — the first-login flow's subject.
  const freshUser = await makeUser({
    email: 'fresh@alhabtoorlog.ae',
    role: 'BG_USER',
    bgId: bgA1a.id,
    mustChangePassword: true,
    password: 'Aa@123456',
  })

  const inactiveUser = await makeUser({
    email: 'retired@alhabtoorlog.ae',
    role: 'BG_USER',
    bgId: bgA1a.id,
    status: 'Inactive',
  })

  const alertA1a = await prisma.alert.create({
    data: {
      name: 'Reefer temperature breach',
      type: 'temperature',
      bgId: bgA1a.id,
      allVehicles: true,
      minTemp: -18,
      maxTemp: -2,
      notify: { inApp: true, email: true, sms: false },
    },
  })
  const alertB1a = await prisma.alert.create({
    data: {
      name: 'Cold store overheat',
      type: 'temperature',
      bgId: bgB1a.id,
      allVehicles: false,
      maxTemp: 8,
      vehicles: { create: [{ vehicleId: v8.id }] },
    },
  })

  const users = {
    superAdmin,
    ggbAdminA,
    ggbAdminB,
    groupAdminA1,
    groupAdminA2,
    bgUserA1a,
    bgUserB1a,
    subUserA1a,
    freshUser,
    inactiveUser,
  }

  return {
    ggbA,
    ggbB,
    groupA1,
    groupA2,
    groupB1,
    bgA1a,
    bgA1b,
    bgA2,
    bgB1a,
    branches: { depot, bay1, nightShift, yard, jebelAli, sharjah },
    vehicles: { v1, v2, v3, v4, v5, v6, v7, v8, v9 },
    alerts: { alertA1a, alertB1a },
    users,
    tokens: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, signToken(u)])),
  }
}

/** `await get(app, token, '/api/vehicles')` — the shape every test call takes. */
export const auth = token => ({ Authorization: `Bearer ${token}` })
