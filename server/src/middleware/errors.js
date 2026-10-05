/**
 * The single response shape for every failure, and the Prisma → HTTP mapping.
 */

import env from '../env.js'
import { HttpError } from '../lib/http.js'

/** Unmatched route. Mounted after every router so it only sees real misses. */
export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.originalUrl}` } })
}

/**
 * Prisma's own errors, translated.
 *
 * Only the two that are genuinely the caller's fault are mapped. P2002 in
 * particular is the backstop behind every uniqueness check in the routes: the
 * route's own pre-check gives a friendly per-field message, and this catches the
 * race where two requests pass that check simultaneously and the database
 * decides. Without it that race is a 500.
 */
function translatePrisma(err) {
  if (err?.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target : []
    const field = target.find(t => t !== 'id') ?? target[0]
    const labels = { email: 'email address', imei: 'IMEI' }
    const label = labels[field] ?? field ?? 'value'
    return new HttpError(409, `That ${label} is already in use`, field ? { [field]: 'Already in use' } : undefined)
  }
  if (err?.code === 'P2025') {
    // "Record to update/delete not found". Reached when a row is deleted between
    // the scoped lookup and the write; 404 is the same answer the lookup would
    // have given a moment later.
    return new HttpError(404, 'Resource not found')
  }
  if (err?.code === 'P2003') {
    return new HttpError(400, 'Referenced record does not exist')
  }
  return null
}

// eslint-disable-next-line no-unused-vars -- Express identifies the error handler by arity
export const errorHandler = (err, req, res, next) => {
  const mapped = translatePrisma(err)
  const error = mapped ?? err

  const status = Number.isInteger(error?.status) ? error.status : 500

  if (status >= 500) {
    // The only place a stack is printed. Request id would go here too once there
    // is a log aggregator in front of it.
    console.error(`[error] ${req.method} ${req.originalUrl}`, error)
  }

  const body = {
    error: {
      message:
        status >= 500 && env.isProduction
          ? // Never leak an internal message in production: a Prisma error text
            // can contain column names and the values that were being written.
            'Internal server error'
          : (error?.message ?? 'Internal server error'),
    },
  }
  if (error?.code) body.error.code = error.code
  if (error?.details) body.error.details = error.details
  if (status >= 500 && !env.isProduction && error?.stack) body.error.stack = error.stack

  res.status(status).json(body)
}
