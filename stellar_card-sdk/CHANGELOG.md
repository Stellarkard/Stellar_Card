# Changelog

All notable changes to the stellar_card SDK are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Pagination: `mapPaginated()` to stream a (sync or async) transform over every item across all pages, with a running index
- Network: `resolveNetworkConfigFromEnv()` and the `NETWORK_ENV_VARS` map to configure custom Soroban RPC / Horizon endpoints (plus API key and timeout) from environment variables, with explicit overrides taking precedence
- CI/CD: `verify:package` script and CI step that runs `npm pack --dry-run` to assert the published tarball includes all entry points, excludes source/tests/tooling, and stays within a size budget — wired into `prepublishOnly`, `test.yml`, and `publish.yml`
- Browser: `check:browser` script and CI step that statically walks the `browser.ts` import graph and fails if any reachable module pulls in a Node.js built-in not stubbed by the `browser` field

### Fixed
- Build no longer compiles co-located `*.test.ts` files (e.g. `src/commands/onboard.test.ts`) into `dist/`, so test code is no longer published to npm
- `network.test.ts` assertions updated to the resolved `{ sorobanRpc, horizon }` config shape

## [0.4.7] - 2025-01-01

### Added
- Typed pagination utilities (`PaginatedResult`, `PaginationCursor`, `paginate`)
- Browser-safe entry point (`stellar_card/browser`) excluding Node.js-only modules
- Custom Horizon URL override (`horizonUrl`) in `PayOpts` and `PayViaContractOwsOpts`
- `NetworkConfig` type and `resolveNetworkConfig` helper for managing RPC endpoints
- Automated CI/CD pipeline improvements: version verification, CHANGELOG extraction, Slack notifications

### Fixed
- `publish.yml` notify job now correctly forwards version output from the publish job
- `Verify version matches package.json` step handles manual dispatch without a version input

### Changed
- `PayOpts.sorobanRpcUrl` and new `PayOpts.horizonUrl` allow full custom network configuration
- `purchaseCard` and `purchaseCardOWS` accept `horizonUrl` for end-to-end custom network support

## [0.4.6] - 2024-12-01

### Added
- Initial pagination utilities (`listOrdersPage`, `iterateOrders`) on `Stellar_CardClient`
- SSE-first card wait with polling fallback

### Fixed
- CRLF normalization in SSE stream reader
- SSE buffer cap (1 MB) to prevent OOM on adversarial streams
- Shared deadline between SSE and polling fallback prevents 2× timeout

## [0.4.0] - 2024-10-01

### Added
- `Stellar_CardClient` REST API client with full order lifecycle
- Soroban contract payment helpers (`buildContractPaymentTx`, `submitSorobanTx`)
- OWS-custody wallet support (`payViaContractOWS`, `purchaseCardOWS`)
- Structured error types (`SpendLimitError`, `RateLimitError`, etc.)
- Exponential backoff retry with `Retry-After` header support
- CLI onboarding flow (`stellar_card onboard`)
- MCP tool integration
