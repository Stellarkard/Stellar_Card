# Routing Architecture

## Layout

```
src/
├── app.js              # Application-level middleware only
├── routes/
│   └── index.js        # registerRoutes(app) — the mount table
└── api/
    ├── version.js      # GET  /api/version
    ├── status.js       # GET  /status
    ├── docs.js         # GET  /docs, /openapi.json (Swagger UI)
    ├── docs.js         # GET  /api/openapi.json, /api/docs
    ├── openapi.js      # the OpenAPI document docs.js serves
    ├── agent-claim.js  # POST /v1/agent/claim        (pre-auth)
    ├── agent.js        # POST /v1/agent/status       (post-auth)
    ├── usage.js        # GET  /v1/usage, /v1/policy/check
    ├── orders.js       # /v1/orders/*
    ├── auth.js         # /auth/*
    ├── dashboard.js    # /dashboard/*
    ├── platform.js     # /dashboard/platform/*
    ├── internal.js     # /internal/*
    └── vcc-callback.js # /vcc-callback
```

`app.js` builds the Express app, installs the middleware every request
passes through — Sentry scope, request-id correlation, helmet, the HTTPS
guard, CORS, JSON body parsing — then calls `registerRoutes(app)` and
installs the 404 fallback and the terminal error handlers. It is ~250
lines and contains no route handlers.

That last sentence is enforced, not aspirational.
`test/integration/route-registry.test.js` asserts it two ways: no
`app.get`/`app.post`/… declaration survives in `src/app.js`, and no path
is mounted more than once. Both checks failed before this extraction was
finished — app.js still carried a second copy of the `/status`,
`/v1/usage`, `/v1/policy/check` and `/v1/agent/status` handlers alongside
the `registerRoutes()` call that had replaced them, so each of those paths
was mounted twice. A double mount is invisible from outside (the first
handler answers, the second is dead weight) right up until the two drift
and a fix lands in the copy that never runs.

`routes/index.js` is the mount table: what is mounted where, in what
order, and why. It also owns the three route-level rate limiters that are
applied at mount time (`adminLimiter`, `authFailureLimiter`,
`vccCallbackLimiter`) — limiters scoped to a single router still live
inside that router.

## Why this shape

`app.js` previously interleaved three unrelated concerns across 910
lines: application middleware, route mounting, and the full inline bodies
of five handlers (`/status`, `/v1/agent/claim`, `/v1/agent/status`,
`/v1/usage`, `/v1/policy/check`) totalling ~400 lines. The `/v1/agent/claim`
handler alone ran to 180 lines of transactional claim redemption.

The practical cost was not aesthetic. The single most important fact
about this file — **which paths require an api key and which do not** —
was spread across four screens with handler bodies in between. Answering
it meant reading the whole file and tracking where `app.use('/v1', auth)`
fell relative to every other `app.use`. That is a question a reviewer
needs to answer on every security-relevant change, and it now has a
thirty-line answer in one place.

Secondary benefits: each handler is independently testable and
independently reviewable, the diff on a change to `/status` no longer
touches the file that configures CORS, and `git blame` on a handler stops
being dominated by unrelated middleware churn.

## Mount order is behaviour

Express matches middleware in registration order. Three of the mounts in
`registerRoutes` cannot be reordered:

### 1. MPP routes mount at `/v1` before the auth chain

Unauthenticated payment discovery is the entire point of the Machine
Payments Protocol. `/v1/.well-known/mpp`, `/v1/cards/:product/:amount`
and `/v1/mpp/receipts/:id` must be reachable without an `X-Api-Key`
header. The router only matches those specific paths and calls `next()`
for everything else, so no other endpoint loses authentication by sitting
behind it. Gated on `MPP_ENABLED` so the code can ship dark.

### 2. `POST /v1/agent/claim` mounts at `/v1` before the auth chain

Claim redemption is how an agent turns a dashboard-minted code **into**
an api key. Requiring one would be circular. It carries its own tight
per-IP limiter (10/min) because it is the one `/v1` endpoint with no
credential.

### 3. `authFailureLimiter` mounts before `auth`, not after

This is the subtle one. `app.use('/v1', auth)` runs every `/v1/*` request
through bcrypt before any per-route limiter would normally fire, so a
flood of malformed-but-prefix-valid keys saturates a CPU core at ~15
req/s (or ~1 req/s on legacy installs that hit the NULL-prefix fallback).
The limiter caps that. It checks its counter at request _start_ — always
before downstream middleware — so mounting it after `auth` would leave
the bcrypt compare already spent and the cap pointless.

`skipSuccessfulRequests: true` means only non-2xx responses consume
budget, so legitimate agents are unaffected regardless of poll cadence.

### Everything after `app.use('/v1', auth)` is authenticated by construction

That is the invariant `routes/index.js` exists to make legible, and
`test/integration/route-registry.test.js` asserts it behaviourally: it
makes real unauthenticated requests and checks which ones reach a
handler. Behaviourally rather than by inspecting Express's internal layer
stack, which would pin an implementation detail instead of the invariant.

### One more ordering rule

`/dashboard/platform` mounts before `/dashboard` so the longer prefix
wins. `requirePlatformOwner` inside the platform router is what actually
restricts access; the ordering only decides which router sees the
request.

## Adding a route

1. Create or pick a module under `src/api/`. Export an Express `Router`.
2. Give it a header comment stating the path, whether it sits before or
   after the auth chain, and why.
3. Mount it in `registerRoutes`, in the section matching its
   authentication requirement.
4. If it is unauthenticated, say so explicitly in the module header and
   in the mount comment, and give it its own rate limiter.
5. Add it to `test/integration/route-registry.test.js` — the
   unauthenticated list or the auth-boundary list, whichever applies.
6. Publish it in `src/api/openapi.js`, or add its prefix to
   `UNDOCUMENTED_PREFIXES` with a reason. `test/integration/openapi.test.js`
   fails on a route in neither list — see [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

Handlers use paths relative to their mount point: `agent.js` declares
`router.post('/agent/status', ...)` and is mounted at `/v1`.

## What did not change

Every path, status code, response body, rate limit and mount order is
preserved, and the full test suite passes. `app.js` still exports the
Express app as its default export, along with the `_validateRequestId` /
`_resetReqIdWarnState` / `_REQ_ID_SHAPE` test-only exports the request-id
unit tests depend on.

One response gained a field. The CORS-denial 403 was formatted in two
places — an inline error middleware in `app.js` and the branch in
`middleware/errorHandler.js` — which disagreed on whether the body carried
`req_id`. The inline copy is gone and `errorHandler` is the only formatter,
so a rejected origin now gets the same `{ error, message, req_id }` shape
every other error response has.
