# FleetmaX tracking backend

Node + Express + Prisma + PostgreSQL. Serves the org hierarchy, authentication and
the role-scoped API the FleetmaX frontend will read from Phase 2 onward.

Separate project from the client's Revofleet **Inventory** app — no shared code and
no shared database. Phase 4 adds an API for the inventory app to push into.

**Live GPS data is not here.** Positions, speed, temperature and ignition all stay
in Flespi. A `Vehicle` row links to its tracker by `imei`, which is the only
identifier both sides carry, and the Live Map joins the two client-side.

## Layout

```
src/
  index.js          process entry — listen, graceful shutdown
  app.js            express app factory (no listen, so tests mount the real app)
  env.js            zod-validated environment; a bad value is a boot crash
  prisma.js         the one PrismaClient
  lib/
    scope.js        ← visibility and write rights. The file to read first.
    branches.js     subtree walks, cycle prevention
    password.js     bcrypt + the default handed-out password
    jwt.js  http.js  text.js  fields.js  serialize.js
  middleware/       auth.js  validate.js  errors.js
  routes/           auth  me  ggbs  groups  bgs  branches  vehicles  users  alerts  health
prisma/
  schema.prisma     the data model, commented
  seed.js           creates exactly one Super Admin, from env
tests/              vitest + supertest against a separate database
```

## Scoping, in one paragraph

Every leaf entity (`Branch`, `Vehicle`, `User`, `Alert`) carries `bgId`, so almost
every visibility question reduces to *which Business Groups may this account see*:

| role | sees |
| --- | --- |
| `SUPER_ADMIN` | everything |
| `GGB_ADMIN` | its GGB and everything under it |
| `GROUP_ADMIN` | the BGs in its group and everything under them |
| `BG_USER` | its own BG, its branches, all its vehicles |
| `SUB_USER` | only the vehicles directly assigned to it |

A role sees its own node and everything below, **not** the chain above it — a BG
user listing `/api/ggbs` gets an empty array.

Lists compose their filter with `scopedWhere(entity, scope, ...extra)`; the scope
fragment is always first and a caller's query filter can only narrow it. Single
records go through `findScopedOrThrow(entity, id, scope)`, which merges the scope
into the `where` and throws **404** on a miss. No route does a bare
`findUnique({ where: { id } })`, which is why guessing an id out of scope is
indistinguishable from an id that does not exist. `403` is reserved for when the
caller's own role is the problem and no id is being probed.

Writes additionally check `assertCanWrite` (may this role touch this entity type at
all) and, for accounts, `assertCanWriteRole` — you may only create or modify an
account at a role strictly below your own.

## Setup

Requires PostgreSQL 16 and Node 20+.

```bash
cd server
npm install
cp .env.example .env     # then fill it in — see below
npx prisma migrate deploy
npm run seed
npm run dev              # http://localhost:4000
```

`.env` is gitignored and must stay that way. Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Databases

Two, because the test suite truncates every table it touches:

```sql
CREATE ROLE fleetmax LOGIN PASSWORD '...';
CREATE DATABASE fleetmax_tracking      OWNER fleetmax;
CREATE DATABASE fleetmax_tracking_test OWNER fleetmax;
```

The application connects as `fleetmax`, never as `postgres`. The superuser password
is needed once for the statements above and is not recorded in this project.

## Commands

| command | does |
| --- | --- |
| `npm run dev` | watch-mode server |
| `npm start` | production server |
| `npm run migrate` | `prisma migrate dev` — new migration from a schema change |
| `npm run migrate:deploy` | apply existing migrations (what deployments run) |
| `npm run seed` | create/reset the Super Admin from env |
| `npm test` | the suite, against `TEST_DATABASE_URL` |

Never edit an applied migration. A schema change is a new migration.

## Endpoints

| method | path | notes |
| --- | --- | --- |
| `GET` | `/api/health` | no auth; also checks the database |
| `POST` | `/api/auth/login` | → token + profile + `mustChangePassword`; rate-limited |
| `POST` | `/api/auth/change-password` | clears `mustChangePassword`, returns a fresh token |
| `GET` | `/api/auth/me` | current user, role and scope |
| `GET` | `/api/me/vehicles` | the fleet this account may watch — what the Live Map subscribes to |
| | `/api/ggbs` | `GET` list/one, `POST`, `PUT`, `DELETE` |
| | `/api/groups` | ″ |
| | `/api/bgs` | ″ |
| | `/api/branches` | ″ — `?bgId=&tree=1` for the indented tree |
| | `/api/vehicles` | ″ — `?bgId=&branchId=` |
| | `/api/users` | ″ — plus `PUT :id/vehicles`, `PUT :id/branches`, `POST :id/reset-password` |
| | `/api/alerts` | ″ |

Everything under `/api` except `/api/health` and `/api/auth/*` requires a bearer
token **and** a password that is no longer the handed-over one: while
`mustChangePassword` is set, every other endpoint answers `428` with code
`PASSWORD_CHANGE_REQUIRED`.

Responses are `{ data }` on success and `{ error: { message, code?, details? } }` on
failure, where `details` is `{ field: message }` for a form to render.

### First login

A new BG user or sub-user is created on `DEFAULT_USER_PASSWORD` (`Aa@123456`) with
`mustChangePassword = true`. The create response echoes `defaultPassword` so the
operator knows what to hand over — only when the server chose it.

```bash
curl -s localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fleetmax.local","password":"..."}'
```

## Security

- `helmet`; `x-powered-by` off; `trust proxy` set for the DigitalOcean deployment.
- CORS from `FRONTEND_ORIGINS` (exact origins, comma-separated). **Empty means no
  browser origin is allowed** — a missing variable must not mean `*`.
- Login rate limit keyed on IP **+ submitted email**, so one person mistyping their
  password cannot lock out everyone behind the same NAT.
- Passwords bcrypt-hashed and never returned; `publicUser()` is an allowlist.
- Login answers the same 401 for unknown email, wrong password and inactive
  account, and compares against a dummy hash when there is no user so the timing
  does not give it away either.
- The user row is re-read on every request, so deactivating an account or narrowing
  a sub-user's assignments takes effect immediately rather than at token expiry.
