# Request Input Validation

Request validation is declarative, built on [Zod](https://zod.dev), and lives in
`src/lib/validate.js`. Route modules declare the shape they accept as a schema
and mount `validate({ ... })` as ordinary Express middleware.

Zod was chosen over Joi because it is already a dependency — `src/env.js` uses it
to validate the environment at boot — so this adds a pattern rather than a
package.

> `src/lib/validate.js` is the only validation module. A second, narrower
> `validateBody` helper briefly lived at `src/middleware/validate.js` and was
> removed once `/auth/login` moved onto `validate()`: two helpers that both
> answered "is this body the right shape" is the exact duplication this layer
> exists to remove, and the two disagreed on whether the 400 carried a `req_id`.

## Why

Every mutating endpoint had grown its own validation preamble; POST `/v1/orders`
alone opened with 60+ lines of guards. Each preamble re-derived the same
primitives (is it an object, is it a string, is it within a length cap) with
slightly different wording and slightly different edge-case handling.

The guards were correct, but they were correct _independently_. That is how
POST `/auth/verify` ended up without the body-shape guard POST `/auth/login`
had — an adversarial audit found it, and until then an array body reached
`normalizeEmail(email).trim()`, which arrays do not have, and returned a 500.
Declaring the accepted shape once, next to the route, removes the class of bug
rather than the instance.

## Using it

```js
const { z } = require('zod');
const { validate, patternString } = require('../lib/validate');

const CreateThingBody = z
  .object({
    name: patternString(/^[a-z-]{1,64}$/, 'name must be lowercase letters and dashes'),
  })
  .passthrough();

const validateCreateThing = validate({
  body: CreateThingBody,
  errorCodes: { name: 'invalid_name' },
});

router.post('/', validateCreateThing, (req, res) => {
  // req.body.name is guaranteed to match.
});
```

`validate(config)` accepts:

| Key                | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `body`             | Schema for `req.body`. Also enables the non-object body guard.  |
| `query`            | Schema for `req.query`. This is where coercion belongs.         |
| `params`           | Schema for `req.params`.                                        |
| `errorCodes`       | Map of field name → API `error` code.                           |
| `defaultErrorCode` | Code for fields with no mapping. Defaults to `invalid_request`. |

On failure it responds `400` with `{ error, message }` — the same envelope every
hand-written guard used. On success it writes the parsed value back onto the
request and calls `next()`.

## Two design constraints

### 1. The wire contract does not change

Clients, the SDK, and the integration suite depend on specific `error` codes:
`invalid_amount`, `invalid_webhook_url`, `invalid_metadata`, `invalid_email`,
`missing_fields`. A generic `validation_failed` would have been a breaking
change.

Zod reports a _path_, not a code, so `validate()` takes a path → code map.
Messages are authored on the schema itself and are byte-identical to the ones the
guards returned.

Ordering matters too. Zod reports object issues in schema-declaration order and
the middleware surfaces the first one, so declaring fields in the order the old
guards checked them preserves which error a multiply-invalid request receives.
This is why `CreateOrderBody` lists `amount_usdc`, then `webhook_url`, then
`metadata`.

### 2. Validation does not rewrite the request

POST `/v1/orders` hashes the raw request body to build its idempotency
fingerprint. A schema that stripped unknown keys or coerced `"10.00"` to the
number `10` would silently change which retries are considered identical — and
lose the cents.

Body schemas therefore:

- are `.passthrough()`, so forward-compatible fields a client sends survive into
  the fingerprint;
- declare known fields with the **non-coercing** primitives below, which are
  built on `z.unknown()` plus a refinement rather than `z.string()`.

`query` is the deliberate exception: query parameters arrive as strings and
coercion is the entire point.

## Field primitives

All live in `src/lib/validate.js`. Each takes the message it should emit, because
the wording is part of the wire contract and belongs next to the route that owns
it.

| Primitive                                              | Behaviour                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `patternString(pattern, message, { trim })`            | String matching `pattern`. Emits `message` for a non-string too, rather than Zod's "Expected string". |
| `boundedString(max, typeMessage, lengthMessage)`       | String within a length cap, with distinct errors for the two failures.                                |
| `jsonObject(maxBytes, typeMsg, serializeMsg, sizeMsg)` | Plain object whose serialised form fits a **byte** budget. Rejects arrays and `null`.                 |
| `boundedIntQuery({ default, min, max })`               | Integer from a query string, clamped. Unparseable falls back to `default`.                            |
| `optionalIsoTimestamp(message)`                        | Optional ISO-8601 timestamp; rejects anything `Date.parse` cannot read.                               |

`jsonObject` attempts the serialisation during validation rather than at the
storage site, so a circular reference, a throwing `toJSON`, or a BigInt fails as
a 400 instead of a 500. It measures bytes rather than characters because the
column budget is in bytes — 30 multi-byte characters are under a 64-character
budget but over a 64-byte one.

## What stays in the handler

Anything that needs the network or the database. The SSRF check on
`webhook_url` resolves DNS and rejects private ranges: it is a network policy
decision, not a shape check, and it is async. The schema's length cap runs first,
so an oversized URL is rejected before it can cost a resolution.

## Currently validated

Every route that accepts caller-supplied input, plus the mutating half of the
operator surface. What remains hand-written is listed under
[What is still not schema-validated](#what-is-still-not-schema-validated).

| Route                                     | Body                                                                                                                                                               | Query                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `POST /v1/orders`                         | `amount_usdc`, `webhook_url`, `metadata`                                                                                                                           | —                                                                   |
| `GET /v1/orders`                          | —                                                                                                                                                                  | `status`, `since_created_at`, `since_updated_at`, `limit`, `offset` |
| `POST /v1/agent/claim`                    | `code`                                                                                                                                                             | —                                                                   |
| `POST /v1/agent/status`                   | `state`, `wallet_public_key`, `detail`                                                                                                                             | —                                                                   |
| `GET /v1/policy/check`                    | —                                                                                                                                                                  | `amount`                                                            |
| `POST /auth/login`                        | `email`                                                                                                                                                            | —                                                                   |
| `POST /auth/verify`                       | `email`, `code`                                                                                                                                                    | —                                                                   |
| `POST /dashboard/api-keys`                | `spend_limit_usdc`, `default_webhook_url`, `wallet_public_key`                                                                                                     | —                                                                   |
| `PATCH /dashboard/api-keys/:id`           | the three above plus `policy_daily_limit_usdc`, `policy_single_tx_limit_usdc`, `policy_require_approval_above_usdc`, `policy_allowed_hours`, `policy_allowed_days` | —                                                                   |
| `POST /dashboard/alert-rules`             | `notify_email`, `notify_webhook_url`                                                                                                                               | —                                                                   |
| `PATCH /dashboard/alert-rules/:id`        | the two above plus `snoozedUntil`                                                                                                                                  | —                                                                   |
| `POST /dashboard/webhook-deliveries/test` | `url`, `webhook_secret`                                                                                                                                            | —                                                                   |

### Behaviour this added

Beyond consolidating the existing checks, five gaps are now closed.

`GET /v1/orders`:

- **`status` is whitelisted.** An unknown status used to return `200 []`, which
  reads to the caller as "my orders disappeared" rather than "you typo'd the
  filter". It now returns `400 invalid_status` and names the valid values.
- **`since_created_at` / `since_updated_at` must parse.** These are compared
  lexically against ISO-8601 columns, which only sorts chronologically for
  well-formed input. A malformed bound silently matched everything or nothing —
  indistinguishable from data loss. They now return `400`.

`GET /v1/policy/check`:

- **`amount` uses the same decimal shape as `POST /v1/orders`.** The old guard
  was `isNaN(parseFloat(amount))`, which reads `"10abc"` as `10` and accepts
  `"10.12345"` — sub-cent precision the issuer cannot represent. The preview
  answered a question the endpoint it previews would have rejected. Both now
  agree on what a valid amount is.

`POST /v1/agent/claim` and `POST /auth/verify`:

- **A whitespace-only value is rejected.** Both handlers `.trim()` before use,
  so `"   "` passed the truthiness guard and then hashed as the empty string —
  one shared hash for every such request.

`limit` and `offset` keep their existing lenient behaviour: an unparseable value
falls back to the default rather than erroring, because clients already depend on
that. The clamp is what protects the database.

### The two shapes a schema has to preserve

`POST /v1/agent/status` shows both, and is worth reading before writing a new
schema:

1. **Absent is not null.** The handler builds a partial `UPDATE`: an absent key
   means "leave this column alone", an explicit `null` means "clear it". A
   `z.string().nullish()` would collapse the two. Each field is therefore
   `z.unknown()` plus a refinement that returns early on `undefined`.
2. **Cross-field rules report at the object level.** "Provide at least one of
   state, wallet_public_key, detail" is not about any single field, so it is a
   `.superRefine()` on the object and its issue has an empty path — which is
   exactly what `defaultErrorCode` is for (`nothing_to_update` here). Zod runs
   object-level refinements only after every field parses, so a request with one
   invalid field still gets that field's error rather than the cross-field one.

## The operator surface

`/dashboard`, `/internal` and `/dashboard/platform` sit behind session auth and a
shared rate limiter, which is why they were the last surface still validating by
hand. The reason they could not stay that way is `src/policy.js`.

### Why the write boundary has to be at least as strict as `policy.js`

`checkPolicy` fails **closed** on a stored policy value it cannot parse: a
corrupt `policy_allowed_hours` or `policy_allowed_days` blocks every order the
agent attempts, with `policy_corrupt_hours` / `policy_corrupt_days`. Its own
comment says "policy is validated at storage time by dashboard.js so a malformed
value in the DB is a bug" — and the guards on the write side were looser than
that reader in three places, so the bug was reachable straight through the
dashboard UI:

| Value                             | Old write guard                                                                               | What `policy.js` does with it                            |
| --------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `{"start":"99:99","end":"17:00"}` | `/^\d{2}:\d{2}$/` and nothing else — passes                                                   | Range-checks 0-23 / 0-59, throws                         |
| `["x"]`, `[null]`, `[1.5]`        | `d.some(n => n < 0 \|\| n > 6)` — passes, because both comparisons are false for a non-number | Requires `Number.isInteger`, throws                      |
| `"10abc"` for any policy amount   | `isNaN(parseFloat(val))` — reads it as 10                                                     | `parseFloat` gives 10; the raw string is what was stored |

In each case the operator saved a policy the dashboard accepted and the agent
silently stopped being able to order anything. Validating exactly what
`policy.js` will later demand is the point of the migration.

### What the operator schemas added beyond that

- **`default_webhook_url` is length-capped** at `MAX_WEBHOOK_URL_CHARS`, the same
  bound `/v1/orders` uses for `webhook_url`. The handler's `assertSafeUrl()`
  resolves DNS, so an unbounded URL used to reach a resolution.
- **`notify_email` and `notify_webhook_url` on alert rules are validated at all.**
  `alerts.createRule` / `updateRule` bind them straight into the statement, so a
  non-string arrived at better-sqlite3 as an unbindable value and came back as
  the driver's own `TypeError` text wrapped in a 400.
- **`snoozedUntil` must parse.** It stored fine before and the evaluator compares
  the column against a timestamp, so an unparseable value left the rule either
  permanently snoozed or never snoozed, with nothing to say which.
- **`POST /dashboard/webhook-deliveries/test` answers 400, not 502.** `url` was
  checked for truthiness only, so anything else went to `fireWebhook` →
  `assertSafeUrl` and surfaced as `502 delivery_failed` — the status class for
  "your endpoint is broken", not "your request is".

`kind` and `config` on an alert rule stay in `lib/alerts.js`, which owns the
per-kind config schema. That is domain validation, not shape validation, and it
belongs with the module that knows the kinds.

### What is still not schema-validated

- **`enabled` on `PATCH /dashboard/api-keys/:id`.** The handler does
  `enabled ? 1 : 0`, so `"false"` and `{}` both mean true. Tightening it to a
  boolean is a wire change for any client currently sending `1`, and it is not
  in the class of bug above — nothing downstream fails closed on it.
- **The read endpoints on the operator surface.** Their `limit` / `offset` /
  filter handling is lenient by design and clamped at the query, which is what
  protects the database. Worth a pass, but a separate one.
- **`/internal` and `/dashboard/platform`.** `POST /dashboard/platform/unfreeze`
  is the only mutating route between them; the rest are reads.
- **`POST /vcc-callback`.** It is HMAC-authenticated over the raw request body.
  Validation runs after `express.json()` but the signature is computed over
  `req.rawBody`, so shape-checking the parsed body adds nothing the signature
  check does not already guarantee about provenance.

### One ordering change

`PATCH /dashboard/api-keys/:id` checks the body shape before the ownership
lookup, because `validate()` is middleware. A malformed PATCH against an id the
dashboard does not own now answers 400 rather than 404. That matches every `/v1`
route and leaks nothing: the 400 is derived entirely from the caller's own body.
`nothing_to_update` stays in the handler, after the ownership check, so an empty
body against an unknown id still gets its 404.

## Adding validation to a route

1. Declare the schema at the top of the route module, next to the other schemas.
2. Use the non-coercing primitives for body fields.
3. Add an `errorCodes` entry per field, using the code the endpoint already
   returns — check the integration suite before inventing a new one.
4. Build the middleware into a named `const` (`const validateX = validate({...})`)
   and pass it to the route.
5. Cover the middleware behaviour in `test/unit/validate.test.js` if you add a
   primitive, and the route contract in
   `test/integration/request-validation.test.js`.

## Tests

- `test/unit/validate.test.js` — the middleware contract and each primitive,
  driven against fake `req`/`res` objects. Covers the error-code mapping and its
  fallback, first-issue-wins ordering, the non-transformation guarantee, query
  coercion and clamping, repeated query keys, and the hostile-payload paths
  (circular, throwing `toJSON`, BigInt, multi-byte overflow).
- `test/integration/request-validation.test.js` — every validated route over real
  HTTP, asserting each `error` code the API promises still comes back unchanged,
  plus the behaviour the schemas added. The operator-surface suites name each
  test `keeps …` (a code clients depend on), `adds: …` (a gap the schema closes,
  one per row of the table above), or `still …` (behaviour deliberately left
  alone, pinned so it stays a decision rather than a surprise).
