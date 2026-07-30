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

Every route that accepts caller-supplied input outside the operator surface now
declares a schema. What remains hand-written is listed under
[What is not schema-validated](#what-is-not-schema-validated).

| Route                   | Body                                     | Query                                                               |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `POST /v1/orders`       | `amount_usdc`, `webhook_url`, `metadata` | —                                                                   |
| `GET /v1/orders`        | —                                        | `status`, `since_created_at`, `since_updated_at`, `limit`, `offset` |
| `POST /v1/agent/claim`  | `code`                                   | —                                                                   |
| `POST /v1/agent/status` | `state`, `wallet_public_key`, `detail`   | —                                                                   |
| `GET /v1/policy/check`  | —                                        | `amount`                                                            |
| `POST /auth/login`      | `email`                                  | —                                                                   |
| `POST /auth/verify`     | `email`, `code`                          | —                                                                   |

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

### What is not schema-validated

- **The operator surface** (`/dashboard`, `/internal`, `/dashboard/platform`).
  These sit behind session auth and a shared rate limiter, and their handlers
  carry hardening from earlier audit passes whose properties are not always
  obvious from a schema alone. Migrating them is follow-up work that deserves
  its own review rather than a blanket pass.
- **`POST /vcc-callback`.** It is HMAC-authenticated over the raw request body.
  Validation runs after `express.json()` but the signature is computed over
  `req.rawBody`, so shape-checking the parsed body adds nothing the signature
  check does not already guarantee about provenance.

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
  plus the behaviour the schemas added.
