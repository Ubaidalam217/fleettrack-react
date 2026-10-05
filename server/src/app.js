/**
 * The Express app, as a factory with no listen().
 *
 * Separated from index.js so the test suite can mount the real app through
 * supertest — same middleware, same error handling, same auth — instead of
 * testing a reassembled approximation of it. A bug in the mounting order is a bug
 * the tests should be able to catch.
 */

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
// ipKeyGenerator is a NAMED export; it is not a property of the default export.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import env from './env.js'
import { requireAuth, requirePasswordChanged } from './middleware/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errors.js'

import healthRoutes from './routes/health.js'
import authRoutes from './routes/auth.js'
import meRoutes from './routes/me.js'
import ggbRoutes from './routes/ggbs.js'
import groupRoutes from './routes/groups.js'
import bgRoutes from './routes/bgs.js'
import branchRoutes from './routes/branches.js'
import vehicleRoutes from './routes/vehicles.js'
import userRoutes from './routes/users.js'
import alertRoutes from './routes/alerts.js'

/**
 * CORS, from FRONTEND_ORIGINS.
 *
 * An empty allowlist denies every browser origin rather than falling back to `*`:
 * a missing environment variable on a production deployment must not be the thing
 * that opens the API to any page on the internet. Requests with no Origin header
 * (curl, server-to-server, the Phase 4 inventory push) are unaffected — CORS is a
 * browser mechanism and refusing them here would buy nothing.
 */
function corsOptions() {
  const allowed = new Set(env.FRONTEND_ORIGINS)
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true)
      callback(new Error(`Origin ${origin} is not allowed by CORS`))
    },
    credentials: true,
  }
}

export function createApp() {
  const app = express()

  // The API is behind a proxy on DigitalOcean. Without this, express-rate-limit
  // sees the proxy's address for every request and rate-limits the whole world as
  // one client — which would turn ten bad logins into an outage.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(helmet())
  app.use(cors(corsOptions()))
  // 100kb: the largest legitimate body here is a sub-user's screen-access map,
  // which is a few kilobytes. The default 100kb is already generous; stating it
  // keeps a future large-payload endpoint from being added by accident.
  app.use(express.json({ limit: '100kb' }))

  if (!env.isTest) app.use(morgan(env.isProduction ? 'combined' : 'dev'))

  app.use('/api/health', healthRoutes)

  /**
   * Rate limit on login only.
   *
   * Keyed on IP plus the submitted email, so one person fat-fingering their own
   * password cannot lock out everyone else behind the same office NAT, while a
   * spray across many accounts from one address still trips the per-IP half.
   * Disabled under test — the suite makes dozens of deliberate login attempts and
   * a 429 there would be a failure that says nothing about the code.
   */
  const loginLimiter = rateLimit({
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    max: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest,
    keyGenerator: (req, res) => {
      // ipKeyGenerator rather than req.ip directly: it normalises IPv6 to a /56
      // prefix, so one client cannot sidestep the limit by walking through the
      // addresses of its own subnet.
      const ip = ipKeyGenerator(req, res)
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      return `${ip}|${email}`
    },
    message: { error: { message: 'Too many login attempts. Try again later.' } },
  })
  app.use('/api/auth/login', loginLimiter)

  app.use('/api/auth', authRoutes)

  /**
   * Everything below here needs a token AND a password that is no longer the
   * handed-over one.
   *
   * Applied as a pair, once, rather than per-router: the first-login gate is only
   * a gate if nothing can be reached around it, and a router added later inherits
   * both without anyone having to remember.
   */
  app.use('/api', requireAuth, requirePasswordChanged)

  app.use('/api/me', meRoutes)
  app.use('/api/ggbs', ggbRoutes)
  app.use('/api/groups', groupRoutes)
  app.use('/api/bgs', bgRoutes)
  app.use('/api/branches', branchRoutes)
  app.use('/api/vehicles', vehicleRoutes)
  app.use('/api/users', userRoutes)
  app.use('/api/alerts', alertRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export default createApp
