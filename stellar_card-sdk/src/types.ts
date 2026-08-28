/**
 * Comprehensive TypeScript type definitions for the stellar_card SDK.
 * 
 * This module provides all the core types, interfaces, and type guards
 * used across the SDK for type-safe interactions with the stellar_card API.
 */

// ============================================================================
// NETWORK & CONFIGURATION TYPES
// ============================================================================

/** Supported Stellar network identifiers */
export type NetworkType = 'mainnet' | 'testnet' | 'futurenet' | 'custom';

/** RPC endpoint configuration */
export interface RpcEndpoint {
  /** Soroban RPC URL */
  url: string;
  /** Optional request timeout in milliseconds */
  timeout?: number;
  /** Optional API key for authenticated RPC endpoints */
  apiKey?: string;
}

/** Complete network configuration with custom endpoints */
export interface ExtendedNetworkConfig {
  /** Network passphrase (e.g., Networks.PUBLIC) */
  networkPassphrase: string;
  /** Soroban RPC configuration */
  sorobanRpc: RpcEndpoint;
  /** Horizon REST API configuration */
  horizon: RpcEndpoint;
  /** Optional friendly name for the network */
  name?: string;
}

// ============================================================================
// API CLIENT TYPES
// ============================================================================

/** HTTP method types */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** HTTP request headers */
export interface HttpHeaders {
  [key: string]: string;
}

/** HTTP request options */
export interface HttpRequestOptions {
  method: HttpMethod;
  headers?: HttpHeaders;
  body?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/** HTTP response wrapper */
export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: HttpHeaders;
  data: T;
}

// ============================================================================
// WALLET & TRANSACTION TYPES
// ============================================================================

/** Wallet keypair information */
export interface WalletKeypair {
  /** Stellar public key (G...) */
  publicKey: string;
  /** Stellar secret key (S...) - keep secure */
  secret: string;
}

/** OWS wallet metadata */
export interface OWSWalletMetadata {
  /** Unique wallet identifier */
  walletId: string;
  /** Wallet name */
  name: string;
  /** Stellar public key */
  publicKey: string;
  /** Vault file path */
  vaultPath?: string;
  /** Whether the wallet is encrypted */
  encrypted: boolean;
}

/** Transaction simulation result */
export interface TransactionSimulation {
  /** Estimated fee in stroops */
  fee: string;
  /** Resource usage estimation */
  resources: {
    cpuInstructions: number;
    readBytes: number;
    writeBytes: number;
  };
  /** Whether simulation succeeded */
  success: boolean;
  /** Simulation error if any */
  error?: string;
}

/** Transaction submission result */
export interface TransactionResult {
  /** Transaction hash */
  hash: string;
  /** Ledger number where tx was included */
  ledger: number;
  /** Whether transaction succeeded */
  successful: boolean;
  /** Result XDR */
  resultXdr?: string;
}

// ============================================================================
// PAYMENT & ORDER TYPES
// ============================================================================

/** Payment asset types */
export type PaymentAsset = 'usdc' | 'xlm';

/** Order creation parameters */
export interface OrderCreationParams {
  /** Amount in USDC (decimal string like "10.00") */
  amount_usdc: string;
  /** Optional webhook URL for order status updates */
  webhook_url?: string;
  /** Optional metadata attached to the order */
  metadata?: Record<string, unknown>;
  /** Optional idempotency key */
  idempotency_key?: string;
}

/** Payment quote details */
export interface PaymentQuote {
  /** Quoted amount (decimal string) */
  amount: string;
  /** Asset identifier (e.g., "USDC:issuer" or just "XLM") */
  asset: string;
  /** Exchange rate if applicable */
  rate?: string;
  /** Quote expiration timestamp */
  expiresAt?: string;
}

/** Extended payment instructions with validation */
export interface ExtendedPaymentInstructions {
  /** Payment model type */
  type: 'soroban_contract';
  /** Contract address (C...) */
  contract_id: string;
  /** Order ID to include in payment */
  order_id: string;
  /** USDC payment quote */
  usdc: PaymentQuote;
  /** Optional XLM payment quote */
  xlm?: PaymentQuote;
  /** Network passphrase for the payment */
  networkPassphrase?: string;
  /** Deadline timestamp for payment */
  deadline?: string;
}

// ============================================================================
// ORDER STATUS & LIFECYCLE TYPES
// ============================================================================

/** Detailed order phase with substates */
export type DetailedOrderPhase =
  | 'awaiting_approval'
  | 'awaiting_payment'
  | 'payment_received'
  | 'processing'
  | 'fulfilling'
  | 'ready'
  | 'delivered'
  | 'failed'
  | 'refunded'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** Order status history entry */
export interface OrderStatusHistory {
  /** Status at this point */
  status: string;
  /** Phase at this point */
  phase: DetailedOrderPhase;
  /** Timestamp of status change */
  timestamp: string;
  /** Optional note about the change */
  note?: string;
}

/** Extended order status with history */
export interface ExtendedOrderStatus {
  /** Order identifier */
  order_id: string;
  /** Current status string */
  status: string;
  /** Current lifecycle phase */
  phase: DetailedOrderPhase;
  /** Ordered amount in USDC */
  amount_usdc: string;
  /** Payment asset used */
  payment_asset: PaymentAsset;
  /** Card details if ready */
  card?: {
    number: string;
    cvv: string;
    expiry: string;
    brand: string | null;
  };
  /** Error message if failed */
  error?: string;
  /** Additional notes */
  note?: string;
  /** Refund info if applicable */
  refund?: {
    stellar_txid: string;
    amount: string;
    asset: string;
  };
  /** Payment instructions if pending */
  payment?: ExtendedPaymentInstructions;
  /** Order creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Status change history */
  history?: OrderStatusHistory[];
}

// ============================================================================
// BUDGET & USAGE TYPES
// ============================================================================

/** Detailed budget information */
export interface DetailedBudget {
  /** Total spent in USDC */
  spent_usdc: string;
  /** In-flight orders amount */
  in_flight_usdc: string;
  /** Total committed (spent + in-flight) */
  committed_usdc: string;
  /** Spend limit or null if unlimited */
  limit_usdc: string | null;
  /** Remaining budget or null if unlimited */
  remaining_usdc: string | null;
  /** Budget period (e.g., "monthly", "lifetime") */
  period?: string;
  /** Period start timestamp */
  period_start?: string;
  /** Period end timestamp */
  period_end?: string;
}

/** Order statistics */
export interface OrderStatistics {
  /** Total order count */
  total: number;
  /** Delivered orders */
  delivered: number;
  /** Failed orders */
  failed: number;
  /** Refunded orders */
  refunded: number;
  /** In-progress orders */
  in_progress: number;
  /** Average completion time in seconds */
  avg_completion_time?: number;
  /** Success rate (0-1) */
  success_rate?: number;
}

/** Extended usage summary with analytics */
export interface ExtendedUsageSummary {
  /** API key identifier */
  api_key_id: string;
  /** Optional label for the key */
  label: string | null;
  /** Budget information */
  budget: DetailedBudget;
  /** Order statistics */
  orders: OrderStatistics;
  /** Last activity timestamp */
  last_activity?: string;
  /** Account creation timestamp */
  created_at?: string;
}

// ============================================================================
// ERROR & RETRY TYPES
// ============================================================================

/** Error severity levels */
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

/** Extended error context */
export interface ExtendedErrorContext {
  /** Error source component */
  source?: string;
  /** Operation being attempted */
  operation?: string;
  /** Root cause error */
  cause?: Error;
  /** Suggested recovery action */
  recoveryHint?: string;
  /** Error-specific metadata */
  metadata?: Record<string, unknown>;
  /** Error severity */
  severity?: ErrorSeverity;
  /** Whether error is retryable */
  retryable?: boolean;
  /** Retry attempt number */
  retryAttempt?: number;
}

/** Retry strategy configuration */
export interface RetryStrategy {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Base delay between retries */
  baseDelayMs: number;
  /** Maximum delay cap */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Whether to use jitter */
  useJitter: boolean;
  /** Custom retry condition */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

// ============================================================================
// PAGINATION & FILTERING TYPES
// ============================================================================

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Sort options */
export interface SortOptions {
  /** Field to sort by */
  field: string;
  /** Sort direction */
  direction: SortDirection;
}

/** Filter operator */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

/** Filter condition */
export interface FilterCondition {
  /** Field to filter on */
  field: string;
  /** Filter operator */
  operator: FilterOperator;
  /** Filter value */
  value: unknown;
}

/** Advanced list options with filtering */
export interface AdvancedListOptions {
  /** Status filter */
  status?: string;
  /** Page limit */
  limit?: number;
  /** Page offset */
  offset?: number;
  /** Filter by creation time */
  since_created_at?: string;
  /** Filter by update time */
  since_updated_at?: string;
  /** Sort options */
  sort?: SortOptions;
  /** Additional filters */
  filters?: FilterCondition[];
  /** Include related resources */
  include?: string[];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Type guard for PaymentAsset */
export function isPaymentAsset(value: unknown): value is PaymentAsset {
  return value === 'usdc' || value === 'xlm';
}

/** Type guard for OrderPhase */
export function isOrderPhase(value: unknown): value is DetailedOrderPhase {
  const phases: DetailedOrderPhase[] = [
    'awaiting_approval',
    'awaiting_payment',
    'payment_received',
    'processing',
    'fulfilling',
    'ready',
    'delivered',
    'failed',
    'refunded',
    'rejected',
    'expired',
    'cancelled',
  ];
  return typeof value === 'string' && phases.includes(value as DetailedOrderPhase);
}

/** Type guard for NetworkType */
export function isNetworkType(value: unknown): value is NetworkType {
  return (
    value === 'mainnet' ||
    value === 'testnet' ||
    value === 'futurenet' ||
    value === 'custom'
  );
}

/** Type guard to check if error has a specific code */
export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/** Type guard to check if error is retryable */
export function isRetryableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { status?: number; code?: string; retryable?: boolean };
  if (typeof err.retryable === 'boolean') return err.retryable;
  if (typeof err.status === 'number') {
    return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  return false;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Make all properties of T required and non-nullable */
export type DeepRequired<T> = {
  [P in keyof T]-?: DeepRequired<NonNullable<T[P]>>;
};

/** Make all properties of T optional */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Extract keys of T that are of type U */
export type KeysOfType<T, U> = {
  [P in keyof T]: T[P] extends U ? P : never;
}[keyof T];

/** Async version of a function type */
export type AsyncFunction<T extends (...args: never[]) => unknown> = (
  ...args: Parameters<T>
) => Promise<Awaited<ReturnType<T>>>;

/** Callback function type */
export type Callback<T = void, E = Error> = (error: E | null, result?: T) => void;

/** Event emitter interface */
export interface EventEmitter<Events extends Record<string, unknown[]>> {
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void;
}

// ============================================================================
// ENHANCED INTERFACES - PART 3
// ============================================================================

/** Server-Sent Events stream interface */
export interface SSEStream {
  /** Stream URL */
  url: string;
  /** Connection state */
  readyState: 'connecting' | 'open' | 'closed';
  /** Last event ID for resumption */
  lastEventId?: string;
  /** Event handlers */
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  /** Close the stream */
  close(): void;
}

/** Enhanced HTTP client configuration */
export interface AdvancedHttpConfig {
  /** Base URL for all requests */
  baseUrl: string;
  /** Default headers for all requests */
  defaultHeaders?: HttpHeaders;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Retry configuration */
  retryConfig?: RetryStrategy;
  /** Request interceptors */
  requestInterceptors?: Array<(config: HttpRequestOptions) => HttpRequestOptions>;
  /** Response interceptors */
  responseInterceptors?: Array<(response: HttpResponse) => HttpResponse>;
}

/** Request context for debugging and monitoring */
export interface RequestContext {
  /** Unique request identifier */
  requestId: string;
  /** Request timestamp */
  timestamp: Date;
  /** Request method */
  method: HttpMethod;
  /** Request URL */
  url: string;
  /** Request attempt number */
  attempt: number;
  /** Parent trace ID for distributed tracing */
  traceId?: string;
}

/** Wallet security configuration */
export interface WalletSecurityConfig {
  /** Encryption algorithm used */
  encryption: 'aes-256-gcm' | 'chacha20-poly1305';
  /** Key derivation function */
  kdf: 'pbkdf2' | 'scrypt' | 'argon2id';
  /** KDF iterations/parameters */
  kdfParams: Record<string, number>;
  /** Whether biometric unlock is enabled */
  biometricEnabled?: boolean;
  /** Hardware security module integration */
  hsmConfig?: {
    provider: string;
    keyId: string;
  };
}

/** Multi-signature wallet configuration */
export interface MultiSigWalletConfig {
  /** Required signatures for transactions */
  threshold: number;
  /** Authorized signers */
  signers: Array<{
    publicKey: string;
    weight: number;
    label?: string;
  }>;
  /** Transaction approval workflow */
  approvalWorkflow?: {
    requireManualApproval: boolean;
    approvers: string[];
    timeoutMs: number;
  };
}

/** Hardware wallet interface */
export interface HardwareWalletInfo {
  /** Hardware wallet type */
  type: 'ledger' | 'trezor' | 'keepkey';
  /** Device connection status */
  connected: boolean;
  /** Device firmware version */
  firmwareVersion: string;
  /** Supported applications */
  supportedApps: string[];
  /** Device-specific metadata */
  deviceMetadata: Record<string, unknown>;
}

/** Transaction performance metrics */
export interface TransactionMetrics {
  /** Transaction build time in ms */
  buildTimeMs: number;
  /** Signature time in ms */
  signTimeMs: number;
  /** Network submission time in ms */
  submitTimeMs: number;
  /** Total confirmation time in ms */
  confirmTimeMs: number;
  /** Network fee paid */
  feePaid: string;
  /** Resource consumption */
  resourceUsage: {
    cpuInstructions: number;
    memoryBytes: number;
    storageBytes: number;
  };
}

/** Order completion analytics */
export interface OrderAnalytics {
  /** Order processing stages with timestamps */
  stages: Array<{
    stage: string;
    timestamp: string;
    durationMs?: number;
  }>;
  /** Performance metrics */
  metrics: {
    totalProcessingTimeMs: number;
    paymentConfirmationTimeMs: number;
    cardIssuanceTimeMs: number;
  };
  /** Geographic data if available */
  location?: {
    country: string;
    region?: string;
    city?: string;
  };
}

/** Environment-specific configuration */
export interface EnvironmentConfig {
  /** Environment name */
  environment: 'development' | 'staging' | 'production' | 'test';
  /** Debug mode enabled */
  debug: boolean;
  /** Logging configuration */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    destinations: Array<'console' | 'file' | 'remote'>;
    format: 'json' | 'text';
  };
  /** Feature flags */
  features: Record<string, boolean>;
  /** Rate limiting configuration */
  rateLimits: {
    requestsPerSecond: number;
    burstCapacity: number;
    windowSizeMs: number;
  };
}

/** SDK configuration with all options */
export interface ComprehensiveSDKConfig {
  /** API credentials */
  apiKey: string;
  /** API base URL */
  baseUrl?: string;
  /** Network configuration */
  network?: ExtendedNetworkConfig;
  /** HTTP client configuration */
  httpConfig?: AdvancedHttpConfig;
  /** Wallet configuration */
  walletConfig?: {
    type: 'ows' | 'raw-keypair' | 'hardware';
    name?: string;
    security?: WalletSecurityConfig;
  };
  /** Environment configuration */
  environment?: EnvironmentConfig;
}

// ============================================================================
// ENHANCED TYPE GUARDS & VALIDATORS
// ============================================================================

/** Enhanced type guard for API responses */
export function isValidApiResponse<T>(response: unknown, validator: (data: unknown) => data is T): response is { data: T; status: number } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'data' in response &&
    'status' in response &&
    typeof (response as { status: unknown }).status === 'number' &&
    validator((response as { data: unknown }).data)
  );
}

/** Type guard for network configuration */
export function isValidNetworkConfig(config: unknown): config is ExtendedNetworkConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    (!('networkPassphrase' in config) || typeof (config as { networkPassphrase: unknown }).networkPassphrase === 'string')
  );
}

/** Type guard for wallet keypair */
export function isValidWalletKeypair(keypair: unknown): keypair is WalletKeypair {
  return (
    typeof keypair === 'object' &&
    keypair !== null &&
    'publicKey' in keypair &&
    'secret' in keypair &&
    typeof (keypair as { publicKey: unknown }).publicKey === 'string' &&
    typeof (keypair as { secret: unknown }).secret === 'string' &&
    (keypair as { publicKey: string }).publicKey.startsWith('G') &&
    (keypair as { secret: string }).secret.startsWith('S')
  );
}

/** Type guard for order status */
export function isValidOrderStatus(status: unknown): status is ExtendedOrderStatus {
  return (
    typeof status === 'object' &&
    status !== null &&
    'order_id' in status &&
    'status' in status &&
    'phase' in status &&
    typeof (status as { order_id: unknown }).order_id === 'string' &&
    typeof (status as { status: unknown }).status === 'string' &&
    isOrderPhase((status as { phase: unknown }).phase)
  );
}

// ============================================================================
// ADVANCED UTILITY TYPES
// ============================================================================

/** Extract promise result type */
export type PromiseResult<T> = T extends Promise<infer U> ? U : never;

/** Make specific properties required */
export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Make specific properties optional */
export type PartialFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Create a union type from object values */
export type ValueOf<T> = T[keyof T];

/** Recursive readonly type */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/** Mutable version of readonly type */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

/** Function that returns a promise */
export type AsyncFn<TArgs extends readonly unknown[] = readonly unknown[], TReturn = unknown> = 
  (...args: TArgs) => Promise<TReturn>;

/** Non-nullable version of type */
export type StrictNonNullable<T> = T extends null | undefined ? never : T;

/** JSON-serializable version of type */
export type JSONSerializable<T> = T extends string | number | boolean | null
  ? T
  : T extends readonly (infer U)[]
  ? readonly JSONSerializable<U>[]
  : T extends { [key: string]: unknown }
  ? { [K in keyof T]: JSONSerializable<T[K]> }
  : never;

// ============================================================================
// ADDITIONAL TYPINGS (#150)
// ============================================================================

/**
 * Lightweight order summary for display, reporting, and analytics dashboards.
 * A subset of {@link ExtendedOrderStatus} with only the fields needed for
 * list views and aggregation.
 */
export interface OrderSummary {
  /** Order identifier */
  order_id: string;
  /** Current status string */
  status: string;
  /** Ordered amount in USDC */
  amount_usdc: string;
  /** Payment asset used */
  payment_asset: PaymentAsset;
  /** Order creation timestamp (ISO-8601) */
  created_at: string;
  /** Whether the order is in a terminal state */
  is_terminal: boolean;
}

/**
 * Result returned once a card has been successfully issued.
 * Extends the raw card fields from the API with a convenience
 * `issued_at` timestamp and the originating `order_id`.
 */
export interface CardIssuanceResult {
  /** Originating order identifier */
  order_id: string;
  /** 16-digit card number */
  number: string;
  /** 3-digit CVV */
  cvv: string;
  /** Expiry in MM/YY format */
  expiry: string;
  /** Card brand (e.g. "Visa"), or null when not provided */
  brand: string | null;
  /** ISO-8601 timestamp when the card was issued */
  issued_at: string;
}

/**
 * Pre-flight budget check result used to gate order creation.
 *
 * @example
 * ```typescript
 * const guard = await checkBudget(client, '25.00');
 * if (!guard.allowed) {
 *   console.error(guard.reason);
 * } else {
 *   await client.createOrder({ amount_usdc: '25.00' });
 * }
 * ```
 */
export interface BudgetGuard {
  /** Whether the requested amount fits within the remaining budget */
  allowed: boolean;
  /** Human-readable reason when `allowed` is `false` */
  reason?: string;
  /** Requested amount in USDC */
  requested_usdc: string;
  /** Remaining budget after this order, or null when unlimited */
  remaining_after_usdc: string | null;
}

/**
 * SDK version information exposed via `getSdkVersion()` (if present) or
 * bundled at build time for runtime compatibility checks.
 */
export interface StellarCardSDKVersion {
  /** Semantic version string, e.g. `"0.4.7"` */
  version: string;
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** Optional pre-release identifier, e.g. `"beta.1"` */
  prerelease?: string;
}

/**
 * Type guard — narrows `value` to {@link OrderSummary}.
 *
 * Checks for the minimum required fields rather than every optional field
 * so it handles both full API responses and trimmed list items.
 */
export function isOrderSummary(value: unknown): value is OrderSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['order_id'] === 'string' &&
    typeof v['status'] === 'string' &&
    typeof v['amount_usdc'] === 'string' &&
    typeof v['created_at'] === 'string'
  );
}

/**
 * Type guard — narrows `value` to {@link CardIssuanceResult}.
 */
export function isCardIssuanceResult(value: unknown): value is CardIssuanceResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['order_id'] === 'string' &&
    typeof v['number'] === 'string' &&
    typeof v['cvv'] === 'string' &&
    typeof v['expiry'] === 'string'
  );
}
