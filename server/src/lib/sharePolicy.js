/**
 * Vehicle multi-assign (VehicleShare): the client's answers, in one place.
 *
 * Client, 2026-11-13: "One vehicle can be assigned to multiple Group, BG,
 * Branch". A vehicle keeps one owner (Vehicle.bgId / branchId) and may also
 * show in other places. The questions below were sent to the client with these
 * defaults, NOT yet confirmed — each is a switch here, so a different answer is
 * a one-line change plus its tests.
 *
 *   1. Can a place the vehicle is shared with edit it?
 *      No (fixed): view, Live Map, replay, reports and its own alerts only.
 *      Editing stays with the owner. The single place that decides it is the
 *      `ownedVehicle` entity in lib/scope.js (every write route resolves the
 *      vehicle through it) and buildAcl()'s writableDeviceIds (Flespi writes).
 *
 *   2. Do the shared BG's own alert rules apply to the vehicle?
 *      SHARED_BG_RULES_APPLY. Yes: a BG's rules, "All vehicles" included,
 *      cover the vehicles shared into it, and what they raise stays in that BG.
 *
 *   3. Where does the vehicle show? Where it was assigned, with a "Shared" chip
 *      (frontend: src/utils/vehiclePlacement.js). A Group share reaches the
 *      Group's admins only — GROUP_SHARE_REACHES_BG_USERS turns on "and every
 *      BG user under that Group".
 *
 *   4. "Assign vehicle" on a node offers both "Also show here" (a share) and
 *      "Move here" (the owner changes) — frontend only (NodeVehiclesPanel.jsx).
 *
 * No imports, so lib/scope.js can read it without an import cycle.
 */

export const SHARED_BG_RULES_APPLY = true

export const GROUP_SHARE_REACHES_BG_USERS = false

/** The levels a vehicle can be shared to, in VehicleMove's vocabulary. */
export const SHARE_LEVELS = Object.freeze(['group', 'bg', 'branch'])
