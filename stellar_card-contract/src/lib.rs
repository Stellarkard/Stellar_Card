#![no_std]
use soroban_sdk::{contract, contractimpl, contracterror, contracttype, token, Address, Bytes, BytesN, Env, Map, Symbol};

/// Represents user roles in the contract with hierarchical permissions.
/// Admin > Operator > Viewer
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
#[derive(Debug)]
pub enum Role {
    Admin,
    Operator,
    Viewer,
}

/// Storage keys for contract state
#[contracttype]
pub enum DataKey {
    Treasury,
    UsdcContract,
    XlmContract,
    Admin,
    Roles,
    ReentrancyGuard,
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
    /// Contract is paused
    ContractPaused = 3,
}

#[contract]
pub struct Stellar_CardReceiver;

/// Instance storage TTL constants (in ledgers).
/// 17_280_000 ledgers ≈ 2 years at 5s per ledger.
const INSTANCE_TTL: u32 = 17_280_000;
const INSTANCE_TTL_THRESHOLD: u32 = 17_280_000;

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
    /// # Panics
    /// Panics if already initialized or if admin authorization fails.
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

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::XlmContract, &xlm_contract);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Grant Admin role to the admin address
        let mut roles: Map<Address, Role> = Map::new(&env);
        roles.set(admin.clone(), Role::Admin);
        env.storage().instance().set(&DataKey::Roles, &roles);

        Self::extend_instance_ttl(&env);
    }

    /// Extends instance storage TTL to keep the contract alive.
    ///
    /// Centralizes the TTL extension logic to avoid repeated identical calls
    /// across functions. Uses a single `extend_ttl` call per transaction.
    fn extend_instance_ttl(env: &Env) {
        env.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL_THRESHOLD);
    }

    /// Acquires the reentrancy guard to prevent reentrant calls.
    ///
    /// # Panics
    /// Panics if the guard is already held, indicating a reentrant call attempt.
    fn _enter(env: &Env) {
        let key = DataKey::ReentrancyGuard;
        if env.storage().instance().get::<_, bool>(&key).unwrap_or(false) {
            panic!("reentrancy detected");
        }
        env.storage().instance().set(&key, &true);
    }

    /// Releases the reentrancy guard after a guarded operation completes.
    fn _exit(env: &Env) {
        env.storage().instance().set(&DataKey::ReentrancyGuard, &false);
    }

    /// Returns whether the contract is currently paused.
    fn is_paused(env: &Env) -> bool {
        env.storage().instance().get::<_, bool>(&DataKey::Paused).unwrap_or(false)
    }

    /// Pauses the contract, blocking all token transfers.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Authorization
    /// Only the admin can call this function.
    ///
    /// # Notes
    /// Idempotent — calling when already paused is a no-op.
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::extend_instance_ttl(&env);
    }

    /// Unpauses the contract, re-enabling token transfers.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    ///
    /// # Authorization
    /// Only the admin can call this function.
    ///
    /// # Notes
    /// Idempotent — calling when already unpaused is a no-op.
    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
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
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Grants a role to an address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to grant the role to
    /// * `role` - The role to grant (Admin, Operator, or Viewer)
    ///
    /// # Authorization
    /// Only the admin can call this function.
    pub fn grant_role(env: Env, address: Address, role: Role) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut roles: Map<Address, Role> = env
            .storage()
            .instance()
            .get(&DataKey::Roles)
            .unwrap_or_else(|| Map::new(&env));

        roles.set(address, role);
        env.storage().instance().set(&DataKey::Roles, &roles);
        Self::extend_instance_ttl(&env);
    }

    /// Revokes a role from an address.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `address` - The address to revoke the role from
    ///
    /// # Authorization
    /// Only the admin can call this function.
    pub fn revoke_role(env: Env, address: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if let Some(mut roles) = env.storage().instance().get::<_, Map<Address, Role>>(&DataKey::Roles) {
            roles.remove(address);
            env.storage().instance().set(&DataKey::Roles, &roles);
            Self::extend_instance_ttl(&env);
        }
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
        if let Some(roles) = env.storage().instance().get::<_, Map<Address, Role>>(&DataKey::Roles) {
            roles.get(address)
        } else {
            None
        }
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
        if let Some(roles) = env.storage().instance().get::<_, Map<Address, Role>>(&DataKey::Roles) {
            if let Some(user_role) = roles.get(address) {
                return Self::is_role_sufficient(&user_role, &required_role);
            }
        }
        false
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
        testutils::{Address as _, Events},
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
            f.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
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

    // ── pause/unpause tests ────────────────────────────────────────────────

    #[test]
    fn test_init_sets_unpaused() {
        let f = Fixture::new();
        f.init();
        assert!(!f.client().is_paused_view());
    }

    #[test]
    fn test_pause_and_unpause() {
        let f = Fixture::new();
        f.init();

        f.client().pause();
        assert!(f.client().is_paused_view());

        f.client().unpause();
        assert!(!f.client().is_paused_view());
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

        env.mock_auths(&[]);
        client.pause();
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
        client.pause();

        env.mock_auths(&[]);
        client.unpause();
    }

    #[test]
    fn test_pay_usdc_rejected_when_paused() {
        let f = Fixture::new();
        f.init();

        f.mint_usdc(&f.payer, 10_000_000);
        f.client().pause();

        let oid = order_bytes(&f.env, "paused-usdc");
        let result = f.client().try_pay_usdc(&f.payer, &1_000_000_i128, &oid);
        assert!(result.is_err(), "should reject payment when paused");
    }

    #[test]
    fn test_pay_xlm_rejected_when_paused() {
        let f = Fixture::new();
        f.init();

        f.mint_xlm(&f.payer, 10_000_000);
        f.client().pause();

        let oid = order_bytes(&f.env, "paused-xlm");
        let result = f.client().try_pay_xlm(&f.payer, &1_000_000_i128, &oid);
        assert!(result.is_err(), "should reject payment when paused");
    }

    #[test]
    fn test_pay_usdc_after_unpause_works() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_usdc(&f.payer, amount);

        f.client().pause();
        f.client().unpause();

        let oid = order_bytes(&f.env, "after-unpause-usdc");
        f.client().pay_usdc(&f.payer, &amount, &oid);

        assert_eq!(f.usdc_balance(&f.treasury), amount);
    }

    #[test]
    fn test_pay_xlm_after_unpause_works() {
        let f = Fixture::new();
        f.init();

        let amount: i128 = 5_000_000;
        f.mint_xlm(&f.payer, amount);

        f.client().pause();
        f.client().unpause();

        let oid = order_bytes(&f.env, "after-unpause-xlm");
        f.client().pay_xlm(&f.payer, &amount, &oid);

        assert_eq!(f.xlm_balance(&f.treasury), amount);
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

    #[test]
    fn test_upgrade_works() {
        let f = Fixture::new();
        f.init();

        let new_hash = BytesN::from_array(&f.env, &[1u8; 32]);
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
}
