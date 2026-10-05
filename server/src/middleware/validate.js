/**
 * zod → Express. Replaces the parsed value so a handler never sees raw input.
 */

import { badRequest } from '../lib/http.js'

/** zod issues → { field: message }, which is the shape the frontend forms want. */
function fieldErrors(error) {
  const out = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/**
 * Validates one part of the request and writes the parsed result back over it.
 *
 * The overwrite is the important half: zod strips unknown keys and applies the
 * transforms (email lower-casing, IMEI digit-stripping, "" → null), so a handler
 * reading req.body is reading normalised data by construction. Validating
 * without replacing leaves the raw body in place and every handler one slip away
 * from using it.
 */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  // `?? {}` because Express 5 leaves req.body undefined when no body was sent,
  // and "no body" should fail on the missing fields the schema names rather than
  // on a bare "expected object, received undefined" that tells a form nothing.
  const result = schema.safeParse(req[part] ?? {})
  if (!result.success) {
    return next(badRequest('Validation failed', fieldErrors(result.error)))
  }
  // req.query is a getter-only accessor in Express 5, so assign onto a stash the
  // handlers read instead of fighting the framework.
  if (part === 'query') req.validatedQuery = result.data
  else req[part] = result.data
  next()
}
