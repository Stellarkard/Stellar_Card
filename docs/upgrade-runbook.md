# Contract upgrade runbook

The Soroban receiver contract at `RECEIVER_CONTRACT_ID` supports admin-gated
upgrades. This doc covers how to upgrade, how to use RBAC and the pause
mechanism, and how to burn the admin key to make the contract immutable.

## Who holds the admin key?

The admin key is a Stellar keypair set at deploy time. The public key is
stored on-chain in the contract's instance storage under the `admin` key.
The corresponding secret key is held by the contract deployer (you).

**If you lose the admin secret, you cannot upgrade or modify the contract.**
This is by design — it makes the contract effectively immutable without
needing to burn the key.

## Role-Based Access Control (RBAC)

The contract implements three roles:

| Role | Capabilities |
|------|-------------|
| **Admin** | Upgrade contract, grant/revoke roles, set new admin, burn admin key |
| **Pauser** | Pause and unpause the contract |
| **Operator** | Reserved for future use (e.g., treasury management) |

All three roles are automatically granted to the admin address during `init`.

### Granting a role

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --source <ADMIN_SECRET> \
  --network testnet \
  -- grant_role --account <G...> --role <Admin|Pauser|Operator>
```

### Revoking a role

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --source <ADMIN_SECRET> \
  --network testnet \
  -- revoke_role --account <G...> --role <Admin|Pauser|Operator>
```

### Checking if an address has a role

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --network testnet \
  -- has_role --account <G...> --role <Admin|Pauser|Operator>
```

## Pause / Unpause

The contract can be紧急暂停 (emergency-paused) to block all payment functions.
Once paused, `pay_usdc` and `pay_xlm` will panic with `"contract is paused"`.

Only addresses with the **Pauser** role can pause/unpause.

### Pausing

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --source <PAUSER_SECRET> \
  --network testnet \
  -- pause --caller <PAUSER_G...>
```

### Unpausing

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --source <PAUSER_SECRET> \
  --network testnet \
  -- unpause --caller <PAUSER_G...>
```

### Checking pause state

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --network testnet \
  -- is_paused
```

## Reentrancy Protection

The contract implements a reentrancy guard on `pay_usdc` and `pay_xlm`.
This is a defense-in-depth measure — Soroban's VM already serializes
cross-contract calls, but the guard provides an additional safety layer.

The guard uses a depth counter in instance storage that increments on
entry and decrements on exit. If the counter exceeds the maximum depth
during a payment call, the contract panics with `"reentrancy detected"`.

This guard is transparent to callers — it does not require any additional
parameters or authorization.

## Upgrading the contract

1. Build the new WASM:

   ```
   cd contract
   cargo build --target wasm32-unknown-unknown --release
   ```

2. Upload the new WASM to Stellar:

   ```
   stellar contract install \
     --wasm target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm \
     --source <ADMIN_SECRET> \
     --network mainnet
   ```

   This returns a `WASM_HASH`.

3. Invoke the upgrade function:

   ```
   stellar contract invoke \
     --id $RECEIVER_CONTRACT_ID \
     --source <ADMIN_SECRET> \
     --network mainnet \
     -- upgrade --new_wasm_hash <WASM_HASH>
   ```

4. Verify:
   ```
   stellar contract invoke --id $RECEIVER_CONTRACT_ID --network mainnet -- admin
   ```

## Burning the admin key (making the contract immutable)

If you want to guarantee the contract can never be modified:

```
stellar contract invoke \
  --id $RECEIVER_CONTRACT_ID \
  --source <ADMIN_SECRET> \
  --network mainnet \
  -- set_admin --new_admin GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
```

`GAAA...WHF` is the Stellar "zero address" — no one holds its secret key.
After this call, no future `upgrade` or `set_admin` will succeed.

**This is irreversible.** Test thoroughly on testnet before burning mainnet.

## When to burn

Burn the admin key when:

- The contract logic is stable and you don't expect changes
- You want to signal trustlessness to agents (they can verify the WASM
  hash matches the published source and know it can't be swapped)
- You've validated the contract on mainnet for at least a few weeks

Don't burn if:

- You're still iterating on the event schema
- You haven't tested all edge cases (overflow, multi-asset, etc.)
- You want the option to add new payment assets later
