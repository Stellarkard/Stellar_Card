# stellar_card — API Backend

Node.js / Express API server for [Stellar_Card](https://stellar_card.com). Handles order management, Soroban on-chain event monitoring, virtual Visa card fulfillment via VCC, and agent authentication.

## Features

- **USDC & XLM Payment Listening**: Monitors Soroban smart contract events on Stellar mainnet/testnet for incoming agent payments.
- **Virtual Card Fulfillment**: Integrates with VCC API (`vcc.ctx.com`) to generate real virtual Visa card details (PAN, CVV, expiry) within 60 seconds.
- **Agent Control Plane**: Enforces spend limits, operator approval queues, and kill switches per agent or group.
- **Audit Logging**: Logs every operation with IP, user-agent, actor ID, and timestamp for security compliance.
- **Role-Based Access Control**: Supports agent API tokens, email OTP dashboard logins, and internal admin roles.

## Project Structure

```
stellar_card-backend/
├── src/
│   ├── index.js          # Process entry point — boots jobs, watcher, HTTP listener
│   ├── app.js            # Express app: application-level middleware only
│   ├── routes/index.js   # The mount table — see docs/ROUTING.md
│   ├── api/              # One router per surface (orders, auth, dashboard, status, …)
│   │   └── openapi.js    # The published contract — see docs/API_DOCUMENTATION.md
│   ├── middleware/       # Auth verification, role guards
│   ├── payments/         # Soroban watcher, XLM pricing and sending
│   ├── mpp/              # Machine Payments Protocol (feature-flagged)
│   ├── lib/              # Logger, crypto, email, SSRF guard, Sentry, helpers
│   ├── db.js             # SQLite setup, schema and migrations
│   └── env.js            # Boot-time environment validation
├── test/                 # Unit & integration test suites
├── docs/                 # Architecture and operational guides
├── .env.example          # Environment variable template
├── Dockerfile            # Container definition
└── package.json          # Node.js dependencies & scripts
```

Routing is documented in [docs/ROUTING.md](docs/ROUTING.md) — in particular
which paths sit before the `/v1` auth boundary and why the mount order in
`src/routes/index.js` is behaviour rather than layout.

API failures use a JSON envelope with `error` and `req_id`; safe client errors
may also include `message`. Public endpoints advertise quotas with the standard
`RateLimit` response header and use the same traceable envelope when throttled.

## Setup & Development

### Local Setup

```bash
# 1. Navigate to directory
cd stellar_card-backend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start development server
npm run dev
```

The API server runs at `http://localhost:4000` by default.

### Docker Development

```bash
# Run backend via Docker Compose from root directory
docker compose up backend

# Development with hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up backend

# With optional PostgreSQL and Redis
docker compose --profile db up backend
```

For comprehensive Docker Compose documentation, see the project's [DOCKER_GUIDE.md](../DOCKER_GUIDE.md).

## Environment Variables

| Variable               | Required | Default                 | Description                                                 |
| ---------------------- | -------- | ----------------------- | ----------------------------------------------------------- |
| `PORT`                 | No       | `4000`                  | HTTP port for backend server                                |
| `NODE_ENV`             | No       | `development`           | Runtime environment (`development` / `production` / `test`) |
| `LOG_LEVEL`            | No       | `info`                  | Minimum Winston level emitted in production                 |
| `DB_PATH`              | No       | `./stellar_card.db`     | SQLite database file location                               |
| `STELLAR_NETWORK`      | Yes      | `mainnet`               | Target Stellar network (`mainnet` / `testnet`)              |
| `STELLAR_USDC_ISSUER`  | Yes      | —                       | Stellar USDC asset issuer public key                        |
| `STELLAR_XLM_SECRET`   | Yes      | —                       | Treasury secret key for processing refunds                  |
| `RECEIVER_CONTRACT_ID` | Yes      | —                       | Soroban payment contract ID                                 |
| `SOROBAN_RPC_URL`      | No       | default                 | Custom Soroban RPC endpoint                                 |
| `VCC_API_BASE`         | Yes      | `https://vcc.ctx.com`   | Base URL for VCC card fulfillment service                   |
| `CARDS402_BASE_URL`    | Yes      | `http://localhost:4000` | Public API base URL for webhooks                            |
| `VCC_CALLBACK_SECRET`  | Yes      | —                       | HMAC secret for verifying fulfillment webhooks              |
| `CORS_ORIGINS`         | No       | `*`                     | Allowed CORS origins for dashboard/agents                   |

## API Endpoints

The server publishes its own contract, so this list cannot go stale:

- **`GET /api/openapi.json`** — the OpenAPI 3.0.3 document.
- **`GET /api/docs`** — Swagger UI over it.

Both are unauthenticated. Run the server and open
<http://localhost:4000/api/docs>.

The document is built from the constants the validation layer enforces —
the order-status enum, the amount pattern, the metadata byte budget — so a
bound cannot change without the published schema changing with it. A test
walks the real Express route table and fails on any public route that is
neither documented nor explicitly excluded. See
[docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md).

The surface at a glance:

| Endpoint                             | Auth        | Purpose                              |
| ------------------------------------ | ----------- | ------------------------------------ |
| `GET /api/version`                   | none        | Protocol and feature compatibility   |
| `GET /status`                        | none        | Public health and throughput summary |
| `POST /v1/agent/claim`               | none        | Redeem a claim code for an API key   |
| `POST /v1/orders`                    | `X-Api-Key` | Create a card order                  |
| `GET /v1/orders`                     | `X-Api-Key` | List the calling key's orders        |
| `GET /v1/orders/:id`                 | `X-Api-Key` | Poll one order                       |
| `GET /v1/orders/:id/stream`          | `X-Api-Key` | Server-sent status transitions       |
| `GET /v1/usage`                      | `X-Api-Key` | Spend and order summary              |
| `GET /v1/policy/check`               | `X-Api-Key` | Dry-run a spend-policy decision      |
| `POST /v1/agent/status`              | `X-Api-Key` | Report a lifecycle transition        |
| `POST /auth/login` · `/auth/verify`  | none        | Email login code → session token     |
| `GET /auth/me` · `POST /auth/logout` | Bearer      | Resolve or end a session             |

The operator surface (`/dashboard`, `/internal`), the HMAC `/vcc-callback`,
and the feature-flagged MPP routes are deliberately not published — see the
scope table in [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md).

## Testing

```bash
# Run unit & integration tests
npm test

# Run ESLint
npm run lint

# Run TypeScript type check
npm run typecheck
```
