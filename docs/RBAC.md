# Role-Based Access Control (RBAC) in Stellar_Card Contract

## Overview

The Stellar_Card receiver contract implements a hierarchical Role-Based Access Control (RBAC) system to manage permissions for administrative and operational tasks. The system supports three distinct roles with a clear hierarchy of privileges.

## Role Hierarchy

```
Admin (highest privilege)
  ├─ Can perform all operations
  └─ Satisfies Operator and Viewer requirements

Operator
  ├─ Can perform operational tasks
  └─ Satisfies Viewer requirements

Viewer (lowest privilege)
  ├─ Can view contract state
  └─ Read-only access
```

### Permission Model

| Operation | Admin | Operator | Viewer |
|-----------|-------|----------|--------|
| Deploy/Initialize | ✓ | ✗ | ✗ |
| Upgrade Contract | ✓ | ✗ | ✗ |
| Grant/Revoke Roles | ✓ | ✗ | ✗ |
| Audit Logs | ✓ | ✓ | ✓ |
| Query Balances | ✓ | ✓ | ✓ |
| Treasury Access | ✓ | ✓ | ✗ |
| Payment Processing | ✓ | ✓ | ✗ |

## Role Definitions

### Admin
- **Purpose**: Full contract administration and deployment management
- **Permissions**:
  - Grant and revoke roles to other addresses
  - Upgrade contract WASM code
  - Access all contract data
  - Execute all payment operations
- **Expected Users**: Contract deployer, system administrators
- **Creation**: Assigned during contract initialization

### Operator
- **Purpose**: Operational and payment processing tasks
- **Permissions**:
  - Process payments (USDC and XLM)
  - Access contract state
  - Query balances and configuration
  - Cannot modify roles or upgrade contract
- **Expected Users**: Payment processors, bots
- **Creation**: Granted by Admin via `grant_role()`

### Viewer
- **Purpose**: Read-only access for monitoring and auditing
- **Permissions**:
  - Query contract configuration (treasury, contracts, admin)
  - View payment events (off-chain)
  - Cannot process payments or modify state
- **Expected Users**: Auditors, monitoring systems, dashboards
- **Creation**: Granted by Admin via `grant_role()`

## API Reference

### grant_role

Grants a role to an address. Updates existing role if address already has one.

```rust
pub fn grant_role(env: Env, address: Address, role: Role) -> Result<(), Error>
```

**Parameters**:
- `env`: Soroban environment
- `address`: Address to grant role to
- `role`: Role to assign (Admin, Operator, or Viewer)

**Authorization**: Only Admin can call this function

**Behavior**:
- If address doesn't have a role, creates new assignment
- If address already has a role, overwrites it
- Extends contract TTL (time-to-live) in ledger

**Example**:
```rust
let operator_addr = Address::from_string("G...");
contract.grant_role(operator_addr.clone(), Role::Operator);
```

### revoke_role

Removes a role assignment from an address.

```rust
pub fn revoke_role(env: Env, address: Address) -> Result<(), Error>
```

**Parameters**:
- `env`: Soroban environment
- `address`: Address to revoke role from

**Authorization**: Only Admin can call this function

**Behavior**:
- Removes all role assignments for the address
- If address doesn't have a role, no-op (safe)
- Extends contract TTL

**Example**:
```rust
let user_addr = Address::from_string("G...");
contract.revoke_role(user_addr);
```

### get_role

Queries the role assigned to an address.

```rust
pub fn get_role(env: Env, address: Address) -> Option<Role>
```

**Parameters**:
- `env`: Soroban environment
- `address`: Address to query

**Returns**: 
- `Some(Role)` if address has a role
- `None` if address has no role assigned

**Authorization**: None required (read-only)

**Example**:
```rust
let role = contract.get_role(user_address);
match role {
    Some(Role::Admin) => println!("User is admin"),
    Some(Role::Operator) => println!("User is operator"),
    Some(Role::Viewer) => println!("User is viewer"),
    None => println!("No role assigned"),
}
```

### has_role

Checks if an address has at least the specified role or higher in the hierarchy.

```rust
pub fn has_role(env: Env, address: Address, required_role: Role) -> bool
```

**Parameters**:
- `env`: Soroban environment
- `address`: Address to check
- `required_role`: Minimum required role level

**Returns**:
- `true` if address has the required role or higher
- `false` if address has no role or insufficient privilege

**Hierarchy Evaluation**:
- Admin satisfies Admin, Operator, and Viewer requirements
- Operator satisfies Operator and Viewer requirements
- Viewer satisfies Viewer requirement only

**Authorization**: None required (read-only)

**Example**:
```rust
// Check if user can process payments (requires Operator or Admin)
if contract.has_role(user_address, Role::Operator) {
    // Proceed with payment
}

// Check if user can read balances (requires Viewer or higher)
if contract.has_role(user_address, Role::Viewer) {
    // Return balance info
}
```

## Usage Patterns

### Initialization

During contract initialization, the deployer becomes the Admin:

```rust
contract.init(
    env.clone(),
    admin_address,      // This address becomes Admin
    treasury_address,
    usdc_contract,
    xlm_contract,
);
```

### Adding an Operator

```rust
let operator_address = Address::from_string("GXXXXXX...");
contract.grant_role(operator_address, Role::Operator);
```

### Adding Multiple Viewers

```rust
let auditor_1 = Address::from_string("GXXXXX1...");
let auditor_2 = Address::from_string("GXXXXX2...");

contract.grant_role(auditor_1, Role::Viewer);
contract.grant_role(auditor_2, Role::Viewer);
```

### Revoking Access

```rust
let former_operator = Address::from_string("GXXXXX...");
contract.revoke_role(former_operator);
```

### Promoting Operator to Admin

```rust
let operator_address = Address::from_string("GXXXXX...");
// Grant Admin role (overwrites existing Operator role)
contract.grant_role(operator_address, Role::Admin);
```

## Access Control Patterns

### Payment Authorization Check

```rust
// Example: Only Operators and Admins can process payments
if contract.has_role(caller, Role::Operator) {
    // Process payment
    contract.pay_usdc(caller, amount, order_id)?;
} else {
    // Unauthorized
    return Err(Error::Unauthorized);
}
```

### Read-Only Access

```rust
// Example: Viewers can only read state
if contract.has_role(caller, Role::Viewer) {
    let treasury = contract.treasury();
    // Return info to caller
}
```

## Storage

### Role Storage Structure

Roles are stored in persistent contract storage:

```
Storage::Persistent
  └─ DataKey::Roles
      └─ Map<Address, Role>
          ├─ admin_address → Role::Admin
          ├─ operator_1 → Role::Operator
          ├─ operator_2 → Role::Operator
          └─ auditor_1 → Role::Viewer
```

### Storage Efficiency

- **Storage key**: One entry per role assignment
- **Entry size**: Address (32 bytes) + Role (1 byte enum) = 33 bytes per entry
- **Scalability**: Supports thousands of role assignments before hitting Soroban limits

### Storage Persistence

- Role assignments persist across contract upgrades
- Storage entries expire after ledger TTL (default: 120 days)
- Each role modification resets TTL to maximum

## Security Considerations

### Authorization Checks

All role-modifying operations require explicit authorization:

```rust
pub fn grant_role(env: Env, address: Address, role: Role) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();  // Only Admin can call this
    // ...
}
```

- `require_auth()` ensures the caller is who they claim to be
- Prevents unauthorized role assignments
- Checks signatures on every invocation

### Atomic Operations

Role assignments are atomic:

```rust
// Atomic: either completes fully or not at all
roles.set(address, role);
env.storage().instance().set(&DataKey::Roles, &roles);
```

- No partial updates possible
- Map replacement is atomic at the storage level
- TTL extension is bundled with role update

### Attack Vectors Mitigated

| Attack | Vector | Mitigation |
|--------|--------|-----------|
| **Unauthorized elevation** | Caller gains Admin role without permission | `require_auth()` on caller |
| **Privilege escalation** | Operator promotes self to Admin | Only Admin can grant roles |
| **Role spoof** | Claiming to have role without assignment | Check `has_role()` before operation |
| **Storage corruption** | Malicious role assignment | Atomic updates, state validation |

## Testing

### Unit Test Coverage

Comprehensive tests verify:

1. **Grant Role**
   - Granting to new address
   - Overwriting existing role
   - Role hierarchy enforcement
   - Authorization checks

2. **Revoke Role**
   - Revoking existing role
   - Revoking non-existent role (no-op)
   - Authorization checks

3. **Get Role**
   - Returning correct role
   - Returning None for unassigned address

4. **Has Role**
   - Hierarchy evaluation (Admin > Operator > Viewer)
   - Multiple role checks on same address
   - Unassigned address returns false

5. **Authorization**
   - Only Admin can grant roles
   - Only Admin can revoke roles
   - Non-admin calls panic appropriately

6. **State Persistence**
   - Role assignments persist across calls
   - Multiple users don't interfere
   - TTL extension works correctly

### Test Examples

```rust
#[test]
fn test_grant_role_hierarchy() {
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Grant Viewer
    contract.grant_role(&user, &Role::Viewer);
    assert_eq!(contract.get_role(&user), Some(Role::Viewer));
    
    // Upgrade to Operator
    contract.grant_role(&user, &Role::Operator);
    assert_eq!(contract.get_role(&user), Some(Role::Operator));
    
    // Verify hierarchy
    assert!(contract.has_role(&user, &Role::Viewer));
    assert!(contract.has_role(&user, &Role::Operator));
    assert!(!contract.has_role(&user, &Role::Admin));
}

#[test]
fn test_multiple_users_independence() {
    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    contract.grant_role(&user1, &Role::Operator);
    contract.grant_role(&user2, &Role::Viewer);
    
    // Revoking user1 doesn't affect user2
    contract.revoke_role(&user1);
    assert_eq!(contract.get_role(&user1), None);
    assert_eq!(contract.get_role(&user2), Some(Role::Viewer));
}
```

## Operations Guide

### Common Tasks

#### Assign an Operator

```bash
# From Admin account
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_PRIVATE_KEY> \
  -- grant_role \
  --address G<OPERATOR_ADDRESS> \
  --role Operator
```

#### Check User's Role

```bash
# From any account
stellar contract invoke \
  --id <CONTRACT_ID> \
  -- get_role \
  --address G<USER_ADDRESS>
```

#### Verify Access Level

```bash
# Check if user can process payments
stellar contract invoke \
  --id <CONTRACT_ID> \
  -- has_role \
  --address G<USER_ADDRESS> \
  --required_role Operator
```

#### Remove Access

```bash
# From Admin account
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_PRIVATE_KEY> \
  -- revoke_role \
  --address G<USER_ADDRESS>
```

## Monitoring and Auditing

### Audit Logging

Track all role changes:

1. **Contract events**: Emitted on grant/revoke (implement as needed)
2. **Off-chain logging**: Log all role modifications
3. **Regular audits**: Query contract state and verify assignments

### Recommended Monitoring

```bash
# Periodic role audit (daily)
stellar contract invoke --id <ID> -- get_role --address <ADDRESS>

# Alert on unexpected Admin assignments
# Alert on Operator assignments without approval
# Monitor for revocations and re-grants (could indicate compromise)
```

## FAQ

**Q: Can a user have multiple roles?**
A: No, each address can have only one role at a time. Granting a new role overwrites the previous one.

**Q: What happens if the Admin address is compromised?**
A: The compromised Admin could grant/revoke any roles. Mitigation: Upgrade contract to new Admin or use multi-sig governance.

**Q: Are roles persisted across contract upgrades?**
A: Yes, role data is stored persistently and survives upgrades.

**Q: How do I transfer Admin role?**
A: Grant the Admin role to the new address, then the old Admin revokes their own role.

**Q: Can role checks be bypassed?**
A: No, `require_auth()` and `has_role()` checks are enforced at the contract level.

**Q: What's the scalability limit?**
A: Soroban supports thousands of role entries in the Map before storage limits apply.

## References

- [Soroban Contract Authorization](https://developers.stellar.org/docs/learn/soroban/rust-contract-fundamentals/authorization)
- [Soroban Storage](https://developers.stellar.org/docs/learn/soroban/rust-contract-fundamentals/storage)
- [Stellar_Card Contract Deployment](./DEPLOYMENT.md)
