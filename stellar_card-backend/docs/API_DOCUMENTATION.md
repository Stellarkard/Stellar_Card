# API Documentation (OpenAPI)

The backend publishes its own contract.

| Endpoint                | What it serves                     |
| ----------------------- | ---------------------------------- |
| `GET /api/openapi.json` | The OpenAPI 3.0.3 document         |
| `GET /api/docs`         | Swagger UI rendering that document |

Both are unauthenticated and rate limited to 60 requests per minute per IP,
the same budget the other public metadata endpoints get. An integrator has to
be able to read the API before they have a key to call it with, and neither
route reveals anything they could not learn by making the calls.

```bash
curl -s localhost:4000/api/openapi.json | jq '.info.version'
open http://localhost:4000/api/docs
```

The document is also a normal OpenAPI file, so it feeds `openapi-generator`,
Postman, Insomnia, or anything else that speaks the format:

```bash
curl -s localhost:4000/api/openapi.json > openapi.json
npx @openapitools/openapi-generator-cli generate -i openapi.json -g python -o ./client
```

## The document is built, not written

`src/api/openapi.js` exports `buildOpenApiDocument()`. It is JavaScript rather
than a checked-in YAML file for one reason.

The failure mode of API documentation is not being absent. It is being present
and wrong. A client reads `maxLength: 2048`, sizes a buffer to match, and finds
out in production that the server has enforced 1024 since a refactor nobody
remembered to mirror into the spec. A static document drifts silently because
nothing executes it.

So the values that can drift are imported from the modules that enforce them:

| Published as                                          | Imported from                         |
| ----------------------------------------------------- | ------------------------------------- |
| `OrderSummary.status` enum, `?status=` filter         | `ORDER_STATUSES` in `api/orders.js`   |
| `amount_usdc` pattern (create **and** policy preview) | `AMOUNT_USDC_SHAPE`                   |
| `amount_usdc` min/max in the description              | `MIN_ORDER_USDC` / `MAX_ORDER_USDC`   |
| `webhook_url.maxLength`                               | `MAX_WEBHOOK_URL_CHARS`               |
| `metadata` byte budget                                | `MAX_METADATA_JSON_BYTES`             |
| `info.version`                                        | `VERSION_PAYLOAD` in `api/version.js` |

Changing a bound changes the published schema in the same commit, or it does
not change at all.

`servers[0].url` is resolved per request from `CARDS402_BASE_URL`, falling back
to the request's own host (honouring `X-Forwarded-Proto`, since `trust proxy`
is set). A self-hosted deployment reading its own spec gets its own base URL,
so Swagger UI's "Try it out" targets the right host instead of one baked in at
build time.

## What the tests actually check

`test/integration/openapi.test.js`. Well-formedness is the cheap part; these
are the checks that fail when the document and the server disagree.

- **Every documented path reaches a handler.** A 404 from the app's fallback
  means the spec describes a route the router does not mount.
- **Every operation marked `security: []` is reachable anonymously**, and every
  operation that is not returns `401 missing_api_key`. This catches an endpoint
  that quietly moved across the auth boundary in either direction — the second
  case is a disclosure bug the spec would otherwise paper over.
- **Every mounted route is documented or explicitly excluded.** The test walks
  Express's real layer stack and compares it against the document, collapsing
  path parameters to a placeholder so `/v1/orders/:id` and
  `/v1/orders/{orderId}` match. Anything in neither list fails the suite, which
  is what stops a new public endpoint from shipping undocumented.
- **The order status enum is the same array object the validator uses**, not a
  copy that happens to agree today.
- **`info.version` equals what `GET /api/version` returns.**
- **The CSP relaxation is scoped.** The docs page needs inline script and
  style; the assertion is that `/api/version` still does _not_ carry that
  relaxation.

## Scope: what is deliberately not published

`UNDOCUMENTED_PREFIXES` in `src/api/openapi.js` lists the excluded prefixes,
and the test above treats that list as the allowlist — so an exclusion is a
decision on the record, not an oversight.

| Prefix                                            | Why                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`, `/dashboard/platform`, `/internal`  | Operator surface, session-authenticated. No third-party clients, and publishing it to anonymous readers only helps an attacker map the deployment. |
| `/vcc-callback`                                   | HMAC machine-to-machine. One caller, and it is us.                                                                                                 |
| `/v1/.well-known/mpp`, `/v1/cards/*`, `/v1/mpp/*` | Machine Payments Protocol. Self-describing by protocol and feature-flagged behind `MPP_ENABLED`.                                                   |
| `/api/docs`, `/api/openapi.json`                  | The documentation endpoints themselves.                                                                                                            |

## Content Security Policy

Swagger UI ships its bootstrap script and part of its styling inline, which the
app-wide helmet policy (`script-src 'self'`) blocks — the classic way a docs
route ships "working" and is found broken by the first person who opens it.

`src/api/docs.js` re-applies `helmet.contentSecurityPolicy` for the `/api/docs`
subtree only. helmet writes the header with `res.setHeader`, so the
route-scoped policy replaces the global one for those paths and every other
response keeps the strict headers. The relaxation is the minimum the UI needs —
inline script and style, `img-src data:`, same-origin for everything else. **No
external host is permitted**, so the page works offline and cannot be turned
into an exfiltration channel. Both halves are asserted.

## Adding an endpoint

1. Add the path to `paths` in `src/api/openapi.js`, in the section matching its
   tag.
2. Give it an `operationId` — codegen names the generated client method after
   it, and a collision silently drops one of the two.
3. Import any bound you document rather than retyping it. If the constant is
   not exported yet, export it from the module that enforces it.
4. Document the `error` codes the endpoint can return, using `errorResponse()`.
   Clients branch on `error`, never on `message`.
5. If the endpoint is unauthenticated, set `security: []` explicitly — the
   document-level default is `apiKey`, and the test asserts each direction.

If the endpoint should not be published, add its prefix to
`UNDOCUMENTED_PREFIXES` with a comment saying why. There is no third option:
leaving it out of both lists fails the suite.
