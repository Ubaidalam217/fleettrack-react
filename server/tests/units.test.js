/**
 * Pure units — no database.
 *
 * Mostly regression pins on library behaviour that is surprising and that the
 * rest of the suite would only catch indirectly. Each one here cost a debugging
 * session to find once.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  booleanField,
  imeiField,
  jsonObject,
  jsonValue,
  optionalEmail,
  optionalId,
  optionalNumber,
  optionalText,
} from '../src/lib/fields.js'
import { buildScope, ROLES, scopedWhere } from '../src/lib/scope.js'
import { buildTree } from '../src/lib/branches.js'
import { normalizeEmail, normalizeImei } from '../src/lib/text.js'
import { publicUser } from '../src/lib/serialize.js'

describe('zod 4 behaviour this codebase depends on', () => {
  /**
   * The one that got away, and the reason this block exists.
   *
   * Every "optional" helper must allow its key to be ABSENT, not merely allow
   * undefined as a value. In Zod 4 those are different things: a union containing
   * z.undefined() plus a .transform() produces a schema that still demands the key
   * and reports "expected nonoptional, received undefined".
   *
   * Testing the helpers in isolation — `optionalText().parse('')` — cannot catch
   * this, because passing a value is exactly the case that works. Only an omitted
   * key inside an object shows it, which is what every assertion here does.
   */
  it('every optional field helper accepts an OMITTED key', () => {
    const schema = z.object({
      text: optionalText(),
      id: optionalId(),
      email: optionalEmail(),
      num: optionalNumber(),
      obj: jsonObject(),
      val: jsonValue(),
      bool: booleanField(true),
    })

    const parsed = schema.safeParse({})
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)

    // And an omitted key reads as null, not undefined — so Prisma writes NULL on a
    // create and CLEARS the column on an update, rather than silently leaving the
    // previous value in place.
    expect(parsed.data).toEqual({
      text: null,
      id: null,
      email: null,
      num: null,
      obj: null,
      val: null,
      bool: true,
    })
  })

  it('a full entity body validates with only its required fields', () => {
    // The integration-level version of the above: this is the exact shape the
    // vehicle create route receives from a minimal client.
    const vehicle = z.object({
      bgId: z.string().min(1),
      branchId: optionalId(),
      subGroup: optionalText(120),
      plateNo: optionalText(60),
      fleetNo: optionalText(60),
      imei: imeiField(),
      make: optionalText(80),
      model: optionalText(80),
      deviceType: optionalText(120),
      mobileNo: optionalText(40),
      vehicleType: optionalText(60),
    })
    const r = vehicle.safeParse({ bgId: 'bg1', imei: '863071011234501' })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    expect(r.data.branchId).toBeNull()
    expect(r.data.make).toBeNull()
  })

  it('jsonValue/jsonObject keys are optional', () => {
    // z.unknown() alone does NOT make a key optional in Zod 4 (it did in Zod 3),
    // so without the explicit .optional() every sub-user tab blob would be
    // mandatory on every create.
    expect(z.object({ x: jsonValue() }).safeParse({}).success).toBe(true)
    expect(z.object({ x: jsonObject() }).safeParse({}).success).toBe(true)
    expect(z.object({ x: jsonValue() }).parse({}).x).toBeNull()
  })

  it('jsonObject rejects a non-object', () => {
    // A string or an array landing in a jsonb column that every reader expects to
    // be a map is the one thing worth validating about an opaque blob.
    expect(jsonObject().safeParse('nope').success).toBe(false)
    expect(jsonObject().safeParse([1, 2]).success).toBe(false)
    expect(jsonObject().safeParse({ a: 1 }).success).toBe(true)
    expect(jsonObject().safeParse(null).success).toBe(true)
  })

  it('booleanField reads the string "false" as false', () => {
    // z.coerce.boolean() is Boolean(value) and gets this exactly backwards. The
    // field it guards decides whether an alert covers one vehicle or the fleet.
    expect(z.coerce.boolean().parse('false')).toBe(true) // the trap, pinned
    expect(booleanField(true).parse('false')).toBe(false)
    expect(booleanField(true).parse('0')).toBe(false)
    expect(booleanField(true).parse('true')).toBe(true)
    expect(booleanField(true).parse(false)).toBe(false)
    expect(booleanField(true).parse(undefined)).toBe(true)
    expect(booleanField(false).parse(undefined)).toBe(false)
    expect(booleanField(true).safeParse('maybe').success).toBe(false)
  })
})

describe('field normalisers', () => {
  it('collapses blank optional text to null', () => {
    expect(optionalText().parse('')).toBeNull()
    expect(optionalText().parse('   ')).toBeNull()
    expect(optionalText().parse(undefined)).toBeNull()
    expect(optionalText().parse('  Volvo ')).toBe('Volvo')
  })

  it('lower-cases and trims emails, and collapses blank to null', () => {
    expect(normalizeEmail('  Ops@X.AE ')).toBe('ops@x.ae')
    expect(optionalEmail().parse('')).toBeNull()
    expect(optionalEmail().parse(' A@B.co ')).toBe('a@b.co')
    expect(optionalEmail().safeParse('not-an-email').success).toBe(false)
  })

  it('strips IMEIs to digits and enforces 10-20', () => {
    expect(normalizeImei('8630 7101-1234 501')).toBe('863071011234501')
    expect(imeiField().parse('8630 7101-1234 501')).toBe('863071011234501')
    for (const bad of ['', '123', 'abcdefghij', '123456789012345678901']) {
      expect(imeiField().safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('reads a temperature bound from a string, and blank as null', () => {
    expect(optionalNumber().parse('')).toBeNull()
    expect(optionalNumber().parse('-18')).toBe(-18)
    expect(optionalNumber().parse(45)).toBe(45)
    expect(optionalNumber().parse('0')).toBe(0) // not null — 0°C is a real bound
    expect(optionalNumber().safeParse('warm').success).toBe(false)
  })
})

describe('scopedWhere per role', () => {
  const scopeFor = role =>
    buildScope({
      id: 'u1',
      role,
      ggbId: 'ggb1',
      groupId: 'grp1',
      bgId: 'bg1',
      vehicles: [{ vehicleId: 'v1' }],
      branches: [{ branchId: 'b1' }],
    })

  it('SUPER_ADMIN filters nothing', () => {
    const s = scopeFor(ROLES.SUPER_ADMIN)
    for (const e of ['ggb', 'group', 'bg', 'branch', 'vehicle', 'user', 'alert']) {
      expect(scopedWhere(e, s), e).toEqual({})
    }
  })

  it('narrows by GGB, group and BG respectively', () => {
    expect(scopedWhere('bg', scopeFor(ROLES.GGB_ADMIN))).toEqual({ ggbId: 'ggb1' })
    expect(scopedWhere('bg', scopeFor(ROLES.GROUP_ADMIN))).toEqual({ groupId: 'grp1' })
    expect(scopedWhere('bg', scopeFor(ROLES.BG_USER))).toEqual({ id: 'bg1' })
  })

  it('uses the scalar bgId column for the two single-BG roles', () => {
    // Hits the bgId index instead of an EXISTS subquery — these are the roles with
    // the most traffic.
    expect(scopedWhere('vehicle', scopeFor(ROLES.BG_USER))).toEqual({ bgId: 'bg1' })
    expect(scopedWhere('vehicle', scopeFor(ROLES.GGB_ADMIN))).toEqual({ bg: { ggbId: 'ggb1' } })
  })

  it('gives roles below GGB no GGB or group visibility', () => {
    const none = { id: { in: [] } }
    for (const role of [ROLES.GROUP_ADMIN, ROLES.BG_USER, ROLES.SUB_USER]) {
      expect(scopedWhere('ggb', scopeFor(role)), role).toEqual(none)
    }
    expect(scopedWhere('group', scopeFor(ROLES.BG_USER))).toEqual(none)
    expect(scopedWhere('group', scopeFor(ROLES.GROUP_ADMIN))).toEqual({ id: 'grp1' })
  })

  it('narrows a SUB_USER to its assignments, keeping the BG constraint as well', () => {
    const s = scopeFor(ROLES.SUB_USER)
    expect(scopedWhere('vehicle', s)).toEqual({
      AND: [{ bgId: 'bg1' }, { id: { in: ['v1'] } }],
    })
    expect(scopedWhere('branch', s)).toEqual({
      AND: [{ bgId: 'bg1' }, { id: { in: ['b1'] } }],
    })
    expect(scopedWhere('user', s)).toEqual({ id: 'u1' })
  })

  it('a SUB_USER with no assignments matches nothing, not everything', () => {
    const s = buildScope({ id: 'u1', role: ROLES.SUB_USER, bgId: 'bg1', vehicles: [], branches: [] })
    expect(scopedWhere('vehicle', s)).toEqual({ AND: [{ bgId: 'bg1' }, { id: { in: [] } }] })
  })

  it('treats a missing scope link as "sees nothing", never "sees everything"', () => {
    // A GGB_ADMIN row with a null ggbId is corrupt data. The safe reading of
    // corrupt scope data is the empty set.
    const broken = buildScope({ id: 'u1', role: ROLES.GGB_ADMIN, ggbId: null })
    expect(scopedWhere('bg', broken)).toEqual({ id: { in: [] } })
    expect(scopedWhere('vehicle', broken)).toEqual({ id: { in: [] } })
  })

  it('an unrecognised role sees nothing', () => {
    const alien = buildScope({ id: 'u1', role: 'MARKETING_INTERN' })
    for (const e of ['ggb', 'group', 'bg', 'branch', 'vehicle', 'user', 'alert']) {
      expect(scopedWhere(e, alien), e).toEqual({ id: { in: [] } })
    }
  })

  it('ANDs a route filter after the scope rather than merging over it', () => {
    const s = scopeFor(ROLES.BG_USER)
    expect(scopedWhere('vehicle', s, { bgId: 'someone-elses-bg' })).toEqual({
      // Both constraints survive, so the result is empty rather than the other
      // tenant's fleet. A spread merge would have let the second bgId win.
      AND: [{ bgId: 'bg1' }, { bgId: 'someone-elses-bg' }],
    })
  })
})

describe('buildTree', () => {
  it('orders depth-first with a depth on each row', () => {
    const rows = [
      { id: 'c', name: 'C', parentBranchId: 'b' },
      { id: 'a', name: 'A', parentBranchId: null },
      { id: 'b', name: 'B', parentBranchId: 'a' },
      { id: 'z', name: 'Z', parentBranchId: null },
    ]
    expect(buildTree(rows).map(r => `${r.name}@${r.depth}`)).toEqual(['A@0', 'B@1', 'C@2', 'Z@0'])
  })

  it('keeps a row whose parent does not resolve, as top-level', () => {
    // Dropped rows are invisible and therefore unfixable; a visible one at depth 0
    // can at least be re-parented.
    const rows = [{ id: 'd', name: 'D', parentBranchId: 'gone' }]
    expect(buildTree(rows)).toEqual([{ id: 'd', name: 'D', parentBranchId: 'gone', depth: 0 }])
  })

  it('appends rows caught in a parent cycle instead of looping forever', () => {
    const rows = [
      { id: 'e', name: 'E', parentBranchId: 'f' },
      { id: 'f', name: 'F', parentBranchId: 'e' },
    ]
    expect(buildTree(rows).map(r => `${r.name}@${r.depth}`).sort()).toEqual(['E@0', 'F@0'])
  })
})

describe('publicUser', () => {
  it('is an allowlist — it cannot leak a column it was not told about', () => {
    const out = publicUser({
      id: 'u1',
      email: 'a@b.co',
      role: 'BG_USER',
      status: 'Active',
      mustChangePassword: false,
      passwordHash: '$2b$12$shouldnevergetout',
      secretFutureColumn: 'also should not get out',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    expect(out.passwordHash).toBeUndefined()
    expect(out.secretFutureColumn).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('$2b$')
    expect(out.email).toBe('a@b.co')
  })

  it('omits assignment arrays unless the joins were loaded', () => {
    const without = publicUser({ id: 'u1', email: 'a@b.co', role: 'BG_USER' })
    expect('vehicleIds' in without).toBe(false)

    const with_ = publicUser({
      id: 'u1',
      email: 'a@b.co',
      role: 'SUB_USER',
      vehicles: [{ vehicleId: 'v1' }],
      branches: [{ branchId: 'b1' }],
    })
    expect(with_.vehicleIds).toEqual(['v1'])
    expect(with_.branchIds).toEqual(['b1'])
  })
})
