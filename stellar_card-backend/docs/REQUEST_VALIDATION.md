# Request Input Validation

Request validation is declarative, built on [Zod](https://zod.dev), and lives in
`src/lib/validate.js`. Route modules declare the shape they accept as a schema
and mount `validate({ ... })` as ordinary Express middleware.

Zod was chosen over Joi because it is already a dependency — `src/env.js` uses it
to validate the environment at boot — so this adds a pattern rather than a
package.

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

| Route               | Body                                     | Query                                                               |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `POST /v1/orders`   | `amount_usdc`, `webhook_url`, `metadata` | —                                                                   |
| `GET /v1/orders`    | —                                        | `status`, `since_created_at`, `since_updated_at`, `limit`, `offset` |
| `POST /auth/login`  | `email`                                  | —                                                                   |
| `POST /auth/verify` | `email`, `code`                          | —                                                                   |

### Behaviour this added

Beyond consolidating the existing checks, two gaps on `GET /v1/orders` are now
closed:

- **`status` is whitelisted.** An unknown status used to return `200 []`, which
  reads to the caller as "my orders disappeared" rather than "you typo'd the
  filter". It now returns `400 invalid_status` and names the valid values.
- **`since_created_at` / `since_updated_at` must parse.** These are compared
  lexically against ISO-8601 columns, which only sorts chronologically for
  well-formed input. A malformed bound silently matched everything or nothing —
  indistinguishable from data loss. They now return `400`.

`limit` and `offset` keep their existing lenient behaviour: an unparseable value
falls back to the default rather than erroring, because clients already depend on
that. The clamp is what protects the database.

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
  driven against fake `req`/`res` objects. Covers the error-code mapping, the
  non-transformation guarantee, query coercion and clamping, repeated query keys,
  and the hostile-payload paths (circular, throwing `toJSON`, BigInt, multi-byte
  overflow).
- `test/integration/request-validation.test.js` — the same routes over real HTTP,
  asserting every `error` code the API promises still comes back unchanged, plus
  the new query-validation behaviour.
