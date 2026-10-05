/**
 * The error vocabulary every route throws in, and the async wrapper that gets
 * those throws to the error handler.
 */

/**
 * An error with an HTTP status attached.
 *
 * Routes throw these instead of writing a response and returning, because the
 * `return res.status(...)` style is one forgotten `return` away from sending two
 * responses, and that failure mode only shows up under concurrency.
 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    if (details !== undefined) this.details = details
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details)
export const unauthorized = (message = 'Authentication required') => new HttpError(401, message)
export const forbidden = (message = 'Not permitted') => new HttpError(403, message)
export const conflict = (message, details) => new HttpError(409, message, details)

/**
 * The deliberate default for anything out of scope.
 *
 * A caller must not be able to tell "this id does not exist" from "this id
 * exists and belongs to someone else" — otherwise the API is an oracle for
 * enumerating other tenants' ids, and the scoping is only half enforced. So
 * every scoped lookup miss comes through here as a 404, including the ones that
 * are really authorisation failures.
 *
 * 403 is reserved for the cases where the caller's own identity is the problem
 * and no id is being probed: wrong role for the operation, read-only sub-user
 * attempting a write.
 */
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`)

/**
 * Wraps an async handler so a rejected promise reaches Express' error handler.
 *
 * Express 5 forwards rejections on its own, but this project also mounts the
 * same handlers in tests and may be pinned back to Express 4 on a deployment
 * target; the wrapper costs nothing and makes the behaviour independent of
 * which one is installed.
 */
export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
