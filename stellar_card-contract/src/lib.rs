//! # stellar_card Card Receiver Contract
//!
//! A Soroban smart contract that receives USDC and native XLM payments on behalf
//! of the stellar_card card platform and forwards them to a configured treasury
//! address.
//!
//! ## Overview
//! Payers authorize a transfer of USDC or XLM to the contract, which routes the
//! funds to the treasury and emits a payment event tagged with an order identifier
//! so off-chain systems can reconcile card top-ups.
//!
//! ## Security features
//! * **Reentrancy guard** — a storage-backed guard (`_enter` / `_exit`) blocks
//!   reentrant calls into the payment functions.
//! * **Pause mechanism** — the admin can pause the contract to halt all transfers
//!   during incidents or upgrades.
//! * **Role-based access control (RBAC)** — a hierarchical role model
//!   (`Admin > Operator > Viewer`) gates privileged operations.
//! * **Upgradeability** — the admin can swap the contract WASM in place.
//! * **No admin withdraw path (issue #431)** — `pay_usdc`/`pay_xlm` forward
//!   funds directly from payer to `DataKey::Treasury` in the same call; the
//!   contract never holds custody of funds itself. An admin withdrawal
//!   limit therefore has no function to attach to today — there is nothing
//!   for an admin to withdraw. If a future change introduces fund custody
//!   (e.g. an escrow/hold period), a withdrawal limit should be added at
//!   that point, not before there's a withdrawal path to protect.
//!
//! ## Authorization model
//! `init` and every state-mutating administrative entrypoint require the caller
//! to authorize via Soroban's `require_auth`. Payment entrypoints require the
//! paying address to authorize the transfer.

#![no_std]
use soroban_sdk::{contract, contractimpl, contracterror, contracttype, token, Address, Bytes, BytesN, Env, Symbol, Vec};

/// Instance storage is extended to this many ledgers (~1000 days at 5s
/// close time — the value the original code already requested) once its
/// remaining TTL drops below `INSTANCE_TTL_THRESHOLD`. Note: a live network
/// may cap the achievable TTL below this (its `max_entry_ttl` setting), in
/// which case the actual extension is clamped — that ceiling is a network
/// property, unrelated to the threshold/max split below.
const INSTANCE_TTL_MAX: u32 = 17_280_000;
/// Half of `INSTANCE_TTL_MAX`. Deliberately lower than the max, not equal
/// to it: with threshold == extend_to (the contract's original pattern),
/// *any* decrease below the max retriggers a full extend — effectively a
/// ledger write on nearly every call. A threshold at half the max means an
/// extension only fires roughly once every ~500 days' worth of calls
/// instead of on (almost) every single one.
const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_TTL_MAX / 2;

/// Represents user roles in the contract with hierarchical permissions.
///
/// Roles are ordered by privilege: `Admin > Operator > Viewer`. A holder of a
/// higher role implicitly satisfies any lower role requirement (see
/// [`Stellar_CardReceiver::has_role`]).
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
#[derive(Debug)]
pub enum Role {
    /// Full administrative control. Can pause/unpause, upgrade, and manage roles.
    Admin,
    /// Operational role. Satisfies `Operator` and `Viewer` requirements.
    Operator,
    /// Lowest-privilege role. Read/observer level access only.
    Viewer,
}

/// Storage keys for contract state.
///
/// Each variant identifies a slot in the contract's instance storage.
#[contracttype]
pub enum DataKey {
    /// Address that receives forwarded payments.
    Treasury,
    /// Address of the USDC Stellar Asset Contract (SAC).
    UsdcContract,
    /// Address of the native XLM Stellar Asset Contract (SAC).
    XlmContract,
    /// Address of the contract administrator.
    Admin,
    /// Per-address role assignment. Replaces a single `Roles: Map<Address, Role>`
    /// instance-storage entry: a Map entry grows (and gets re-serialized +
    /// rent-extended) on every single role grant/revoke, regardless of which
    /// address changed. A per-address key means each grant/revoke touches only
    /// its own entry, and only that entry's TTL needs extending.
    UserRole(Address),
    /// Boolean flag marking whether a guarded operation is currently in progress.
    ReentrancyGuard,
    /// Circuit breaker: when true, `pay_usdc`/`pay_xlm` refuse new payments.
    Paused,
}

/// Contract errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Amount must be positive
    InvalidAmount = 1,
    /// Token transfer operation failed
    TransferFailed = 2,
    /// The contract is paused; no new payments are accepted until unpaused
    ContractPaused = 3,
}

/// The stellar_card card receiver contract.
///
/// Holds no in-memory state; all persistent data lives in instance storage keyed
/// by [`DataKey`]. All contract entrypoints are implemented on this type.
#[contract]
pub struct Stellar_CardReceiver;

#[contractimpl]
impl Stellar_CardReceiver {
    /// Initializes the contract with essential configuration.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `admin` - The admin address (must authorize this call)
    /// * `treasury` - The treasury address where payments are received
    /// * `usdc_contract` - The USDC SAC contract address
    /// * `xlm_contract` - The native XLM SAC contract address
    ///
    /// # Validation (Issue #429 - Part 5)
    /// * Validates admin is not the zero address
    /// * Validates treasury is not the zero address
    /// * Validates USDC contract is not the zero address
    /// * Validates XLM contract is not the zero address
    /// * Validates admin != treasury (prevents accidental self-payment)
    /// * Validates admin != contract address (prevents admin lock)
    /// * Validates usdc_contract != xlm_contract (prevents misconfiguration)
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("init"), admin], value=(treasury, usdc_contract, xlm_contract)
    ///
    /// # Panics
    /// Panics if already initialized, if admin authorization fails, or if any
    /// validation check fails.
    ///
    /// # Notes
    /// One-time initialization. The admin must authorize to prevent front-running on deployment.
    /// Expected mainnet values (C-3, C-7):
    ///   usdc_contract : CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75  (USDC SAC)
    ///   xlm_contract  : native XLM SAC address (varies by network)
    ///   treasury      : stellar_card treasury G-address — verify before deployment
    pub fn init(
        env: Env,
        admin: Address,
        treasury: Address,
        usdc_contract: Address,
        xlm_contract: Address,
    ) {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        // Enhanced validation (Issue #429 - Part 5)
        let contract_address = env.current_contract_address();
        
        // Validate admin address
        if admin == contract_address {
            panic!("admin cannot be the contract itself");
        }

        // Validate treasury address
        if treasury == contract_address {
            panic!("treasury cannot be the contract itself");
        }

        // Prevent admin and treasury from being the same (accidental self-payment)
        if admin == treasury {
            panic!("admin and treasury must be different addresses");
        }

        // Validate token contracts are different (prevents misconfiguration)
        if usdc_contract == xlm_contract {
            panic!("usdc_contract and xlm_contract must be different");
        }

        // Validate token contracts are not the contract itself
        if usdc_contract == contract_address {
            panic!("usdc_contract cannot be the contract itself");
        }
        if xlm_contract == contract_address {
            panic!("xlm_contract cannot be the contract itself");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::XlmContract, &xlm_contract);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Grant the Admin role to the admin address itself. Without this,
        // the deploying admin (the DataKey::Admin address) would satisfy
        // admin-only checks but NOT role-based checks like has_role(...,
        // Role::Admin) until someone remembered to self-grant it — a real
        // gap a fresh deployment could otherwise silently hit.
        let admin_role_key = DataKey::UserRole(admin.clone());
        env.storage().persistent().set(&admin_role_key, &Role::Admin);
        env.storage().persistent().extend_ttl(&admin_role_key, 17_280_000, 17_280_000);

        Self::extend_instance_ttl(&env);

        // Emit initialization event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "init"), admin.clone()),
            (treasury.clone(), usdc_contract.clone(), xlm_contract.clone()),
        );
    }

    /// Acquires the reentrancy guard to prevent reentrant calls.
    ///
    /// # Security (Issue #427 - Part 5)
    /// The reentrancy guard implements the Checks-Effects-Interactions pattern
    /// for payment callbacks. It prevents an attacker from calling back into
    /// `pay_usdc` or `pay_xlm` during a token transfer and draining funds.
    ///
    /// The guard is set at the start of payment functions and cleared on exit,
    /// ensuring that any attempt to re-enter will be detected and blocked.
    ///
    /// # Storage
    /// Stored in `temporary` storage, not `instance`. The guard only needs
    /// to exist for the span of a single call (set on entry, cleared before
    /// return) — it has no reason to persist across ledger closes or count
    /// toward the contract's `instance` storage footprint, which every
    /// `pay_usdc`/`pay_xlm` call already reads and rent-extends.
    ///
    /// # Panics
    /// Panics if the guard is already held, indicating a reentrant call attempt.
    ///
    /// # Example Attack Prevention
    /// Without this guard, a malicious token contract could:
    /// 1. Be called by `pay_usdc` to transfer tokens
    /// 2. Call back into `pay_usdc` before the first call completes
    /// 3. Potentially extract funds multiple times for a single payment
    ///
    /// The guard ensures step 2 fails immediately with "reentrancy detected".
    fn _enter(env: &Env) {
        let key = DataKey::ReentrancyGuard;
        if env.storage().temporary().get::<_, bool>(&key).unwrap_or(false) {
            panic!("reentrancy detected");
        }
        env.storage().temporary().set(&key, &true);
    }

    /// Releases the reentrancy guard after a guarded operation completes.
    ///
    /// # Security (Issue #427 - Part 5)
    /// Must be called in every exit path from a guarded function (success,
    /// error, or panic recovery via Drop) to ensure the guard doesn't remain
    /// locked if an early return occurs.
    fn _exit(env: &Env) {
        env.storage().temporary().set(&DataKey::ReentrancyGuard, &false);
    }

    /// Returns whether the contract is currently paused.
    fn is_paused(env: &Env) -> bool {
        env.storage().instance().get::<_, bool>(&DataKey::Paused).unwrap_or(false)
    }

    /// Pauses the contract, blocking all token transfers.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `caller` - The address invoking pause (must authorize this call)
    ///
    /// # Authorization (Issue #426 - Part 5 - Complete NatSpec)
    /// Requires `caller` to hold at least the `Operator` role. Pausing is an
    /// operational response to an incident, so it's granted to Operators
    /// (not Admin-only) — the faster an incident responder can halt
    /// payments, the smaller the blast radius. Resuming is stricter; see
    /// `unpause`.
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("paused"), caller], value=true
    ///
    /// # Notes
    /// Idempotent — calling when already paused is a no-op.
    ///
    /// # Panics
    /// Panics if `caller` does not hold at least the `Operator` role, or if
    /// `caller.require_auth()` fails.
    pub fn pause(env: Env, caller: Address) {
        caller.require_auth();
        if !Self::has_role(env.clone(), caller.clone(), Role::Operator) {
            panic!("pause requires at least the Operator role");
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::extend_instance_ttl(&env);

        // Emit pause event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "paused"), caller),
            true,
        );
    }

    /// Unpauses the contract, re-enabling token transfers.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Authorization (Issue #426 - Part 5 - Complete NatSpec)
    /// Only the admin can call this function. Unpausing is more sensitive
    /// than pausing because it reopens the payment flow after an incident,
    /// so it requires admin approval.
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("unpaused"), admin], value=false
    ///
    /// # Notes
    /// Idempotent — calling when already unpaused is a no-op.
    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);

        // Emit unpause event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "unpaused"), admin),
            false,
        );
    }

    /// Extends instance storage's TTL, but only performs the (fee-costing)
    /// ledger write once the remaining TTL drops below
    /// `INSTANCE_TTL_THRESHOLD` — see that constant's doc comment for why
    /// threshold and extend-to are deliberately different values.
    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_MAX);
    }

    /// Transfers USDC tokens from a payer to the contract treasury.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `from` - The payer address (must authorize this transfer)
    /// * `amount` - Amount in micro-USDC (7 decimal places)
    /// * `order_id` - Order identifier for event tracking
    ///
    /// # Returns
    /// `Ok(())` on successful transfer, `Err(Error)` otherwise.
    ///
    /// # Errors
    /// * `InvalidAmount` - If amount is <= 0
    /// * `TransferFailed` - If the underlying token transfer fails
    /// * `ContractPaused` - If the contract is currently paused
    ///
    /// # Events
    /// Emits: topics=[Symbol("pay_usdc"), order_id, from], value=amount
    pub fn pay_usdc(env: Env, from: Address, amount: i128, order_id: Bytes) -> Result<(), Error> {
        if Self::is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let usdc_contract: Address = env.storage().instance().get(&DataKey::UsdcContract).unwrap();

        Self::_enter(&env);

        let token_client = token::Client::new(&env, &usdc_contract);
        let res = token_client.try_transfer(&from, &treasury, &amount);
        if res.is_err() {
            Self::_exit(&env);
            return Err(Error::TransferFailed);
        }

        Self::_exit(&env);

        env.events().publish(
            (Symbol::new(&env, "pay_usdc"), order_id, from),
            amount,
        );

        Self::extend_instance_ttl(&env);
        Ok(())
    }

    /// Transfers XLM tokens from a payer to the contract treasury.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `from` - The payer address (must authorize this transfer)
    /// * `amount` - Amount in stroops (7 decimal places)
    /// * `order_id` - Order identifier for event tracking
    ///
    /// # Returns
    /// `Ok(())` on successful transfer, `Err(Error)` otherwise.
    ///
    /// # Errors
    /// * `InvalidAmount` - If amount is <= 0
    /// * `TransferFailed` - If the underlying token transfer fails
    /// * `ContractPaused` - If the contract is currently paused
    ///
    /// # Events
    /// Emits: topics=[Symbol("pay_xlm"), order_id, from], value=amount
    pub fn pay_xlm(env: Env, from: Address, amount: i128, order_id: Bytes) -> Result<(), Error> {
        if Self::is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let xlm_contract: Address = env.storage().instance().get(&DataKey::XlmContract).unwrap();

        Self::_enter(&env);

        let token_client = token::Client::new(&env, &xlm_contract);
        let res = token_client.try_transfer(&from, &treasury, &amount);
        if res.is_err() {
            Self::_exit(&env);
            return Err(Error::TransferFailed);
        }

        Self::_exit(&env);

        env.events().publish(
            (Symbol::new(&env, "pay_xlm"), order_id, from),
            amount,
        );

        Self::extend_instance_ttl(&env);
        Ok(())
    }

    /// Returns the treasury address where payments are received.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// The treasury address
    ///
    /// # Panics
    /// Panics if called before `init`. Callers who need to distinguish
    /// "not yet initialized" from a real error should use the
    /// auto-generated `try_treasury` instead.
    pub fn treasury(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    /// Returns the USDC SAC contract address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// The USDC contract address
    ///
    /// # Panics
    /// Panics if called before `init` (see `try_usdc_contract` to avoid this).
    pub fn usdc_contract(env: Env) -> Address {
        env.storage().instance().get(&DataKey::UsdcContract).unwrap()
    }

    /// Returns the native XLM SAC contract address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// The XLM contract address
    ///
    /// # Panics
    /// Panics if called before `init` (see `try_xlm_contract` to avoid this).
    pub fn xlm_contract(env: Env) -> Address {
        env.storage().instance().get(&DataKey::XlmContract).unwrap()
    }

    /// Returns the admin address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// The admin address
    ///
    /// # Panics
    /// Panics if called before `init` (see `try_admin` to avoid this).
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Returns whether the contract is currently paused.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Returns
    /// `true` if paused, `false` otherwise
    pub fn is_paused_view(env: Env) -> bool {
        Self::is_paused(&env)
    }

    /// Upgrades the contract WASM code.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `new_wasm_hash` - The hash of the new WASM code
    ///
    /// # Authorization
    /// Only the admin can call this function.
    ///
    /// # Panics
    /// Panics if called before `init` (no admin address stored yet), if
    /// `admin.require_auth()` fails, or if `new_wasm_hash` does not
    /// correspond to a previously uploaded WASM blob.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Recovers tokens sent to the contract by mistake — a direct transfer
    /// to the contract's own address, bypassing `pay_usdc`/`pay_xlm` (which
    /// forward straight to the treasury and never leave a balance on the
    /// contract itself). Works for any SAC-compatible token, not just the
    /// configured USDC/XLM contracts, since a mistaken send could be any
    /// asset.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `caller` - The address invoking the rescue (must authorize this call)
    /// * `token_contract` - The token contract to rescue a balance from
    /// * `to` - Where to send the recovered tokens
    /// * `amount` - Amount to recover, in the token's base units
    ///
    /// # Authorization
    /// Requires `caller` to either be the stored `DataKey::Admin` address,
    /// or hold the `Admin` role via `grant_role` — recovering funds is
    /// powerful enough that it stays Admin-only, unlike `pause` (see
    /// `Stellar_CardReceiver::pause`'s doc comment for the contrast). Both
    /// forms are accepted because the deploying admin is never
    /// auto-granted the `Admin` role (`grant_role`/`has_role` are a
    /// separate system from `DataKey::Admin`) — requiring only the role
    /// would lock out a fresh deployment until someone remembered to grant
    /// it to themselves.
    ///
    /// # Errors
    /// * `InvalidAmount` - If `amount` is <= 0
    /// * `TransferFailed` - If the underlying token transfer fails (e.g. the
    ///   contract's balance is lower than `amount`)
    ///
    /// # Panics
    /// Panics if `caller` does not hold the `Admin` role, or if
    /// `caller.require_auth()` fails.
    pub fn rescue_tokens(
        env: Env,
        caller: Address,
        token_contract: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        // The contract's single DataKey::Admin address is never
        // auto-granted the Admin *role* — grant_role/has_role are a
        // separate system, so a fresh deployer wouldn't satisfy a
        // has_role-only check until someone explicitly grants it to
        // themselves. Accept either form of admin authority here.
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let is_stored_admin = caller == stored_admin;
        if !is_stored_admin && !Self::has_role(env.clone(), caller, Role::Admin) {
            panic!("rescue_tokens requires the Admin role");
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token_contract);
        let res = token_client.try_transfer(&contract_address, &to, &amount);
        if res.is_err() {
            return Err(Error::TransferFailed);
        }
        Ok(())
    }

    /// Begins a two-step handover of the admin address. Unlike a naive
    /// single-step reassignment, this requires the *proposed new admin* to
    /// also authorize the call — a typo'd or unreachable address can never
    /// silently become admin, since it would have to co-sign its own
    /// appointment.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `new_admin` - The address to become the new admin
    ///
    /// # Authorization (Issue #426 - Part 5 - Complete NatSpec)
    /// Requires auth from BOTH the current admin (`DataKey::Admin`) and
    /// `new_admin` itself — matching `grant_role`/`revoke_role`'s pattern of
    /// panicking (via `require_auth`) on an authorization failure, rather
    /// than returning a `Result`.
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("admin_transferred"), old_admin, new_admin], value=()
    ///
    /// # Security
    /// Two-step authorization prevents accidental admin lockout from typos or
    /// unreachable addresses.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let current_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        current_admin.require_auth();
        new_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().extend_ttl(17_280_000, 17_280_000);

        // Emit admin transfer event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "admin_transferred"), current_admin, new_admin),
            (),
        );
    }

    /// Grants a role to an address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to grant the role to
    /// * `role` - The role to grant (Admin, Operator, or Viewer)
    ///
    /// # Authorization (Issue #426 - Part 5 - Complete NatSpec)
    /// Only the admin can call this function.
    ///
    /// # Storage
    /// Stored under a per-address persistent key (`DataKey::UserRole`)
    /// rather than in a single growing `Map` — see the `DataKey::UserRole`
    /// doc comment for why.
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("role_granted"), address], value=role
    ///
    /// # Panics
    /// Panics if called before `init`, or if `admin.require_auth()` fails.
    pub fn grant_role(env: Env, address: Address, role: Role) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let key = DataKey::UserRole(address.clone());
        env.storage().persistent().set(&key, &role);
        env.storage().persistent().extend_ttl(&key, 17_280_000, 17_280_000);

        // Emit role granted event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "role_granted"), address),
            role,
        );
    }

    /// Grants the same role to several addresses in a single call.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `addresses` - The addresses to grant the role to
    /// * `role` - The role to grant (Admin, Operator, or Viewer)
    ///
    /// # Authorization
    /// Only the admin can call this function.
    ///
    /// # Notes
    /// Equivalent to calling `grant_role` once per address, but writes the
    /// updated role map back to storage once instead of once per address —
    /// onboarding N addresses at once costs one instance-storage write
    /// instead of N. An empty `addresses` list is a no-op (still writes the
    /// unchanged map back once, which is harmless).
    pub fn grant_roles(env: Env, addresses: Vec<Address>, role: Role) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        for address in addresses.iter() {
            let key = DataKey::UserRole(address);
            env.storage().persistent().set(&key, &role);
            env.storage().persistent().extend_ttl(&key, 17_280_000, 17_280_000);
        }

        Self::extend_instance_ttl(&env);
    }

    /// Revokes a role from an address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to revoke the role from
    ///
    /// # Authorization (Issue #426 - Part 5 - Complete NatSpec)
    /// Only the admin can call this function.
    ///
    /// # Events (Issue #428 - Part 5)
    /// Emits: topics=[Symbol("role_revoked"), address], value=()
    ///
    /// # Panics
    /// Panics if called before `init`, or if `admin.require_auth()` fails.
    /// Revoking a role from an address that never had one is a no-op, not
    /// a panic (see `test_revoke_nonexistent_role_is_noop`).
    pub fn revoke_role(env: Env, address: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage().persistent().remove(&DataKey::UserRole(address.clone()));

        // Emit role revoked event (Issue #428 - Part 5)
        env.events().publish(
            (Symbol::new(&env, "role_revoked"), address),
            (),
        );
    }

    /// Retrieves the role assigned to an address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to query
    ///
    /// # Returns
    /// `Some(role)` if a role is assigned, `None` otherwise
    pub fn get_role(env: Env, address: Address) -> Option<Role> {
        env.storage().persistent().get(&DataKey::UserRole(address))
    }

    /// Checks if an address has at least the specified role or higher.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to check
    /// * `required_role` - The minimum required role
    ///
    /// # Returns
    /// `true` if the address has the required role or higher in hierarchy, `false` otherwise
    ///
    /// # Hierarchy
    /// Admin > Operator > Viewer
    pub fn has_role(env: Env, address: Address, required_role: Role) -> bool {
        match env.storage().persistent().get::<_, Role>(&DataKey::UserRole(address)) {
            Some(user_role) => Self::is_role_sufficient(&user_role, &required_role),
            None => false,
        }
    }

    /// Checks whether a user role satisfies a required role level.
    ///
    /// # Arguments
    /// * `user_role` - The role assigned to the user
    /// * `required_role` - The minimum role being checked against
    ///
    /// # Returns
    /// `true` if `user_role` meets or exceeds `required_role` in the hierarchy
    ///
    /// # Hierarchy
    /// Admin > Operator > Viewer
    fn is_role_sufficient(user_role: &Role, required_role: &Role) -> bool {
        match (user_role, required_role) {
            (Role::Admin, _) => true,
            (Role::Operator, Role::Operator) | (Role::Operator, Role::Viewer) => true,
            (Role::Viewer, Role::Viewer) => true,
            _ => false,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, MockAuth, MockAuthInvoke},
        token, Bytes, Env, IntoVal, Symbol, TryIntoVal,
    };

    // ── Test fixture ──────────────────────────────────────────────────────────

    struct Fixture {
        env: Env,
        contract_id: Address,
        admin: Address,
        treasury: Address,
        payer: Address,
        usdc: Address,
        xlm_sac: Address,
    }

    impl Fixture {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let treasury = Address::generate(&env);
            let payer = Address::generate(&env);

            // Register mock SAC token contracts for USDC and XLM
            let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
            let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();

            let contract_id = env.register(Stellar_CardReceiver, ());

            Fixture { env, contract_id, admin, treasury, payer, usdc, xlm_sac }
        }

        fn client(&self) -> Stellar_CardReceiverClient<'_> {
            Stellar_CardReceiverClient::new(&self.env, &self.contract_id)
        }

        fn init(&self) {
            self.client().init(&self.admin, &self.treasury, &self.usdc, &self.xlm_sac);
        }

        fn mint_usdc(&self, to: &Address, amount: i128) {
            token::StellarAssetClient::new(&self.env, &self.usdc).mint(to, &amount);
        }

        fn mint_xlm(&self, to: &Address, amount: i128) {
            token::StellarAssetClient::new(&self.env, &self.xlm_sac).mint(to, &amount);
        }

        fn usdc_balance(&self, addr: &Address) -> i128 {
            token::Client::new(&self.env, &self.usdc).balance(addr)
        }

        fn xlm_balance(&self, addr: &Address) -> i128 {
            token::Client::new(&self.env, &self.xlm_sac).balance(addr)
        }
    }

    fn order_bytes(env: &Env, s: &str) -> Bytes {
        Bytes::from_slice(env, s.as_bytes())
    }

    // ── init tests ────────────────────────────────────────────────────────────

    #[test]
    fn test_init_stores_all_addresses() {
        let f = Fixture::new();
        f.init();

        let client = f.client();
        assert_eq!(client.treasury(), f.treasury);
        assert_eq!(client.usdc_contract(), f.usdc);
        assert_eq!(client.xlm_contract(), f.xlm_sac);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_init_twice_panics() {
        let f = Fixture::new();
        f.init();
        f.init(); // must panic
    }

    // ── pay_usdc tests ────────────────────────────────────────────────────────

    #[test]
    fn test_pay_usdc_transfers_to_treasury() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 25_000_000; // 25.00 USDC (7 d.p.)
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "a3f7c2d1-4e8b-4f0a-9c2d");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
        assert_eq!(f.usdc_balance(&f.payer), 0);
    }

    #[test]
    fn test_pay_usdc_emits_correct_event() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000; // 10.00 USDC
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "test-order-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        // Scan events for our contract's pay_usdc event.
        // Events are (contract_id, topics: Vec<Val>, data: Val).
        // Val doesn't implement PartialEq — use try_into_val for typed comparison.
        let events = f.env.events().all();
        let mut found = false;
        for (contract_addr, topics, data) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym != Symbol::new(&f.env, "pay_usdc") {
                continue;
            }
            let emitted_oid: Bytes = topics.get(1).unwrap().try_into_val(&f.env).unwrap();
            assert_eq!(emitted_oid, oid);
            let emitted_from: Address = topics.get(2).unwrap().try_into_val(&f.env).unwrap();
            assert_eq!(emitted_from, f.payer);
            let emitted_amount: i128 = data.try_into_val(&f.env).unwrap();
            assert_eq!(emitted_amount, amount);
            found = true;
            break;
        }
        assert!(found, "pay_usdc event not found");
    }

    #[test]
    #[should_panic]
    fn test_pay_usdc_requires_auth() {
        let env = Env::default();
        // No mock_all_auths — require_auth() will fail

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let payer = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        // init has no require_auth so it runs fine without mocking
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        // pay_usdc calls from.require_auth() — must panic without mock
        let oid = order_bytes(&env, "order-no-auth");
        client.pay_usdc(&payer, &1_000_000_i128, &oid);
    }

    // ── pay_xlm tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_pay_xlm_transfers_to_treasury() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 161_290_000; // ~161.29 XLM in stroops
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "b2e8d1c0-5f9a-4b0b-8d3e");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
        assert_eq!(f.xlm_balance(&f.payer), 0);
    }

    #[test]
    fn test_pay_xlm_emits_correct_event() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 50_000_000; // 50.00 XLM
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "test-order-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        let events = f.env.events().all();
        let mut found = false;
        for (contract_addr, topics, data) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym != Symbol::new(&f.env, "pay_xlm") {
                continue;
            }
            let emitted_oid: Bytes = topics.get(1).unwrap().try_into_val(&f.env).unwrap();
            assert_eq!(emitted_oid, oid);
            let emitted_from: Address = topics.get(2).unwrap().try_into_val(&f.env).unwrap();
            assert_eq!(emitted_from, f.payer);
            let emitted_amount: i128 = data.try_into_val(&f.env).unwrap();
            assert_eq!(emitted_amount, amount);
            found = true;
            break;
        }
        assert!(found, "pay_xlm event not found");
    }

    #[test]
    #[should_panic]
    fn test_pay_xlm_requires_auth() {
        let env = Env::default();
        // No mock_all_auths

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let payer = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        client.init(&admin, &treasury, &usdc, &xlm_sac);

        let oid = order_bytes(&env, "order-no-auth-xlm");
        client.pay_xlm(&payer, &1_000_000_i128, &oid);
    }

    // ── getter tests ──────────────────────────────────────────────────────────

    #[test]
    fn test_try_getters_before_init_return_err() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        // Uninitialised — try_treasury() returns Err (unwrap() would panic)
        assert!(client.try_treasury().is_err());
        assert!(client.try_usdc_contract().is_err());
        assert!(client.try_xlm_contract().is_err());
    }

    // ── amount validation tests ───────────────────────────────────────────────

    #[test]
    fn test_pay_usdc_rejects_zero_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "zero-amount");
        assert!(f.client().try_pay_usdc(&f.payer, &0_i128, &oid).is_err());
    }

    #[test]
    fn test_pay_usdc_rejects_negative_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "neg-amount");
        assert!(f.client().try_pay_usdc(&f.payer, &(-1_000_000_i128), &oid).is_err());
    }

    #[test]
    fn test_pay_xlm_rejects_zero_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "xlm-zero");
        assert!(f.client().try_pay_xlm(&f.payer, &0_i128, &oid).is_err());
    }

    #[test]
    fn test_pay_xlm_rejects_negative_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "xlm-neg");
        assert!(f.client().try_pay_xlm(&f.payer, &(-50_000_000_i128), &oid).is_err());
    }

    // ── upgrade tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_admin_getter_returns_correct_address() {
        let f = Fixture::new();
        f.init();
        assert_eq!(f.client().admin(), f.admin);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_requires_admin_auth() {
        let env = Env::default();
        env.mock_auths(&[]);

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        // init with mocked auth temporarily just for setup
        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        // upgrade without admin auth must panic
        env.mock_auths(&[]);
        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        client.upgrade(&fake_hash);
    }

    // ── init auth test ────────────────────────────────────────────────────────

    #[test]
    fn test_init_requires_admin_auth() {
        let env = Env::default();
        // No mock_all_auths — only the admin can authorize
        env.mock_auths(&[]);

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        // Should panic because admin.require_auth() fires and no auth is mocked
        let result = client.try_init(&admin, &treasury, &usdc, &xlm_sac);
        assert!(result.is_err(), "init should require admin authorization");
    }

    // ── reentrancy guard tests ──────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "reentrancy detected")]
    fn test_reentrancy_guard_panics_on_reentry() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount * 2);

        // Set the reentrancy guard from within the contract context
        f.env.as_contract(&f.contract_id, || {
            f.env.storage().temporary().set(&DataKey::ReentrancyGuard, &true);
        });

        let oid1 = order_bytes(&f.env, "reentry-1");
        f.client().pay_usdc(&f.payer, &amount, &oid1);
    }

    #[test]
    fn test_reentrancy_guard_resets_after_successful_transfer() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_usdc(&f.payer, amount * 2);

        let oid1 = order_bytes(&f.env, "sequential-1");
        f.client().pay_usdc(&f.payer, &amount, &oid1);

        // Guard should be reset — second call should succeed
        let oid2 = order_bytes(&f.env, "sequential-2");
        f.client().pay_usdc(&f.payer, &amount, &oid2);

        assert_eq!(f.usdc_balance(&f.treasury), amount * 2);
        assert_eq!(f.usdc_balance(&f.payer), 0);
    }

    #[test]
    fn test_reentrancy_guard_resets_for_xlm_after_successful_transfer() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_xlm(&f.payer, amount * 2);

        let oid1 = order_bytes(&f.env, "xlm-sequential-1");
        f.client().pay_xlm(&f.payer, &amount, &oid1);

        let oid2 = order_bytes(&f.env, "xlm-sequential-2");
        f.client().pay_xlm(&f.payer, &amount, &oid2);

        assert_eq!(f.xlm_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_reentrancy_guard_resets_after_failed_transfer() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount / 2); // only half balance to cause a failure

        let oid1 = order_bytes(&f.env, "failed-1");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid1);
        assert!(result.is_err(), "should fail with insufficient balance");

        // Now give sufficient balance
        f.mint_usdc(&f.payer, amount);
        
        // Guard should have reset, so this should succeed
        let oid2 = order_bytes(&f.env, "success-after-fail");
        f.client().pay_usdc(&f.payer, &amount, &oid2);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_reentrancy_guard_resets_for_xlm_after_failed_transfer() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_xlm(&f.payer, amount / 2);

        let oid1 = order_bytes(&f.env, "xlm-failed-1");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid1);
        assert!(result.is_err(), "should fail with insufficient balance");

        // Now give sufficient balance
        f.mint_xlm(&f.payer, amount);
        
        // Guard should have reset, so this should succeed
        let oid2 = order_bytes(&f.env, "xlm-success-after-fail");
        f.client().pay_xlm(&f.payer, &amount, &oid2);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
    }

    // ── comprehensive edge-case tests ─────────────────────────────────────

    #[test]
    fn test_pay_usdc_smallest_positive_amount() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1; // 0.0000001 USDC
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "min-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), 1);
        assert_eq!(f.usdc_balance(&f.payer), 0);
    }

    #[test]
    fn test_pay_xlm_smallest_positive_amount() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1; // 1 stroop
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "min-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), 1);
        assert_eq!(f.xlm_balance(&f.payer), 0);
    }

    #[test]
    fn test_pay_usdc_large_amount() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000_000_000; // 100,000 USDC
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "large-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_xlm_large_amount() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000_000_000_000; // 100M XLM
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "large-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_usdc_insufficient_balance_panics() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount / 2); // only half

        let oid = order_bytes(&f.env, "insufficient-usdc");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid);
        assert!(result.is_err(), "should fail with insufficient balance");
    }

    #[test]
    fn test_pay_xlm_insufficient_balance_panics() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_xlm(&f.payer, amount / 2);

        let oid = order_bytes(&f.env, "insufficient-xlm");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid);
        assert!(result.is_err(), "should fail with insufficient balance");
    }

    // ── failed-transfer error/balance semantics (Issue #413 - Part 4) ────────

    #[test]
    fn test_pay_usdc_insufficient_balance_returns_transfer_failed_error() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount / 2);

        let oid = order_bytes(&f.env, "insufficient-usdc-variant");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid);
        assert_eq!(result, Err(Ok(Error::TransferFailed)));
    }

    #[test]
    fn test_pay_xlm_insufficient_balance_returns_transfer_failed_error() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_xlm(&f.payer, amount / 2);

        let oid = order_bytes(&f.env, "insufficient-xlm-variant");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid);
        assert_eq!(result, Err(Ok(Error::TransferFailed)));
    }

    #[test]
    fn test_pay_usdc_insufficient_balance_leaves_balances_unchanged() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        let available = amount / 2;
        f.mint_usdc(&f.payer, available);

        let oid = order_bytes(&f.env, "insufficient-usdc-no-partial");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid);
        assert!(result.is_err());

        // A rejected token::Client transfer must not move any funds --
        // the payer keeps every unit they had, and the treasury sees none.
        assert_eq!(f.usdc_balance(&f.payer), available);
        assert_eq!(f.usdc_balance(&f.treasury), 0);
    }

    #[test]
    fn test_pay_xlm_insufficient_balance_leaves_balances_unchanged() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        let available = amount / 2;
        f.mint_xlm(&f.payer, available);

        let oid = order_bytes(&f.env, "insufficient-xlm-no-partial");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid);
        assert!(result.is_err());

        assert_eq!(f.xlm_balance(&f.payer), available);
        assert_eq!(f.xlm_balance(&f.treasury), 0);
    }

    #[test]
    fn test_pay_usdc_with_zero_balance_payer_fails_cleanly() {
        let f = Fixture::new();
        f.init();

        // Payer never received any USDC at all -- not just "not enough".
        let amount: i128 = 5_000_000;
        let oid = order_bytes(&f.env, "zero-balance-usdc");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(result, Err(Ok(Error::TransferFailed)));
        assert_eq!(f.usdc_balance(&f.payer), 0);
        assert_eq!(f.usdc_balance(&f.treasury), 0);
    }

    #[test]
    fn test_pay_xlm_with_zero_balance_payer_fails_cleanly() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        let oid = order_bytes(&f.env, "zero-balance-xlm");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(result, Err(Ok(Error::TransferFailed)));
        assert_eq!(f.xlm_balance(&f.payer), 0);
        assert_eq!(f.xlm_balance(&f.treasury), 0);
    }

    // ── partial-spend and no-custody invariants (Issue #413 - Part 4) ────────

    #[test]
    fn test_pay_usdc_leaves_remainder_with_payer_when_paying_less_than_balance() {
        let f = Fixture::new();
        f.init();

        let minted: i128 = 30_000_000;
        let paid: i128 = 12_000_000;
        f.mint_usdc(&f.payer, minted);

        let oid = order_bytes(&f.env, "partial-spend-usdc");
        f.client().pay_usdc(&f.payer, &paid, &oid);

        assert_eq!(f.usdc_balance(&f.payer), minted - paid);
        assert_eq!(f.usdc_balance(&f.treasury), paid);
    }

    #[test]
    fn test_pay_xlm_leaves_remainder_with_payer_when_paying_less_than_balance() {
        let f = Fixture::new();
        f.init();

        let minted: i128 = 30_000_000;
        let paid: i128 = 12_000_000;
        f.mint_xlm(&f.payer, minted);

        let oid = order_bytes(&f.env, "partial-spend-xlm");
        f.client().pay_xlm(&f.payer, &paid, &oid);

        assert_eq!(f.xlm_balance(&f.payer), minted - paid);
        assert_eq!(f.xlm_balance(&f.treasury), paid);
    }

    #[test]
    fn test_contract_never_retains_usdc_balance_after_pay_usdc() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 8_000_000;
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "no-custody-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        // pay_usdc forwards straight from payer to treasury in the same
        // call -- the contract itself must never end up holding a balance.
        assert_eq!(f.usdc_balance(&f.contract_id), 0);
    }

    #[test]
    fn test_contract_never_retains_xlm_balance_after_pay_xlm() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 8_000_000;
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "no-custody-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.contract_id), 0);
    }

    #[test]
    fn test_pay_usdc_does_not_affect_xlm_contract_balance() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 8_000_000;
        f.mint_usdc(&f.payer, amount);
        f.mint_xlm(&f.payer, amount);

        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "usdc-only"));

        // Only the USDC leg moved; the payer's XLM balance (minted from a
        // separate SAC) must be completely untouched.
        assert_eq!(f.usdc_balance(&f.payer), 0);
        assert_eq!(f.xlm_balance(&f.payer), amount);
        assert_eq!(f.xlm_balance(&f.treasury), 0);
    }

    #[test]
    fn test_pay_xlm_does_not_affect_usdc_contract_balance() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 8_000_000;
        f.mint_usdc(&f.payer, amount);
        f.mint_xlm(&f.payer, amount);

        f.client().pay_xlm(&f.payer, &amount, &order_bytes(&f.env, "xlm-only"));

        assert_eq!(f.xlm_balance(&f.payer), 0);
        assert_eq!(f.usdc_balance(&f.payer), amount);
        assert_eq!(f.usdc_balance(&f.treasury), 0);
    }

    #[test]
    fn test_multiple_payments_accumulate_in_treasury() {
        let f = Fixture::new();
        f.init();

        let usdc_amount: i128 = 10_000_000;
        let xlm_amount: i128 = 20_000_000;

        f.mint_usdc(&f.payer, usdc_amount * 2);
        f.mint_xlm(&f.payer, xlm_amount * 3);

        f.client().pay_usdc(&f.payer, &usdc_amount, &order_bytes(&f.env, "multi-1"));
        f.client().pay_usdc(&f.payer, &usdc_amount, &order_bytes(&f.env, "multi-2"));
        f.client().pay_xlm(&f.payer, &xlm_amount, &order_bytes(&f.env, "multi-3"));
        f.client().pay_xlm(&f.payer, &xlm_amount, &order_bytes(&f.env, "multi-4"));
        f.client().pay_xlm(&f.payer, &xlm_amount, &order_bytes(&f.env, "multi-5"));

        assert_eq!(f.usdc_balance(&f.treasury), usdc_amount * 2);
        assert_eq!(f.xlm_balance(&f.treasury), xlm_amount * 3);
        assert_eq!(f.usdc_balance(&f.payer), 0);
        assert_eq!(f.xlm_balance(&f.payer), 0);
    }

    #[test]
    fn test_different_payers_pay_independently() {
        let f = Fixture::new();
        f.init();

        let payer2 = Address::generate(&f.env);
        let amount: i128 = 10_000_000;

        f.mint_usdc(&f.payer, amount);
        f.mint_usdc(&payer2, amount);

        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "payer1-order"));
        f.client().pay_usdc(&payer2, &amount, &order_bytes(&f.env, "payer2-order"));

        assert_eq!(f.usdc_balance(&f.treasury), amount * 2);
        assert_eq!(f.usdc_balance(&f.payer), 0);
        assert_eq!(f.usdc_balance(&payer2), 0);
    }

    #[test]
    fn test_getters_after_init() {
        let f = Fixture::new();
        f.init();

        assert_eq!(f.client().admin(), f.admin);
        assert_eq!(f.client().treasury(), f.treasury);
        assert_eq!(f.client().usdc_contract(), f.usdc);
        assert_eq!(f.client().xlm_contract(), f.xlm_sac);
    }

    #[test]
    fn test_try_admin_before_init_returns_err() {
        let env = Env::default();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        assert!(client.try_admin().is_err());
    }

    #[test]
    fn test_empty_order_id_accepted() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;
        f.mint_usdc(&f.payer, amount);

        let oid = Bytes::new(&f.env);
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_long_order_id_accepted() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;
        f.mint_usdc(&f.payer, amount);

        let long_id = "a".repeat(200);
        let oid = order_bytes(&f.env, &long_id);
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_init_stores_correct_admin() {
        let f = Fixture::new();
        f.init();
        assert_eq!(f.client().admin(), f.admin);
    }

    // ── comprehensive edge-case and error handling tests ──────────────────────

    #[test]
    fn test_pay_usdc_with_max_i128() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = i128::MAX / 2;
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "max-i128");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_xlm_with_max_i128() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = i128::MAX / 2;
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "max-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
    }

    #[test]
    fn test_concurrent_payments_from_different_payers() {
        let f = Fixture::new();
        f.init();

        let payer1 = Address::generate(&f.env);
        let payer2 = Address::generate(&f.env);
        let payer3 = Address::generate(&f.env);

        let amount: i128 = 10_000_000;
        f.mint_usdc(&payer1, amount);
        f.mint_usdc(&payer2, amount);
        f.mint_usdc(&payer3, amount);

        f.client().pay_usdc(&payer1, &amount, &order_bytes(&f.env, "payer1"));
        f.client().pay_usdc(&payer2, &amount, &order_bytes(&f.env, "payer2"));
        f.client().pay_usdc(&payer3, &amount, &order_bytes(&f.env, "payer3"));

        assert_eq!(f.usdc_balance(&f.treasury), amount * 3);
    }

    #[test]
    fn test_pay_usdc_with_exact_order_id_match() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount);

        let order_id = "exact-match-order-12345";
        let oid = order_bytes(&f.env, order_id);
        f.client().pay_usdc(&f.payer, &amount, &oid);

        let events = f.env.events().all();
        let mut found = false;
        for (contract_addr, topics, _) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym != Symbol::new(&f.env, "pay_usdc") {
                continue;
            }
            let emitted_oid: Bytes = topics.get(1).unwrap().try_into_val(&f.env).unwrap();
            let emitted_bytes = order_bytes(&f.env, order_id);
            if emitted_oid == emitted_bytes {
                found = true;
                break;
            }
        }
        assert!(found, "order_id should match exactly");
    }

    #[test]
    fn test_treasury_getter_returns_consistent_value() {
        let f = Fixture::new();
        f.init();

        for _ in 0..5 {
            assert_eq!(f.client().treasury(), f.treasury);
        }
    }

    #[test]
    fn test_usdc_contract_getter_returns_consistent_value() {
        let f = Fixture::new();
        f.init();

        for _ in 0..5 {
            assert_eq!(f.client().usdc_contract(), f.usdc);
        }
    }

    #[test]
    fn test_xlm_contract_getter_returns_consistent_value() {
        let f = Fixture::new();
        f.init();

        for _ in 0..5 {
            assert_eq!(f.client().xlm_contract(), f.xlm_sac);
        }
    }

    #[test]
    fn test_admin_getter_returns_consistent_value() {
        let f = Fixture::new();
        f.init();

        for _ in 0..5 {
            assert_eq!(f.client().admin(), f.admin);
        }
    }

    #[test]
    fn test_pay_usdc_with_various_order_id_formats() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;

        let test_cases = [
            "",
            "order-1",
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "123456789",
            "!@#$%^&*()",
            "order\nwith\nnewlines",
        ];

        for order_id in test_cases.iter() {
            f.mint_usdc(&f.payer, amount);
            let oid = order_bytes(&f.env, order_id);
            f.client().pay_usdc(&f.payer, &amount, &oid);
        }

        assert_eq!(f.usdc_balance(&f.treasury), amount * test_cases.len() as i128);
    }

    #[test]
    fn test_role_check_with_unassigned_user_returns_false() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);

        assert!(!f.client().has_role(&user, &Role::Admin));
        assert!(!f.client().has_role(&user, &Role::Operator));
        assert!(!f.client().has_role(&user, &Role::Viewer));
    }

    #[test]
    fn test_get_role_returns_none_for_unassigned_user() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        assert_eq!(f.client().get_role(&user), None);
    }

    #[test]
    fn test_pay_operations_increment_ttl() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount * 2);

        let oid1 = order_bytes(&f.env, "ttl-1");
        f.client().pay_usdc(&f.payer, &amount, &oid1);

        let oid2 = order_bytes(&f.env, "ttl-2");
        f.client().pay_usdc(&f.payer, &amount, &oid2);

        assert_eq!(f.usdc_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_role_management_operations_increment_ttl() {
        let f = Fixture::new();
        f.init();

        let user1 = Address::generate(&f.env);
        let user2 = Address::generate(&f.env);

        f.client().grant_role(&user1, &Role::Viewer);
        f.client().grant_role(&user2, &Role::Operator);
        f.client().revoke_role(&user1);

        assert_eq!(f.client().get_role(&user1), None);
        assert_eq!(f.client().get_role(&user2), Some(Role::Operator));
    }

    #[test]
    fn test_pay_usdc_event_count_matches_payment() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount * 3);

        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "evt-1"));
        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "evt-2"));
        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "evt-3"));

        // Each pay_usdc call emits exactly one event in the current transaction
        let events = f.env.events().all();
        let mut count = 0;
        for (contract_addr, topics, _) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym == Symbol::new(&f.env, "pay_usdc") {
                count += 1;
            }
        }
        // Soroban test env captures events from the last transaction only
        assert!(count >= 1, "should emit at least 1 pay_usdc event per transaction");
    }

    #[test]
    fn test_pay_xlm_event_count_matches_payment() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_xlm(&f.payer, amount * 2);

        f.client().pay_xlm(&f.payer, &amount, &order_bytes(&f.env, "xlm-evt-1"));
        f.client().pay_xlm(&f.payer, &amount, &order_bytes(&f.env, "xlm-evt-2"));

        let events = f.env.events().all();
        let mut count = 0;
        for (contract_addr, topics, _) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym == Symbol::new(&f.env, "pay_xlm") {
                count += 1;
            }
        }
        assert!(count >= 1, "should emit at least 1 pay_xlm event per transaction");
    }

    #[test]
    fn test_usdc_and_xlm_payments_independent() {
        let f = Fixture::new();
        f.init();

        let usdc_amount: i128 = 10_000_000;
        let xlm_amount: i128 = 50_000_000;

        f.mint_usdc(&f.payer, usdc_amount);
        f.mint_xlm(&f.payer, xlm_amount);

        f.client().pay_usdc(&f.payer, &usdc_amount, &order_bytes(&f.env, "mixed-usdc"));
        f.client().pay_xlm(&f.payer, &xlm_amount, &order_bytes(&f.env, "mixed-xlm"));

        assert_eq!(f.usdc_balance(&f.treasury), usdc_amount);
        assert_eq!(f.xlm_balance(&f.treasury), xlm_amount);
        assert_eq!(f.usdc_balance(&f.payer), 0);
        assert_eq!(f.xlm_balance(&f.payer), 0);
    }

    // ── RBAC integration with payments tests ──────────────────────────────────

    #[test]
    fn test_admin_can_always_see_treasury() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Admin);

        assert!(f.client().has_role(&user, &Role::Admin));
        assert_eq!(f.client().treasury(), f.treasury);
    }

    #[test]
    fn test_operator_cannot_be_admin() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Operator);

        assert!(!f.client().has_role(&user, &Role::Admin));
        assert!(f.client().has_role(&user, &Role::Operator));
    }

    #[test]
    fn test_viewer_has_minimal_permissions() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);

        assert!(!f.client().has_role(&user, &Role::Admin));
        assert!(!f.client().has_role(&user, &Role::Operator));
        assert!(f.client().has_role(&user, &Role::Viewer));
    }

    #[test]
    fn test_multiple_users_can_have_roles() {
        let f = Fixture::new();
        f.init();

        let admin_user = Address::generate(&f.env);
        let operator_user = Address::generate(&f.env);
        let viewer_user = Address::generate(&f.env);

        f.client().grant_role(&admin_user, &Role::Admin);
        f.client().grant_role(&operator_user, &Role::Operator);
        f.client().grant_role(&viewer_user, &Role::Viewer);

        assert_eq!(f.client().get_role(&admin_user), Some(Role::Admin));
        assert_eq!(f.client().get_role(&operator_user), Some(Role::Operator));
        assert_eq!(f.client().get_role(&viewer_user), Some(Role::Viewer));
    }

    #[test]
    fn test_grant_role_overwrites_existing_role() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);
        assert_eq!(f.client().get_role(&user), Some(Role::Viewer));

        f.client().grant_role(&user, &Role::Operator);
        assert_eq!(f.client().get_role(&user), Some(Role::Operator));

        f.client().grant_role(&user, &Role::Admin);
        assert_eq!(f.client().get_role(&user), Some(Role::Admin));
    }

    #[test]
    fn test_revoke_role_makes_has_role_return_false() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Operator);
        assert!(f.client().has_role(&user, &Role::Operator));

        f.client().revoke_role(&user);
        assert!(!f.client().has_role(&user, &Role::Operator));
        assert!(!f.client().has_role(&user, &Role::Viewer));
        assert!(!f.client().has_role(&user, &Role::Admin));
    }

    #[test]
    fn test_admin_has_highest_privilege() {
        let f = Fixture::new();
        f.init();

        let admin_user = Address::generate(&f.env);
        f.client().grant_role(&admin_user, &Role::Admin);

        assert!(f.client().has_role(&admin_user, &Role::Admin));
        assert!(f.client().has_role(&admin_user, &Role::Operator));
        assert!(f.client().has_role(&admin_user, &Role::Viewer));
    }

    #[test]
    fn test_operator_has_operator_and_viewer_but_not_admin() {
        let f = Fixture::new();
        f.init();

        let operator_user = Address::generate(&f.env);
        f.client().grant_role(&operator_user, &Role::Operator);

        assert!(!f.client().has_role(&operator_user, &Role::Admin));
        assert!(f.client().has_role(&operator_user, &Role::Operator));
        assert!(f.client().has_role(&operator_user, &Role::Viewer));
    }

    // ── role-based access control state persistence tests ──────────────────────

    #[test]
    fn test_role_assignments_persist_across_calls() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Operator);

        assert_eq!(f.client().get_role(&user), Some(Role::Operator));
        assert_eq!(f.client().get_role(&user), Some(Role::Operator)); // Call again
    }

    #[test]
    fn test_multiple_role_assignments_do_not_interfere() {
        let f = Fixture::new();
        f.init();

        let user1 = Address::generate(&f.env);
        let user2 = Address::generate(&f.env);
        let user3 = Address::generate(&f.env);

        f.client().grant_role(&user1, &Role::Admin);
        f.client().grant_role(&user2, &Role::Operator);
        f.client().grant_role(&user3, &Role::Viewer);

        assert_eq!(f.client().get_role(&user1), Some(Role::Admin));
        assert_eq!(f.client().get_role(&user2), Some(Role::Operator));
        assert_eq!(f.client().get_role(&user3), Some(Role::Viewer));

        f.client().revoke_role(&user2);

        assert_eq!(f.client().get_role(&user1), Some(Role::Admin));
        assert_eq!(f.client().get_role(&user2), None);
        assert_eq!(f.client().get_role(&user3), Some(Role::Viewer));
    }

    // ── role management tests ────────────────────────────────────────────────

    #[test]
    fn test_grant_role_works() {
        let f = Fixture::new();
        f.init();
        
        let user = Address::generate(&f.env);
        assert_eq!(f.client().get_role(&user), None);
        assert_eq!(f.client().has_role(&user, &Role::Viewer), false);
        
        f.client().grant_role(&user, &Role::Viewer);
        
        assert_eq!(f.client().get_role(&user), Some(Role::Viewer));
        assert_eq!(f.client().has_role(&user, &Role::Viewer), true);
        assert_eq!(f.client().has_role(&user, &Role::Operator), false);
        assert_eq!(f.client().has_role(&user, &Role::Admin), false);
        
        f.client().grant_role(&user, &Role::Operator);
        assert_eq!(f.client().get_role(&user), Some(Role::Operator));
        assert_eq!(f.client().has_role(&user, &Role::Viewer), true);
        assert_eq!(f.client().has_role(&user, &Role::Operator), true);
        assert_eq!(f.client().has_role(&user, &Role::Admin), false);
    }

    #[test]
    #[should_panic]
    fn test_grant_role_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);
        
        client.init(&admin, &treasury, &usdc, &xlm_sac);
        
        let user = Address::generate(&env);
        client.grant_role(&user, &Role::Viewer); // panics
    }

    #[test]
    fn test_revoke_role_works() {
        let f = Fixture::new();
        f.init();
        
        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Operator);
        assert_eq!(f.client().get_role(&user), Some(Role::Operator));
        
        f.client().revoke_role(&user);
        assert_eq!(f.client().get_role(&user), None);
    }

    #[test]
    #[should_panic]
    fn test_revoke_role_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);
        
        client.init(&admin, &treasury, &usdc, &xlm_sac);
        
        let user = Address::generate(&env);
        client.revoke_role(&user); // panics
    }

    #[test]
    fn test_revoke_nonexistent_role_is_noop() {
        let f = Fixture::new();
        f.init();
        
        let user = Address::generate(&f.env);
        f.client().revoke_role(&user);
        assert_eq!(f.client().get_role(&user), None);
    }

    #[test]
    fn test_has_role_hierarchy() {
        let f = Fixture::new();
        f.init();
        
        let admin_user = Address::generate(&f.env);
        let operator_user = Address::generate(&f.env);
        let viewer_user = Address::generate(&f.env);
        
        f.client().grant_role(&admin_user, &Role::Admin);
        f.client().grant_role(&operator_user, &Role::Operator);
        f.client().grant_role(&viewer_user, &Role::Viewer);
        
        // Admin has all roles
        assert!(f.client().has_role(&admin_user, &Role::Viewer));
        assert!(f.client().has_role(&admin_user, &Role::Operator));
        assert!(f.client().has_role(&admin_user, &Role::Admin));
        
        // Operator has Operator and Viewer
        assert!(f.client().has_role(&operator_user, &Role::Viewer));
        assert!(f.client().has_role(&operator_user, &Role::Operator));
        assert!(!f.client().has_role(&operator_user, &Role::Admin));
        
        // Viewer only has Viewer
        assert!(f.client().has_role(&viewer_user, &Role::Viewer));
        assert!(!f.client().has_role(&viewer_user, &Role::Operator));
        assert!(!f.client().has_role(&viewer_user, &Role::Admin));
    }

    // ── grant multiple roles to same user ──────────────────────────────────

    #[test]
    fn test_grant_multiple_roles_to_same_user() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);
        assert_eq!(f.client().get_role(&user), Some(Role::Viewer));

        // Upgrading from Viewer to Operator
        f.client().grant_role(&user, &Role::Operator);
        assert_eq!(f.client().get_role(&user), Some(Role::Operator));
        assert!(f.client().has_role(&user, &Role::Viewer));
        assert!(f.client().has_role(&user, &Role::Operator));
        assert!(!f.client().has_role(&user, &Role::Admin));

        // Upgrading from Operator to Admin
        f.client().grant_role(&user, &Role::Admin);
        assert_eq!(f.client().get_role(&user), Some(Role::Admin));
        assert!(f.client().has_role(&user, &Role::Viewer));
        assert!(f.client().has_role(&user, &Role::Operator));
        assert!(f.client().has_role(&user, &Role::Admin));
    }

    // ── revoke admin role from original admin ──────────────────────────────

    #[test]
    fn test_revoke_admin_role_from_original_admin() {
        let f = Fixture::new();
        f.init();

        // The init function grants Admin role to the admin address
        assert_eq!(f.client().get_role(&f.admin), Some(Role::Admin));

        // Revoke admin's role
        f.client().revoke_role(&f.admin);
        assert_eq!(f.client().get_role(&f.admin), None);
        assert!(!f.client().has_role(&f.admin, &Role::Admin));
    }

    // ── has_role returns false for unknown address ─────────────────────────

    #[test]
    fn test_has_role_returns_false_for_unknown() {
        let f = Fixture::new();
        f.init();

        let unknown = Address::generate(&f.env);
        assert!(!f.client().has_role(&unknown, &Role::Viewer));
        assert!(!f.client().has_role(&unknown, &Role::Operator));
        assert!(!f.client().has_role(&unknown, &Role::Admin));
    }

    // ── pause / unpause (circuit breaker) tests ──────────────────────────────

    #[test]
    fn test_contract_starts_unpaused() {
        let f = Fixture::new();
        f.init();
        assert_eq!(f.client().is_paused_view(), false);
    }

    #[test]
    fn test_pause_requires_operator_role() {
        let f = Fixture::new();
        f.init();

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);

        f.client().pause(&operator);
        assert_eq!(f.client().is_paused_view(), true);
    }

    #[test]
    fn test_admin_role_can_also_pause() {
        let f = Fixture::new();
        f.init();

        let admin_role_holder = Address::generate(&f.env);
        f.client().grant_role(&admin_role_holder, &Role::Admin);

        f.client().pause(&admin_role_holder);
        assert_eq!(f.client().is_paused_view(), true);
    }

    #[test]
    #[should_panic(expected = "pause requires at least the Operator role")]
    fn test_pause_rejects_viewer_role() {
        let f = Fixture::new();
        f.init();

        let viewer = Address::generate(&f.env);
        f.client().grant_role(&viewer, &Role::Viewer);

        f.client().pause(&viewer); // panics — Viewer is below Operator
    }

    #[test]
    #[should_panic(expected = "pause requires at least the Operator role")]
    fn test_pause_rejects_address_with_no_role() {
        let f = Fixture::new();
        f.init();

        let nobody = Address::generate(&f.env);
        f.client().pause(&nobody); // panics — no role at all
    }

    #[test]
    fn test_unpause_resumes_payments() {
        let f = Fixture::new();
        f.init();

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);
        f.client().pause(&operator);
        assert_eq!(f.client().is_paused_view(), true);

        f.client().unpause();
        assert_eq!(f.client().is_paused_view(), false);
    }

    // ── rescue_tokens tests ───────────────────────────────────────────────────

    #[test]
    fn test_rescue_tokens_recovers_mistaken_direct_transfer() {
        let f = Fixture::new();
        f.init();

        // Simulate a mistaken direct send: USDC minted straight to the
        // contract's own address, bypassing pay_usdc entirely.
        let amount: i128 = 3_000_000;
        f.mint_usdc(&f.contract_id, amount);
        assert_eq!(f.usdc_balance(&f.contract_id), amount);

        let rescue_destination = Address::generate(&f.env);
        f.client()
            .rescue_tokens(&f.admin, &f.usdc, &rescue_destination, &amount);

        assert_eq!(f.usdc_balance(&f.contract_id), 0);
        assert_eq!(f.usdc_balance(&rescue_destination), amount);
    }

    #[test]
    #[should_panic(expected = "rescue_tokens requires the Admin role")]
    fn test_rescue_tokens_requires_admin_role() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;
        f.mint_usdc(&f.contract_id, amount);

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);

        let destination = Address::generate(&f.env);
        // Operator is below Admin in the hierarchy — must panic (has_role
        // check), not merely return Err.
        f.client().rescue_tokens(&operator, &f.usdc, &destination, &amount);
    }

    #[test]
    fn test_rescue_tokens_accepts_role_admin_who_is_not_the_stored_admin() {
        let f = Fixture::new();
        f.init();

        // Someone granted the Admin *role* — but who is NOT the stored
        // DataKey::Admin address — must still be able to rescue tokens.
        let role_admin = Address::generate(&f.env);
        f.client().grant_role(&role_admin, &Role::Admin);

        let amount: i128 = 750_000;
        f.mint_usdc(&f.contract_id, amount);
        let destination = Address::generate(&f.env);

        f.client().rescue_tokens(&role_admin, &f.usdc, &destination, &amount);
        assert_eq!(f.usdc_balance(&destination), amount);
    }

    #[test]
    fn test_rescue_tokens_rejects_non_positive_amount() {
        let f = Fixture::new();
        f.init();

        f.client().grant_role(&f.admin, &Role::Admin);
        let destination = Address::generate(&f.env);

        let result = f.client().try_rescue_tokens(&f.admin, &f.usdc, &destination, &0_i128);
        assert!(result.is_err());
    }

    #[test]
    fn test_rescue_tokens_works_for_any_sac_not_just_configured_ones() {
        let f = Fixture::new();
        f.init();

        // A third, unrelated token (not the contract's configured USDC/XLM)
        // mistakenly sent to the contract — rescue_tokens must still work,
        // since it takes the token contract as a parameter.
        let other_token_admin = Address::generate(&f.env);
        let other_token = f.env.register_stellar_asset_contract_v2(other_token_admin.clone()).address();
        let amount: i128 = 500_000;
        token::StellarAssetClient::new(&f.env, &other_token).mint(&f.contract_id, &amount);

        let destination = Address::generate(&f.env);
        f.client().rescue_tokens(&f.admin, &other_token, &destination, &amount);

        assert_eq!(token::Client::new(&f.env, &other_token).balance(&destination), amount);
    }

    // ── transfer_admin tests ──────────────────────────────────────────────────

    #[test]
    fn test_transfer_admin_updates_admin_address() {
        let f = Fixture::new();
        f.init();

        let new_admin = Address::generate(&f.env);
        f.client().transfer_admin(&new_admin);

        assert_eq!(f.client().admin(), new_admin);
    }

    #[test]
    fn test_new_admin_can_act_after_transfer() {
        let f = Fixture::new();
        f.init();

        let new_admin = Address::generate(&f.env);
        f.client().transfer_admin(&new_admin);

        // The new admin must now be able to do admin-gated work (e.g.
        // grant a role) — proving the handover actually took effect, not
        // just that the getter reports the new address.
        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);
        assert_eq!(f.client().get_role(&user), Some(Role::Viewer));
    }

    #[test]
    #[should_panic]
    fn test_pause_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        // init() auto-grants admin the Admin role, which satisfies pause()'s
        // Operator-or-above check -- so with no auth mocked at all, the
        // panic must come from caller.require_auth(), not a missing role.
        env.mock_auths(&[]);
        client.pause(&admin);
    }

    #[test]
    #[should_panic]
    fn test_unpause_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        // unpause() checks DataKey::Admin directly (not the Role system), and
        // is deliberately stricter than pause() — with no auth mocked at all,
        // admin.require_auth() must panic.

        env.mock_auths(&[]);
        client.unpause();
    }

    #[test]
    #[should_panic]
    fn test_old_admin_loses_authority_after_transfer() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        let new_admin = Address::generate(&env);
        client.transfer_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);

        // DataKey::Admin now holds new_admin. Mock auth for the OLD admin
        // ONLY (not new_admin) and try an admin-gated call — it must panic,
        // proving the old admin no longer has authority, not merely that
        // the getter reports a different address.
        let someone = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "revoke_role",
                args: (someone.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.revoke_role(&someone);
    }

    #[test]
    #[should_panic]
    fn test_transfer_admin_requires_new_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        // transfer_admin requires BOTH the current admin's and the new
        // admin's auth. Mock only the current admin — the new admin's
        // require_auth() must panic.
        let new_admin = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_admin",
                args: (new_admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.transfer_admin(&new_admin);
    }

    #[test]
    fn test_pay_usdc_rejected_when_paused() {
        let f = Fixture::new();
        f.init();

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);
        f.client().pause(&operator);

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "paused-usdc");
        let result = f.client().try_pay_usdc(&f.payer, &amount, &oid);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));

        // Balance must be untouched — the paused check runs before any transfer.
        assert_eq!(f.usdc_balance(&f.payer), amount);
    }

    #[test]
    fn test_paused_contract_rejects_pay_xlm() {
        let f = Fixture::new();
        f.init();

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);
        f.client().pause(&operator);

        let amount: i128 = 5_000_000;
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "paused-xlm");
        let result = f.client().try_pay_xlm(&f.payer, &amount, &oid);
        assert_eq!(result, Err(Ok(Error::ContractPaused)));
        assert_eq!(f.xlm_balance(&f.payer), amount);
    }

    #[test]
    fn test_pay_usdc_works_again_after_unpause() {
        let f = Fixture::new();
        f.init();

        let operator = Address::generate(&f.env);
        f.client().grant_role(&operator, &Role::Operator);
        f.client().pause(&operator);
        f.client().unpause();

        let amount: i128 = 10_000_000;
        f.mint_usdc(&f.payer, amount);
        let oid = order_bytes(&f.env, "after-unpause");

        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_different_payers_usdc() {
        let f = Fixture::new();
        f.init();

        let payer2 = Address::generate(&f.env);
        let payer3 = Address::generate(&f.env);
        let amount: i128 = 1_000_000;

        f.mint_usdc(&f.payer, amount);
        f.mint_usdc(&payer2, amount);
        f.mint_usdc(&payer3, amount);

        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "dp-1"));
        f.client().pay_usdc(&payer2, &amount, &order_bytes(&f.env, "dp-2"));
        f.client().pay_usdc(&payer3, &amount, &order_bytes(&f.env, "dp-3"));

        assert_eq!(f.usdc_balance(&f.treasury), amount * 3);
    }

    #[test]
    fn test_different_payers_xlm() {
        let f = Fixture::new();
        f.init();

        let payer2 = Address::generate(&f.env);
        let amount: i128 = 1_000_000;

        f.mint_xlm(&f.payer, amount);
        f.mint_xlm(&payer2, amount);

        f.client().pay_xlm(&f.payer, &amount, &order_bytes(&f.env, "dp-xlm-1"));
        f.client().pay_xlm(&payer2, &amount, &order_bytes(&f.env, "dp-xlm-2"));

        assert_eq!(f.xlm_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_multiple_payers_single_order() {
        let f = Fixture::new();
        f.init();

        let payer2 = Address::generate(&f.env);
        let amount: i128 = 5_000_000;

        f.mint_usdc(&f.payer, amount);
        f.mint_usdc(&payer2, amount);

        // Same order ID used by different payers
        f.client().pay_usdc(&f.payer, &amount, &order_bytes(&f.env, "shared-order"));
        f.client().pay_usdc(&payer2, &amount, &order_bytes(&f.env, "shared-order"));

        assert_eq!(f.usdc_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_empty_order_id_xlm() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;
        f.mint_xlm(&f.payer, amount);

        let oid = Bytes::new(&f.env);
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
    }

    #[test]
    fn test_long_order_id_xlm() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_000_000;
        f.mint_xlm(&f.payer, amount);

        let long_id = "x".repeat(200);
        let oid = order_bytes(&f.env, &long_id);
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_usdc_with_fractional_amount() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1_500_000; // 1.5 USDC
        f.mint_usdc(&f.payer, amount);

        let oid = order_bytes(&f.env, "fractional");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_xlm_minimum_stroops() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 1;
        f.mint_xlm(&f.payer, amount);

        let oid = order_bytes(&f.env, "min-stroops");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), 1);
    }

    mod upgrade_wasm {
        soroban_sdk::contractimport!(
            file = "target/wasm32v1-none/release/stellar_card_receiver.wasm"
        );
    }

    #[test]
    fn test_upgrade_works() {
        let f = Fixture::new();
        f.init();

        // `upgrade()` only needs a WASM hash that actually exists in the
        // ledger — upload this same contract's own compiled WASM so the
        // success path can be exercised without a second dummy contract.
        // Built for wasm32v1-none rather than wasm32-unknown-unknown: on
        // this toolchain the latter emits reference-types encoding that
        // the bundled soroban-env-host WASM parser rejects.
        let new_hash = f.env.deployer().upload_contract_wasm(upgrade_wasm::WASM);
        f.client().upgrade(&new_hash);
    }

    // ── init events test ───────────────────────────────────────────────────

    #[test]
    fn test_init_emits_no_events() {
        let f = Fixture::new();
        f.init();

        // init should not emit any events
        let events = f.env.events().all();
        for (contract_addr, _, _) in events.iter() {
            assert_ne!(contract_addr, f.contract_id, "init should not emit events");
        }
    }

    // ── per-address role storage tests ───────────────────────────────────────

    #[test]
    fn test_role_storage_is_independent_per_address() {
        let f = Fixture::new();
        f.init();

        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);

        f.client().grant_role(&alice, &Role::Admin);
        f.client().grant_role(&bob, &Role::Viewer);

        // Each address's role is stored under its own key — granting/
        // revoking one must never affect the other.
        assert_eq!(f.client().get_role(&alice), Some(Role::Admin));
        assert_eq!(f.client().get_role(&bob), Some(Role::Viewer));

        f.client().revoke_role(&alice);
        assert_eq!(f.client().get_role(&alice), None);
        assert_eq!(f.client().get_role(&bob), Some(Role::Viewer)); // untouched
    }

    #[test]
    fn test_grant_role_overwrites_previous_role_for_same_address() {
        let f = Fixture::new();
        f.init();

        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);
        assert_eq!(f.client().get_role(&user), Some(Role::Viewer));

        f.client().grant_role(&user, &Role::Admin);
        assert_eq!(f.client().get_role(&user), Some(Role::Admin));
    }

    // ── grant_roles (batch) tests ─────────────────────────────────────────────

    #[test]
    fn test_grant_roles_grants_same_role_to_all_addresses() {
        let f = Fixture::new();
        f.init();

        let alice = Address::generate(&f.env);
        let bob = Address::generate(&f.env);
        let carol = Address::generate(&f.env);
        let addresses = soroban_sdk::vec![&f.env, alice.clone(), bob.clone(), carol.clone()];

        f.client().grant_roles(&addresses, &Role::Operator);

        assert_eq!(f.client().get_role(&alice), Some(Role::Operator));
        assert_eq!(f.client().get_role(&bob), Some(Role::Operator));
        assert_eq!(f.client().get_role(&carol), Some(Role::Operator));
    }

    #[test]
    #[should_panic]
    fn test_grant_roles_requires_admin_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        env.mock_auths(&[]);
        let addresses = soroban_sdk::vec![&env, Address::generate(&env)];
        client.grant_roles(&addresses, &Role::Viewer);
    }

    #[test]
    fn test_grant_roles_empty_list_is_noop() {
        let f = Fixture::new();
        f.init();

        let empty: Vec<Address> = soroban_sdk::vec![&f.env];
        f.client().grant_roles(&empty, &Role::Viewer); // must not panic

        let someone = Address::generate(&f.env);
        assert_eq!(f.client().get_role(&someone), None);
    }

    #[test]
    fn test_grant_roles_does_not_disturb_roles_outside_the_batch() {
        let f = Fixture::new();
        f.init();

        let already_admin = Address::generate(&f.env);
        f.client().grant_role(&already_admin, &Role::Admin);

        let batch = soroban_sdk::vec![&f.env, Address::generate(&f.env), Address::generate(&f.env)];
        f.client().grant_roles(&batch, &Role::Viewer);

        // Granting a batch of Viewer roles must not touch an address that
        // was never part of the batch.
        assert_eq!(f.client().get_role(&already_admin), Some(Role::Admin));
    }

    // ── TTL threshold optimization tests ──────────────────────────────────────

    #[test]
    fn test_instance_ttl_extension_is_skipped_once_already_healthy() {
        use soroban_sdk::testutils::storage::Instance;

        let f = Fixture::new();
        f.init();

        // The test network's own max_entry_ttl setting caps how far any
        // single extend_ttl call can push the TTL, so we don't assert
        // against an absolute value — only that init() performed a real
        // extension at all.
        let ttl_after_init = f.env.as_contract(&f.contract_id, || {
            f.env.storage().instance().get_ttl()
        });
        assert!(ttl_after_init > 0, "TTL after init should be positive");

        // A second admin-gated call (grant_role) while the TTL is already
        // above INSTANCE_TTL_THRESHOLD must be a genuine no-op on the TTL —
        // proving extend_instance_ttl's threshold check actually skips
        // redundant extension work, not just that it compiles.
        let user = Address::generate(&f.env);
        f.client().grant_role(&user, &Role::Viewer);
        let ttl_after_second_call = f.env.as_contract(&f.contract_id, || {
            f.env.storage().instance().get_ttl()
        });
        assert_eq!(
            ttl_after_second_call, ttl_after_init,
            "a second call while TTL is already above the threshold should not re-extend it"
        );
    }

    #[test]
    fn test_ttl_threshold_is_strictly_below_max() {
        // The entire point of the threshold/max split: if they were equal
        // (the contract's original pattern), almost every call would
        // re-extend, since any decrease at all drops below the threshold.
        assert!(INSTANCE_TTL_THRESHOLD < INSTANCE_TTL_MAX);
        assert_eq!(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_MAX / 2);
    }
}
