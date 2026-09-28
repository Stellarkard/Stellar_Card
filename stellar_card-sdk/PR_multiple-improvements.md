# SDK Improvements: Version-check tests, CLI dry-run mode, proxy support, and config env tests

Closes #766, #767, #768, #770

## Summary

This PR implements four improvements to the Stellar_Card SDK:
1. Comprehensive unit tests for version-check functionality
2. CLI dry-run mode for purchase commands
3. Proxy configuration support for network requests
4. Unit tests for config environment variable resolution

## Changes

### Task #766: Add unit tests for version-check.test.ts

**File: `src/__tests__/version-check.test.ts`**

Added comprehensive test suites:

- **Semantic Version Parsing Tests**
  - Tests for comparing matching versions
  - Tests for detecting patch update differences
  - Tests for detecting minor update differences
  - Tests for detecting major update differences
  - Tests for handling malformed version strings gracefully

- **Prerelease Tag Tests**
  - Tests for handling prerelease tags (e.g., `1.0.0-beta.1`, `1.0.0-alpha`, `1.0.0-rc.1`)
  - Tests for complex prerelease tags with multiple segments
  - Tests for stripping prerelease tags during version comparison

- **Registry Response Timeout and Error Tests**
  - Tests for silently handling NPM registry request timeout
  - Tests for silently handling NPM registry 500 error
  - Tests for silently handling NPM registry 404 error
  - Tests for silently handling network connection errors
  - Tests for silently handling malformed JSON response
  - Tests for silently handling missing version field
  - Tests for respecting 2 second timeout for registry fetch

### Task #767: Implement CLI dry-run mode for purchase commands

**File: `src/commands/purchase.ts`**

- Added `--dry-run` flag to `PurchaseArgs` interface
- Added `--json` flag to `PurchaseArgs` interface for JSON output
- Updated argument parser to handle `--dry-run` and `--json` flags
- Added validation to prevent `--dry-run` from being used with `--resume`
- Added `DryRunSimulation` interface
- Implemented `simulatePurchase()` function with fee estimation
- Added dry-run output with formatted breakdown or JSON
- Prints clear "[DRY-RUN] No funds were moved" message
- Updated usage documentation with examples

### Task #768: Add proxy configuration support in SDK network fetcher

**File: `src/network.ts`**

- Added `proxyUrl` optional field to `NetworkConfig` interface
- Added conditional imports for `https-proxy-agent` and `socks-proxy-agent` packages
- Implemented `createProxyAgent()` function supporting http://, https://, and socks5:// protocols
- Implemented `resolveProxyUrl()` function with priority: config > HTTPS_PROXY > HTTP_PROXY
- Implemented `shouldBypassProxy()` function for NO_PROXY environment variable support
- Proxy packages are optional and gracefully handled if not installed

**File: `src/__tests__/network.test.ts`**

Added comprehensive test suite:
- Tests for `createProxyAgent()` behavior with and without proxy packages
- Tests for unsupported proxy protocol error handling
- Tests for proxy URL resolution priority
- Tests for environment variable handling (uppercase and lowercase)
- Tests for NO_PROXY bypass rules (exact match, wildcard, substring)
- Tests for comma-separated NO_PROXY lists
- Tests for whitespace trimming in NO_PROXY patterns

### Task #770: Add unit tests for config.ts environment variable resolution

**File: `src/__tests__/config.test.ts`**

Added comprehensive test suite:

- **Resolution Priority Order**
  - Tests for method option > constructor option > environment variable > default
  - Tests for explicit options overriding environment variables
  - Tests for constructor options overriding environment variables

- **Environment Variable Sources**
  - Tests for CARDS402_* variables being prioritized
  - Tests for STELLAR_CARD_* variables as fallbacks
  - Tests for CARDS402_* taking precedence over STELLAR_CARD_*
  - Tests for both uppercase and lowercase environment variable names

- **Config File Fallback**
  - Tests for falling back to config file when no env vars or options are set
  - Tests for returning undefined when no configuration source is available

- **URL Validation**
  - Tests for rejecting invalid URL formats from environment variables
  - Tests for rejecting non-HTTPS URLs without override
  - Tests for allowing HTTP URLs with CARDS402_ALLOW_INSECURE_BASE_URL=1

- **Default URL Assignment**
  - Tests for default URL assignment for Testnet and Mainnet networks

## Testing

All new tests follow existing patterns and use Vitest. The tests ensure:
- Semantic version parsing correctly handles valid and invalid version strings
- Prerelease tags are properly stripped for comparison
- Registry errors and timeouts fail silently without throwing or printing warnings
- The 2-second timeout is respected for registry fetches
- Dry-run simulation provides accurate fee estimates and clear output
- Proxy configuration resolves correctly from config and environment variables
- NO_PROXY rules work as expected
- Configuration resolution follows the correct precedence order
- URL validation rejects insecure or malformed URLs

## Files Changed

- `src/__tests__/version-check.test.ts` - Added comprehensive test suites for semver handling and registry error scenarios
- `src/commands/purchase.ts` - Added dry-run flag, simulation logic, and updated usage documentation
- `src/network.ts` - Added proxy configuration support, proxy agent creation, proxy URL resolution, and NO_PROXY handling
- `src/__tests__/network.test.ts` - Added comprehensive test suite for proxy functionality
- `src/__tests__/config.test.ts` - Added comprehensive test suite for environment variable resolution and validation
