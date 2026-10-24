# SDK: verify-tx CLI, SEP-0007 URIs, gas refund tracking, purchase CLI tests

This PR implements four stellar_card SDK issues for CLI payment verification, SEP-0007 deep links, Soroban fee refund metrics, and purchase command test coverage.

## Summary

- **#771** — Add `stellar_card verify-tx` to cryptographically inspect on-chain payment proofs (Horizon + Soroban RPC), parse contract payment events, assert treasury recipient match, extract order UUID, and print a green verification summary.
- **#758** — Extend `purchase` CLI with `--merchant`, `--memo`, `--json`, `--dry-run`, confirmation prompt, and insufficient-balance handling; add comprehensive Vitest coverage in `src/commands/purchase.test.ts`.
- **#772** — Implement SEP-0007 `buildSep7PayUri` / `buildSep7TxUri` / `parseSep7Uri` helpers (with optional URI signing) and export them from `stellar.ts`.
- **#769** — Track Soroban gas refunds after submit (`feeCharged`, `feeRefunded`, `maxFee`) on `TransactionResult` / `ContractPaymentResult`, with debug-level gas efficiency logging.

## Changes

### verify-tx (#771)
- `stellar_card-sdk/src/commands/verify.ts` — verification command + injectable deps
- `stellar_card-sdk/src/cli.ts` — wire `verify-tx` / `verify` subcommand
- `stellar_card-sdk/src/__tests__/cli-verify-tx.test.ts` — unit tests

### purchase CLI tests (#758)
- `stellar_card-sdk/src/commands/purchase.ts` — new flags, confirmation, dry-run, JSON schema, balance guards
- `stellar_card-sdk/src/commands/purchase.test.ts` — flag / confirmation / balance / JSON tests

### SEP-0007 (#772)
- `stellar_card-sdk/src/utils/sep7.ts` — URI generator/parser
- Re-exports from `stellar.ts` + `index.ts`
- `stellar_card-sdk/src/__tests__/sep7-uri.test.ts`

### Gas refund tracking (#769)
- `stellar_card-sdk/src/soroban.ts` — `computeFeeRefund`, Horizon fee extraction, metrics on submit result
- `stellar_card-sdk/src/types.ts` — `feeCharged` / `feeRefunded` / `maxFee` on `TransactionResult`; new `ContractPaymentResult`
- `payViaContract` / `payViaContractOWS` return `ContractPaymentResult`
- `stellar_card-sdk/src/__tests__/soroban-fee-refund.test.ts`

## Test plan

- [ ] `cd stellar_card-sdk && npm test -- src/__tests__/cli-verify-tx.test.ts`
- [ ] `cd stellar_card-sdk && npm test -- src/commands/purchase.test.ts`
- [ ] `cd stellar_card-sdk && npm test -- src/__tests__/sep7-uri.test.ts`
- [ ] `cd stellar_card-sdk && npm test -- src/__tests__/soroban-fee-refund.test.ts`
- [ ] `cd stellar_card-sdk && npm test -- src/__tests__/pay-retry.test.ts src/__tests__/ows.test.ts`
- [ ] Manually: `stellar_card verify-tx <hash> --treasury <G…> --network testnet`
- [ ] Manually: `stellar_card purchase --amount 10 --dry-run --json`

closes #771
closes #758
closes #772
closes #769
