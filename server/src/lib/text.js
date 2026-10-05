/**
 * Normalisers for the two fields that have uniqueness rules.
 *
 * Both live here rather than inline at each call site because "the same email"
 * and "the same IMEI" have to mean exactly one thing across the write path, the
 * duplicate check and the lookup. Two slightly different inline versions is how
 * a duplicate gets in: the check compares one way and the insert stores another.
 */

/**
 * Trimmed and lower-cased.
 *
 * This is what makes User.email's plain unique index behave case-insensitively
 * without citext: every write normalises, so Ops@x.ae and ops@x.ae collide at
 * the database level rather than becoming two logins for one mailbox.
 */
export const normalizeEmail = v => String(v ?? '').trim().toLowerCase()

/**
 * Digits only.
 *
 * A Settings IMEI is typed by hand (and can carry a space or a stray dash)
 * while Flespi reports it from the device's `configuration.ident`. Comparing raw
 * strings would miss a match any human would call obvious — and would let the
 * same physical device be registered twice.
 */
export const normalizeImei = v => String(v ?? '').replace(/\D/g, '')
