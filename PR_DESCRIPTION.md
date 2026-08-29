# SDK custom RPC endpoint configuration fix

This PR hardens the stellar_card SDK network configuration logic for custom RPC and Horizon endpoints and closes the gap around blank or whitespace-only endpoint values.

## Summary

- Normalizes custom endpoint strings before resolution
- Treats blank / whitespace-only values as unset so the SDK falls back to default mainnet/testnet endpoints
- Keeps environment-driven config consistent with object-based config
- Adds regression coverage for edge cases in custom and env-based network configuration

## Changes

### Custom RPC endpoint resolution

The SDK now trims and normalizes custom endpoint values before they are used in `resolveNetworkConfig()` and `resolveNetworkConfigFromEnv()`.

This prevents cases like:

- `sorobanRpcUrl: '   '` from overriding the default RPC URL
- `networkPassphrase: '   '` from silently acting as a custom network
- environment variables with whitespace-only values from overriding real defaults

### Default fallback behavior

When an endpoint or config value is empty after trimming, the SDK falls back to the network-appropriate public default instead of accepting invalid configuration.

### Tests added

- Blank or whitespace-only object config values default cleanly
- Blank or whitespace-only env values default cleanly
- Existing override and timeout behavior remains intact

## Files touched

- `stellar_card-sdk/src/network.ts`
- `stellar_card-sdk/src/__tests__/network.test.ts`

## Validation

- Added focused regression tests covering the edge cases above
- Verified the logic remains compatible with existing network override expectations

## Related issue

Closes #517 - [sdk] Add support for custom RPC endpoint config (Part 4)
