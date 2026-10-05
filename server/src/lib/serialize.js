/**
 * Row → response body.
 *
 * Every user-shaped response goes through publicUser(). It is an allowlist, not
 * a `delete row.passwordHash`: a deny-list is correct exactly until someone adds
 * a second sensitive column, and then it silently is not. Nothing here can emit
 * a field it was not told about.
 */

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    shortName: user.shortName ?? null,
    mobile: user.mobile ?? null,
    scope: {
      ggbId: user.ggbId ?? null,
      groupId: user.groupId ?? null,
      bgId: user.bgId ?? null,
    },
    // The sub-user tabs. Present on every role for one response shape; null for
    // the roles that have no tab data rather than {}, so the frontend can tell
    // "never set" from "set to empty".
    userSetting: user.userSetting ?? null,
    authentication: user.authentication ?? null,
    sso: user.sso ?? null,
    screenAccess: user.screenAccess ?? null,
    myAccount: user.myAccount ?? null,
    // Only present when the caller asked for them (the join is in the include).
    ...(user.vehicles ? { vehicleIds: user.vehicles.map(v => v.vehicleId) } : {}),
    ...(user.branches ? { branchIds: user.branches.map(b => b.branchId) } : {}),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

/**
 * An alert with its explicit vehicle list flattened to ids.
 *
 * `vehicleIds` is left empty when allVehicles is set, mirroring the frontend:
 * "all" is a mode, not a snapshot, so there is no list to report.
 */
export function publicAlert(alert) {
  if (!alert) return null
  const { vehicles, ...rest } = alert
  return {
    ...rest,
    vehicleIds: alert.allVehicles ? [] : (vehicles ?? []).map(v => v.vehicleId),
  }
}
