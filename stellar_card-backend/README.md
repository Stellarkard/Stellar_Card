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
```

## Environment Variables

| Variable               | Required | Default                 | Description                                                 |
| ---------------------- | -------- | ----------------------- | ----------------------------------------------------------- |
| `PORT`                 | No       | `4000`                  | HTTP port for backend server                                |
| `NODE_ENV`             | No       | `development`           | Runtime environment (`development` / `production` / `test`) |
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

- `GET /health` — Health check endpoint.
- `POST /api/v1/orders` — Create a new virtual card order.
- `GET /api/v1/orders/:id` — Query order status and card details.
- `POST /api/v1/auth/otp` — Request OTP login code.
- `POST /api/v1/webhooks/vcc` — Webhook receiver for VCC fulfillment callbacks.

## Testing

```bash
# Run unit & integration tests
npm test

# Run ESLint
npm run lint

# Run TypeScript type check
npm run typecheck
```
