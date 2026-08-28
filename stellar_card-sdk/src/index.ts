export { Stellar_CardClient } from './client';
export type {
  OrderOptions,
  CreateOrderOptions,
  OrderResponse,
  OrderStatus,
  OrderListItem,
  OrderPhase,
  CardDetails,
  PaymentInstructions,
  Budget,
  UsageSummary,
  RetryOptions,
  WaitForCardOptions,
  ListOrdersOptions,
  ListOrdersPage,
  IterateOrdersOptions,
  ReportStatusOptions,
  StellarCardClientOptions,
} from './client';

export { calculateExponentialBackoffDelay, parseRetryAfterMs, sleep, withRetry, withAdvancedRetry } from './retry';
export type { ExponentialBackoffDelayOptions, WithRetryOptions, AdvancedRetryStrategy } from './retry';

export {
  createWallet,
  getBalance,
  addUsdcTrustline,
  payViaContract,
  purchaseCard,
  // Re-export from this barrel to keep external imports stable even if
  // internal module boundaries change later.
  // Back-compat alias for payViaContract.
  payVCC,
} from './stellar';
export type { WalletInfo, PayOpts } from './stellar';

export {
  createOWSWallet,
  importStellarKey,
  getOWSPublicKey,
  getOWSBalance,
  addUsdcTrustlineOWS,
  checkSorobanTxLanded,
  payViaContractOWS,
  purchaseCardOWS,
  onboardAgent,
  // Back-compat alias.
  payVCCOWS,
} from './ows';
export type {
  TrustlineOpts,
  PayViaContractOwsOpts,
  PayVCCOwsOpts,
  PurchaseCardOwsOpts,
  OnboardAgentOpts,
  OnboardAgentResult,
} from './ows';

export {
  Stellar_CardError,
  SpendLimitError,
  RateLimitError,
  ServiceUnavailableError,
  PriceUnavailableError,
  InvalidAmountError,
  AuthError,
  OrderFailedError,
  WaitTimeoutError,
  ResumableError,
  NetworkError,
  TimeoutError,
  ValidationError,
  SorobanRpcError,
  HorizonError,
  WalletError,
  parseApiError,
  wrapError,
  wrapValidationError,
  buildErrorChain,
  isRetryableByDefault,
  wrapNetworkError,
  wrapTimeoutError,
  wrapSorobanError,
  wrapHorizonError,
  wrapWalletError,
  type ErrorContext,
} from './errors';

export { InsufficientFeeError } from './soroban';

export { mppCharge } from './mpp';
export type { MppChargeOpts, MppChargeResult } from './mpp';

export { loadStellar_CardConfig, saveStellar_CardConfig, resolveCredentials } from './config';
export type { Stellar_CardConfig } from './config';

export { paginate, iteratePages, collectAllPages, mapPaginated } from './pagination';
export type {
  PaginationCursor,
  PaginatedResult,
  PaginateOptions,
  IteratePagesOptions,
  MapPaginatedOptions,
} from './pagination';

export {
  resolveNetworkConfig,
  resolveNetworkConfigFromEnv,
  getDefaultSorobanRpcUrl,
  getDefaultHorizonUrl,
  createCustomNetworkConfig,
  validateRpcEndpoint,
  NETWORK_ENV_VARS,
} from './network';
export type {
  NetworkConfig,
  RpcEndpointConfig,
  ResolvedRpcEndpoint,
  ResolvedNetworkConfig,
} from './network';

// Export comprehensive type definitions
export type {
  NetworkType,
  RpcEndpoint,
  ExtendedNetworkConfig,
  HttpMethod,
  HttpHeaders,
  HttpRequestOptions,
  HttpResponse,
  WalletKeypair,
  OWSWalletMetadata,
  TransactionSimulation,
  TransactionResult,
  PaymentAsset,
  OrderCreationParams,
  PaymentQuote,
  ExtendedPaymentInstructions,
  DetailedOrderPhase,
  OrderStatusHistory,
  ExtendedOrderStatus,
  DetailedBudget,
  OrderStatistics,
  ExtendedUsageSummary,
  ErrorSeverity,
  ExtendedErrorContext,
  RetryStrategy,
  SortDirection,
  SortOptions,
  FilterOperator,
  FilterCondition,
  AdvancedListOptions,
  DeepRequired,
  DeepPartial,
  KeysOfType,
  AsyncFunction,
  Callback,
  EventEmitter,
  // Additional typings (#150)
  OrderSummary,
  CardIssuanceResult,
  BudgetGuard,
  StellarCardSDKVersion,
} from './types';

export {
  isPaymentAsset,
  isOrderPhase,
  isNetworkType,
  hasErrorCode,
  isRetryableError,
  isOrderSummary,
  isCardIssuanceResult,
} from './types';
