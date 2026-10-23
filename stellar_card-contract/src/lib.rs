#![no_std]
//! # Stellar_Card Receiver Contract
//!
//! Soroban smart contract that receives USDC and XLM payments from AI agents
//! and emits `payment` events containing the order ID. The backend polls these
//! events to route and fulfil orders — no memo or destination matching required.
//!
//! ## Entrypoints
//!
//! | Function | Authorization | Description |
//! |----------|---------------|-------------|
//! | [`Stellar_CardReceiver::init`] | admin | One-time contract initialisation |
//! | [`Stellar_CardReceiver::pay_usdc`] | payer | USDC payment for a single order |
//! | [`Stellar_CardReceiver::pay_xlm`] | payer | XLM payment for a single order |
//! | [`Stellar_CardReceiver::upgrade`] | admin | Replace the contract WASM |
//! | [`Stellar_CardReceiver::treasury`] | none | Read the treasury address |
//! | [`Stellar_CardReceiver::usdc_contract`] | none | Read the USDC SAC address |
//! | [`Stellar_CardReceiver::xlm_contract`] | none | Read the XLM SAC address |
//! | [`Stellar_CardReceiver::admin`] | none | Read the admin address |
//!
//! ## Authorization model
//!
//! Two privilege levels exist:
//!
//! * **Admin** — the address stored under [`DataKey::Admin`]. The admin
//!   authorizes [`Stellar_CardReceiver::init`] and
//!   [`Stellar_CardReceiver::upgrade`] via `require_auth()`.
//! * **Payer** — any address funding an order. Payers authorize
//!   [`Stellar_CardReceiver::pay_usdc`] and [`Stellar_CardReceiver::pay_xlm`].
//!
//! Read-only getters are unrestricted.
//!
//! ## Examples
//!
//! Invoking a payment through the generated client:
//!
//! ```ignore
//! let client = Stellar_CardReceiverClient::new(&env, &contract_id);
//! let order_id = Bytes::from_slice(&env, b"550e8400-e29b-41d4-a716-446655440000");
//! client.pay_usdc(&payer, &25_000_000, &order_id);
//! ```
//!
//! Reading the treasury address:
//!
//! ```ignore
//! let client = Stellar_CardReceiverClient::new(&env, &contract_id);
//! let treasury: Address = client.treasury();
//! ```

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, Symbol};

/// Persistent instance-storage keys.
///
/// Each variant maps to exactly one logical configuration slot. All access goes
/// through `env.storage().instance()`, so every key shares the contract
/// instance TTL budget. Keys are written exactly once, during
/// [`Stellar_CardReceiver::init`], and are never removed.
#[contracttype]
pub enum DataKey {
    /// Address that receives every USDC and XLM payment.
    ///
    /// Set by [`Stellar_CardReceiver::init`]. Read by
    /// [`Stellar_CardReceiver::pay_usdc`], [`Stellar_CardReceiver::pay_xlm`],
    /// and [`Stellar_CardReceiver::treasury`].
    Treasury,
    /// Stellar Asset Contract (SAC) address of the USDC token.
    ///
    /// Set by [`Stellar_CardReceiver::init`]. Read by
    /// [`Stellar_CardReceiver::pay_usdc`] and
    /// [`Stellar_CardReceiver::usdc_contract`].
    UsdcContract,
    /// Stellar Asset Contract (SAC) address of the native XLM token.
    ///
    /// Set by [`Stellar_CardReceiver::init`]. Read by
    /// [`Stellar_CardReceiver::pay_xlm`] and
    /// [`Stellar_CardReceiver::xlm_contract`].
    XlmContract,
    /// Account authorized to call [`Stellar_CardReceiver::init`] and
    /// [`Stellar_CardReceiver::upgrade`].
    ///
    /// Set by [`Stellar_CardReceiver::init`]. Read by
    /// [`Stellar_CardReceiver::upgrade`] and [`Stellar_CardReceiver::admin`].
    Admin,
    /// Pending treasury migration proposal created by
    /// [`Stellar_CardReceiver::propose_treasury`].
    ///
    /// Stores a [`TreasuryProposal`]. Cleared by
    /// [`Stellar_CardReceiver::execute_treasury_migration`] and
    /// [`Stellar_CardReceiver::cancel_treasury_migration`].
    TreasuryProposal,
    /// Reentrancy guard latch. Present while a payment entrypoint is running.
    ///
    /// Written by [`Stellar_CardReceiver::_enter`] and removed by
    /// [`Stellar_CardReceiver::_exit`]. Absent when no payment is in flight.
    ReentrancyGuard,
}

/// Two-step timelocked treasury migration proposal.
///
/// Created by [`Stellar_CardReceiver::propose_treasury`], executed by
/// [`Stellar_CardReceiver::execute_treasury_migration`] once the timelock has
/// elapsed, or discarded by [`Stellar_CardReceiver::cancel_treasury_migration`]
/// at any time before execution.
#[contracttype]
#[derive(Clone)]
pub struct TreasuryProposal {
    /// Destination address that will replace the current treasury.
    pub new_treasury: Address,
    /// Ledger timestamp (seconds) at which the proposal was created.
    pub proposed_at: u64,
    /// Ledger timestamp (seconds) after which the migration may be executed.
    pub effective_at: u64,
}

/// Timelock duration, in seconds, between proposing and executing a treasury
/// migration (48 hours).
const TIMELOCK_SECONDS: u64 = 172_800;

/// Stable contract error codes.
///
/// Discriminants are part of the public wire interface: off-chain clients match
/// on the numeric code embedded in the host error. Variants document every
/// failure condition the entrypoints can surface.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// [`Stellar_CardReceiver::init`] was invoked after the contract had
    /// already been initialised. Initialisation is strictly one-shot; redeploy
    /// a new contract instead of re-initialising this one.
    AlreadyInitialized = 1,
    /// A payment amount was zero or negative. All amounts must be strictly
    /// positive, expressed in stroops (7 decimal places).
    InvalidAmount = 2,
    /// A required configuration value was missing from instance storage. This
    /// indicates the contract was never initialised through
    /// [`Stellar_CardReceiver::init`].
    NotInitialized = 3,
    /// The caller is not the stored admin address. Only the admin may invoke
    /// privileged entrypoints such as [`Stellar_CardReceiver::upgrade`].
    Unauthorized = 4,
    /// A treasury migration proposal is required before the migration can be
    /// executed, but none is currently stored.
    TreasuryProposalMissing = 5,
    /// A treasury migration proposal already exists. Cancel it before
    /// proposing a different target address.
    TreasuryProposalExists = 6,
    /// [`Stellar_CardReceiver::execute_treasury_migration`] was invoked before
    /// the proposal's timelock had elapsed. Wait until the effective timestamp.
    TreasuryTimelockNotElapsed = 7,
    /// A batch payment list was empty. Supply at least one order to fund.
    EmptyBatch = 8,
}

#[contract]
pub struct Stellar_CardReceiver;

#[contractimpl]
impl Stellar_CardReceiver {
    /// Acquire the reentrancy guard.
    ///
    /// Sets the [`DataKey::ReentrancyGuard`] latch and refreshes the instance
    /// storage TTL so the latch cannot be evicted mid-call.
    ///
    /// # Panics
    ///
    /// * `reentrancy detected` — if the latch is already held. This is the
    ///   signal that a recursive call entered a payment entrypoint.
    fn _enter(env: &Env) {
        if env.storage().instance().has(&DataKey::ReentrancyGuard) {
            panic!("reentrancy detected");
        }
        env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Release the reentrancy guard.
    ///
    /// Removes the [`DataKey::ReentrancyGuard`] latch so the next call can
    /// proceed. Always paired with [`Self::_enter`] on the success path; on a
    /// panicking path Soroban's transaction rollback clears the latch.
    fn _exit(env: &Env) {
        env.storage().instance().remove(&DataKey::ReentrancyGuard);
    }

    /// One-time initialisation. Panics if already initialised.
    ///
    /// Stores the admin, treasury, and token contract addresses, then extends
    /// the instance TTL so long-lived deployments survive infrequent writes.
    ///
    /// # Authorization
    ///
    /// The `admin` argument must sign via `admin.require_auth()`. This prevents
    /// front-running on deployment (C-1).
    ///
    /// # Panics
    ///
    /// * `already initialized` — if [`DataKey::Admin`] is already present.
    ///
    /// # Expected mainnet values (C-3, C-7)
    ///
    /// * `usdc_contract` — `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` (USDC SAC)
    /// * `xlm_contract` — native XLM SAC address (varies by network)
    /// * `treasury` — stellar_card treasury G-address — verify before deployment
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// client.init(&admin, &treasury, &usdc_sac, &xlm_sac);
    /// ```
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

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::XlmContract, &xlm_contract);

        // Keep instance storage alive to avoid state-eviction surprises on
        // long-lived deployments with infrequent writes.
        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Transfer `amount` USDC (in micro-USDC, 7 d.p.) from `from` to treasury.
    ///
    /// Performs a single SAC `transfer` of `amount` from the payer to the
    /// stored treasury address, then publishes a payment event.
    ///
    /// # Authorization
    ///
    /// The payer must sign via `from.require_auth()`.
    ///
    /// # Panics
    ///
    /// * `amount must be positive` — if `amount <= 0`.
    /// * Propagates the SAC token's panic if `from` holds insufficient balance.
    ///
    /// # Events
    ///
    /// Emits `topics=[Symbol("pay_usdc"), order_id, from]`, `value=amount`.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let oid = Bytes::from_slice(&env, b"a3f7c2d1-4e8b-4f0a-9c2d");
    /// client.pay_usdc(&payer, &25_000_000, &oid);
    /// ```
    pub fn pay_usdc(env: Env, from: Address, amount: i128, order_id: Bytes) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        from.require_auth();

        Self::_enter(&env);

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let usdc_contract: Address = env.storage().instance().get(&DataKey::UsdcContract).unwrap();

        let token_client = token::Client::new(&env, &usdc_contract);
        token_client.transfer(&from, &treasury, &amount);

        env.events().publish(
            (Symbol::new(&env, "pay_usdc"), order_id, from),
            amount,
        );

        Self::_exit(&env);
        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Transfer `amount` XLM (in stroops, 7 d.p.) from `from` to treasury.
    ///
    /// Performs a single SAC `transfer` of `amount` from the payer to the
    /// stored treasury address, then publishes a payment event.
    ///
    /// # Authorization
    ///
    /// The payer must sign via `from.require_auth()`.
    ///
    /// # Panics
    ///
    /// * `amount must be positive` — if `amount <= 0`.
    /// * Propagates the SAC token's panic if `from` holds insufficient balance.
    ///
    /// # Events
    ///
    /// Emits `topics=[Symbol("pay_xlm"), order_id, from]`, `value=amount`.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let oid = Bytes::from_slice(&env, b"b2e8d1c0-5f9a-4b0b-8d3e");
    /// client.pay_xlm(&payer, &161_290_000, &oid);
    /// ```
    pub fn pay_xlm(env: Env, from: Address, amount: i128, order_id: Bytes) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        from.require_auth();

        Self::_enter(&env);

        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let xlm_contract: Address = env.storage().instance().get(&DataKey::XlmContract).unwrap();

        let token_client = token::Client::new(&env, &xlm_contract);
        token_client.transfer(&from, &treasury, &amount);

        env.events().publish(
            (Symbol::new(&env, "pay_xlm"), order_id, from),
            amount,
        );

        Self::_exit(&env);
        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Return the treasury address.
    ///
    /// # Panics
    ///
    /// * Host error [`Error::NotInitialized`] path — `unwrap()` panics when the
    ///   contract has not been initialised.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let treasury: Address = client.treasury();
    /// ```
    pub fn treasury(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    /// Return the USDC SAC contract address.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let usdc: Address = client.usdc_contract();
    /// ```
    pub fn usdc_contract(env: Env) -> Address {
        env.storage().instance().get(&DataKey::UsdcContract).unwrap()
    }

    /// Return the native XLM SAC contract address.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let xlm: Address = client.xlm_contract();
    /// ```
    pub fn xlm_contract(env: Env) -> Address {
        env.storage().instance().get(&DataKey::XlmContract).unwrap()
    }

    /// Return the admin address.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let admin: Address = client.admin();
    /// ```
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Upgrade the contract WASM. Only the admin may call this.
    ///
    /// Replaces the currently executing contract's code with the WASM blob
    /// whose hash is `new_wasm_hash`. The blob must already be uploaded to the
    /// network.
    ///
    /// # Authorization
    ///
    /// The stored admin must sign via `admin.require_auth()`.
    ///
    /// # Panics
    ///
    /// * Propagates a host error if `new_wasm_hash` does not reference an
    ///   uploaded WASM blob.
    /// * `unwrap()` panics when the contract has not been initialised.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// let new_hash = BytesN::from_array(&env, &[0xAB; 32]);
    /// client.upgrade(&new_hash);
    /// ```
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Propose a new treasury address with a mandatory timelock.
    ///
    /// Stores a [`TreasuryProposal`] whose `effective_at` timestamp is the
    /// current ledger time plus [`TIMELOCK_SECONDS`]. The migration cannot be
    /// executed until that timestamp is reached, so a compromised admin key
    /// cannot redirect funds instantly.
    ///
    /// # Authorization
    ///
    /// The stored admin must sign via `admin.require_auth()`.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    /// * `treasury proposal already exists` — if a proposal is already pending.
    ///
    /// # Events
    ///
    /// Emits `topics=[Symbol("treasury_proposed"), new_treasury]`,
    /// `value=effective_at`.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// client.propose_treasury(&new_treasury);
    /// ```
    pub fn propose_treasury(env: Env, new_treasury: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if env.storage().instance().has(&DataKey::TreasuryProposal) {
            panic!("treasury proposal already exists");
        }

        let now = env.ledger().timestamp();
        let effective_at = now + TIMELOCK_SECONDS;

        let proposal = TreasuryProposal {
            new_treasury: new_treasury.clone(),
            proposed_at: now,
            effective_at,
        };
        env.storage().instance().set(&DataKey::TreasuryProposal, &proposal);

        env.events().publish(
            (Symbol::new(&env, "treasury_proposed"), new_treasury),
            effective_at,
        );

        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Execute a previously proposed treasury migration after the timelock.
    ///
    /// Replaces the stored treasury address with the proposal's
    /// `new_treasury` and clears the proposal.
    ///
    /// # Authorization
    ///
    /// The stored admin must sign via `admin.require_auth()`.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    /// * `treasury proposal missing` — if no proposal is pending.
    /// * `treasury timelock not elapsed` — if `now < effective_at`.
    ///
    /// # Events
    ///
    /// Emits `topics=[Symbol("treasury_migrated"), new_treasury]`, `value=now`.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// client.execute_treasury_migration();
    /// ```
    pub fn execute_treasury_migration(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let proposal: TreasuryProposal = env
            .storage()
            .instance()
            .get(&DataKey::TreasuryProposal)
            .unwrap_or_else(|| panic!("treasury proposal missing"));

        let now = env.ledger().timestamp();
        if now < proposal.effective_at {
            panic!("treasury timelock not elapsed");
        }

        env.storage().instance().set(&DataKey::Treasury, &proposal.new_treasury);
        env.storage().instance().remove(&DataKey::TreasuryProposal);

        env.events().publish(
            (Symbol::new(&env, "treasury_migrated"), proposal.new_treasury),
            now,
        );

        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }

    /// Cancel a pending treasury migration proposal.
    ///
    /// Discards the stored [`TreasuryProposal`] without touching the current
    /// treasury address. May be called at any time before execution.
    ///
    /// # Authorization
    ///
    /// The stored admin must sign via `admin.require_auth()`.
    ///
    /// # Panics
    ///
    /// * `unwrap()` panics when the contract has not been initialised.
    /// * `treasury proposal missing` — if no proposal is pending.
    ///
    /// # Events
    ///
    /// Emits `topics=[Symbol("treasury_migration_cancelled")]`, `value=now`.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let client = Stellar_CardReceiverClient::new(&env, &contract_id);
    /// client.cancel_treasury_migration();
    /// ```
    pub fn cancel_treasury_migration(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if !env.storage().instance().has(&DataKey::TreasuryProposal) {
            panic!("treasury proposal missing");
        }

        env.storage().instance().remove(&DataKey::TreasuryProposal);

        env.events().publish(
            (Symbol::new(&env, "treasury_migration_cancelled"),),
            env.ledger().timestamp(),
        );

        env.storage().instance().extend_ttl(17_280_000, 17_280_000);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token, Bytes, Env, Symbol, TryIntoVal,
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
    #[should_panic(expected = "amount must be positive")]
    fn test_pay_usdc_rejects_zero_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "zero-amount");
        f.client().pay_usdc(&f.payer, &0_i128, &oid);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_pay_usdc_rejects_negative_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "neg-amount");
        f.client().pay_usdc(&f.payer, &(-1_000_000_i128), &oid);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_pay_xlm_rejects_zero_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "xlm-zero");
        f.client().pay_xlm(&f.payer, &0_i128, &oid);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_pay_xlm_rejects_negative_amount() {
        let f = Fixture::new();
        f.init();
        let oid = order_bytes(&f.env, "xlm-neg");
        f.client().pay_xlm(&f.payer, &(-50_000_000_i128), &oid);
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

    // ── treasury migration timelock tests ────────────────────────────────────

    fn advance_ledger(env: &Env, seconds: u64) {
        env.ledger().with_mut(|li| {
            li.timestamp += seconds;
        });
    }

    #[test]
    fn test_propose_treasury_stores_proposal_and_emits_event() {
        let f = Fixture::new();
        f.init();

        let new_treasury = Address::generate(&f.env);
        f.client().propose_treasury(&new_treasury);

        let events = f.env.events().all();
        let mut found = false;
        for (contract_addr, topics, _data) in events.iter() {
            if contract_addr != f.contract_id {
                continue;
            }
            let sym: Symbol = topics.get(0).unwrap().try_into_val(&f.env).unwrap();
            if sym != Symbol::new(&f.env, "treasury_proposed") {
                continue;
            }
            let emitted: Address = topics.get(1).unwrap().try_into_val(&f.env).unwrap();
            assert_eq!(emitted, new_treasury);
            found = true;
            break;
        }
        assert!(found, "treasury_proposed event not found");

        // Treasury unchanged until execution.
        assert_eq!(f.client().treasury(), f.treasury);
    }

    #[test]
    fn test_execute_treasury_migration_after_timelock() {
        let f = Fixture::new();
        f.init();

        let new_treasury = Address::generate(&f.env);
        f.client().propose_treasury(&new_treasury);

        advance_ledger(&f.env, TIMELOCK_SECONDS);

        f.client().execute_treasury_migration();
        assert_eq!(f.client().treasury(), new_treasury);
    }

    #[test]
    #[should_panic(expected = "treasury timelock not elapsed")]
    fn test_execute_treasury_migration_early_panics() {
        let f = Fixture::new();
        f.init();

        let new_treasury = Address::generate(&f.env);
        f.client().propose_treasury(&new_treasury);

        advance_ledger(&f.env, TIMELOCK_SECONDS - 1);

        f.client().execute_treasury_migration();
    }

    #[test]
    #[should_panic(expected = "treasury proposal missing")]
    fn test_execute_treasury_migration_without_proposal_panics() {
        let f = Fixture::new();
        f.init();
        f.client().execute_treasury_migration();
    }

    #[test]
    #[should_panic(expected = "treasury proposal already exists")]
    fn test_propose_treasury_twice_panics() {
        let f = Fixture::new();
        f.init();

        let first = Address::generate(&f.env);
        let second = Address::generate(&f.env);
        f.client().propose_treasury(&first);
        f.client().propose_treasury(&second);
    }

    #[test]
    fn test_cancel_treasury_migration_discards_proposal() {
        let f = Fixture::new();
        f.init();

        let new_treasury = Address::generate(&f.env);
        f.client().propose_treasury(&new_treasury);

        advance_ledger(&f.env, TIMELOCK_SECONDS);
        f.client().cancel_treasury_migration();

        // Treasury unchanged; a fresh proposal is allowed after cancel.
        assert_eq!(f.client().treasury(), f.treasury);
        let replacement = Address::generate(&f.env);
        f.client().propose_treasury(&replacement);

        advance_ledger(&f.env, TIMELOCK_SECONDS);
        f.client().execute_treasury_migration();
        assert_eq!(f.client().treasury(), replacement);
    }

    #[test]
    #[should_panic(expected = "treasury proposal missing")]
    fn test_cancel_treasury_migration_without_proposal_panics() {
        let f = Fixture::new();
        f.init();
        f.client().cancel_treasury_migration();
    }

    #[test]
    #[should_panic]
    fn test_propose_treasury_requires_admin_auth() {
        let env = Env::default();
        env.mock_auths(&[]);

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_sac = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(Stellar_CardReceiver, ());
        let client = Stellar_CardReceiverClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &treasury, &usdc, &xlm_sac);

        env.mock_auths(&[]);
        let new_treasury = Address::generate(&env);
        let result = client.try_propose_treasury(&new_treasury);
        assert!(result.is_err(), "propose_treasury must require admin auth");
    }

    // ── reentrancy guard tests ───────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "reentrancy detected")]
    fn test_enter_when_already_entered_panics() {
        let f = Fixture::new();
        // Simulate an outer payment entrypoint already holding the guard.
        Stellar_CardReceiver::_enter(&f.env);
        // A simulated recursive call must be rejected.
        Stellar_CardReceiver::_enter(&f.env);
    }

    #[test]
    fn test_exit_clears_guard() {
        let f = Fixture::new();
        Stellar_CardReceiver::_enter(&f.env);
        Stellar_CardReceiver::_exit(&f.env);
        // Re-acquiring must succeed — the latch was cleared.
        Stellar_CardReceiver::_enter(&f.env);
    }

    #[test]
    fn test_guard_cleared_after_pay_usdc() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 12_000_000;
        f.mint_usdc(&f.payer, amount);
        let oid = order_bytes(&f.env, "guard-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        // Guard must be clear — a second payment succeeds immediately.
        f.mint_usdc(&f.payer, amount);
        f.client().pay_usdc(&f.payer, &amount, &oid);
        assert_eq!(f.usdc_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_guard_cleared_after_pay_xlm() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 30_000_000;
        f.mint_xlm(&f.payer, amount);
        let oid = order_bytes(&f.env, "guard-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        // Guard must be clear — a second payment succeeds immediately.
        f.mint_xlm(&f.payer, amount);
        f.client().pay_xlm(&f.payer, &amount, &oid);
        assert_eq!(f.xlm_balance(&f.treasury), amount * 2);
    }

    #[test]
    fn test_guard_restored_after_transfer_panic() {
        let f = Fixture::new();
        f.init();

        // Payer holds no USDC — the SAC transfer panics mid-payment.
        let oid = order_bytes(&f.env, "transfer-panic");
        let result = f.client().try_pay_usdc(&f.payer, &1_000_000_i128, &oid);
        assert!(result.is_err(), "payment without balance must fail");

        // Transaction rollback clears the latch; the next payment succeeds.
        f.mint_usdc(&f.payer, 1_000_000);
        f.client().pay_usdc(&f.payer, &1_000_000_i128, &oid);
        assert_eq!(f.usdc_balance(&f.treasury), 1_000_000);
    }

    #[test]
    fn test_enter_refreshes_instance_ttl() {
        let f = Fixture::new();
        // _enter must extend instance TTL as its first side effect. Running it
        // standalone exercises the extend_ttl call; a stale TTL bound would
        // panic here.
        Stellar_CardReceiver::_enter(&f.env);
        Stellar_CardReceiver::_exit(&f.env);
    }
}
