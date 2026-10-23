# Invariant Testing Methodology

This document describes the property-based invariant test suite for the
stellar_card payment accounting logic, located at the end of `src/lib.rs`
under `// ── invariant fuzz tests ──`.

## Goal

Prove that no combination of inputs can cause value to leak, rest on the
contract, or desynchronize contract state. The suite exercises the payment
entrypoints (`pay_usdc`, `pay_xlm`, `pay_eurc`) under randomized inputs and
asserts invariants that must hold after every iteration.

## Harness

The suite uses a deterministic LCG (Knuth MMIX constants) seeded per test, not
an external fuzzing crate. This keeps the harness dependency-free and every run
reproducible: the same seed always produces the same input sequence, so a
failure is debuggable from the iteration index alone.

| Test | Seed | Iterations |
|------|------|------------|
| `test_fuzz_payment_accounting_invariants` | `0xC0FFEE` | 1,200 |
| `test_fuzz_invalid_amounts_never_move_value` | `0xDEAD_BEEF` | 600 |
| `test_fuzz_paused_contract_rejects_all_payments` | `0x12345678` | 600 |
| `test_fuzz_fee_split_conserves_total_value` | `0xFEE0FEE0` | 600 |

Each iteration generates:

- a random payment amount (within a safe positive range),
- a random asset selector (USDC / XLM / EURC),
- a unique order identifier derived from the iteration counter.

## Invariants

### I1 — Contract held balance is always 0

After any successful payment the contract's own token balance must be `0`.
Payments forward funds straight to the treasury (and fee collector); nothing
is retained. Asserted on every successful iteration.

### I2 — Treasury increases by exactly the payment amount

With no fee configured, `treasury_after - treasury_before == amount` must hold
exactly. Combined with I1 this proves total value is conserved: nothing is
minted, burned, or silently redirected.

### I3 — Rejected payments never move value

Non-positive amounts (`0`, negative) must fail with `InvalidAmount` and leave
every balance unchanged. A failing path must not partially transfer.

### I4 — Pause blocks all payments

While paused, every payment attempt must fail and leave balances untouched,
regardless of asset type or amount. The circuit breaker cannot be bypassed by
input variation.

### I5 — Fee split conserves total value

When a fee collector and a non-zero fee rate are configured:

```
treasury_delta + fee_delta == amount
contract_balance == 0
```

The split must never create or destroy value, and the contract must still
retain nothing.

## Reentrancy and state desynchronization

The reentrancy guard (`_enter` / `_exit`) is exercised by the existing unit
tests (`test_reentrancy_guard_*`). The fuzz suite complements them by
asserting I1–I5 after every operation, which would catch a desynchronized
transfer that left a residual contract balance or a short/over-credited
treasury even if the call itself returned `Ok`.

## Running the suite

```bash
cargo test --package stellar_card-receiver fuzz_
```

The full contract test suite (unit + fuzz) runs with:

```bash
cargo test --package stellar_card-receiver
```

## Adding new invariants

1. Extend `Rng` inputs if a new dimension (e.g. concurrent payers) is needed.
2. Assert the invariant inside the iteration loop so failures report the
   iteration index.
3. Keep the generator deterministic — no `std` randomness — so CI and local
   runs agree.
