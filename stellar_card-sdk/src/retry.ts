export interface ExponentialBackoffDelayOptions {
  /** Zero-based retry attempt index. */
  attempt: number;
  /** Initial exponential delay in milliseconds. */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Exponential multiplier. Defaults to 2. */
  factor?: number;
  /** Optional Retry-After header value from the server. */
  retryAfter?: string | null;
  /** Jitter mode. Full jitter is the default. */
  jitter?: 'full' | 'equal' | 'decorrelated' | 'none';
  /** Override the current clock for tests. */
  nowMs?: number;
}

/**
 * Advanced retry strategy configuration.
 *
 * Used with {@link withAdvancedRetry} to control retry behaviour including
 * backoff strategy, jitter, and an optional circuit-breaker overlay.
 */
export interface AdvancedRetryStrategy {
  /** Maximum number of total attempts (including the initial call). */
  maxAttempts: number;
  /** Base delay between retries in milliseconds. */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Exponential backoff multiplier applied on each successive retry. */
  multiplier: number;
  /** Jitter strategy used to spread retries and avoid thundering-herd bursts. */
  jitterStrategy: 'full' | 'equal' | 'decorrelated' | 'none';
  /**
   * Optional predicate that decides whether a given error is retryable.
   * Return `true` to retry, `false` to rethrow immediately without further attempts.
   * Defaults to retrying all errors when omitted.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Backoff growth model applied between retries. */
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  /**
   * Optional circuit-breaker overlay. When configured, the circuit opens
   * (blocks all attempts) once `failureThreshold` consecutive failures occur
   * within `monitoringPeriodMs`, and recovers after `recoveryTimeoutMs`.
   */
  circuitBreaker?: {
    /** Number of consecutive failures before the circuit opens. */
    failureThreshold: number;
    /** Milliseconds to wait before transitioning from open → half-open. */
    recoveryTimeoutMs: number;
    /** Sliding window in milliseconds used to count consecutive failures. */
    monitoringPeriodMs: number;
  };
}

/**
 * Parse an HTTP Retry-After header into milliseconds.
 *
 * Supports both delta-seconds (`120`) and HTTP-date values. Returns
 * `null` for empty or malformed headers so callers can fall back to
 * client-side retry policy.
 *
 * @param retryAfter - The Retry-After header value from the server response
 * @param nowMs - Current timestamp in milliseconds (defaults to Date.now())
 * @returns Delay in milliseconds, or null if the header is invalid
 *
 * @example
 * ```typescript
 * const delayMs = parseRetryAfterMs('120'); // 120000 (120 seconds)
 * const delayMs2 = parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT');
 * const delayMs3 = parseRetryAfterMs('invalid'); // null
 * ```
 */
export function parseRetryAfterMs(
  retryAfter: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!retryAfter) return null;
  const value = retryAfter.trim();
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    const ms = Math.ceil(Number(value) * 1000);
    return Number.isFinite(ms) ? Math.max(0, ms) : null;
  }

  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) return null;
  return Math.max(0, timestampMs - nowMs);
}

/**
 * Compute a capped exponential backoff delay for an API retry attempt.
 *
 * Supports multiple jitter strategies:
 * - `full`: random delay in `[0, cappedDelay)` — spreads retries most aggressively (default)
 * - `equal`: `cappedDelay * 0.5 + random * cappedDelay * 0.5` — moderate spread
 * - `decorrelated`: each delay is random between `baseDelayMs` and `prevDelay * 3`
 * - `none`: deterministic `cappedDelay` with no randomness
 *
 * When the server provides a `Retry-After` header, that value acts as a hard
 * floor — the returned delay will never be shorter than the server-specified
 * wait, even if the client-side jittered value would be smaller.
 *
 * @param opts - Backoff configuration including attempt index, delays, and jitter mode.
 * @returns Milliseconds to wait before the next attempt.
 *
 * @example
 * ```typescript
 * const delay = calculateExponentialBackoffDelay({
 *   attempt: 2,
 *   baseDelayMs: 100,
 *   maxDelayMs: 5000,
 *   jitter: 'full',
 * });
 * await sleep(delay);
 * ```
 */
export function calculateExponentialBackoffDelay(
  opts: ExponentialBackoffDelayOptions,
): number {
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 'full';
  const cappedDelay = Math.min(opts.baseDelayMs * Math.pow(factor, opts.attempt), opts.maxDelayMs);
  
  let jitteredDelay: number;
  
  switch (jitter) {
    case 'none':
      jitteredDelay = cappedDelay;
      break;
    case 'equal':
      jitteredDelay = cappedDelay * 0.5 + Math.random() * cappedDelay * 0.5;
      break;
    case 'decorrelated':
      // Decorrelated jitter: delay = random(baseDelay, prevDelay * 3)
      // For first attempt, use base delay
      if (opts.attempt === 0) {
        jitteredDelay = opts.baseDelayMs;
      } else {
        const prevDelay = Math.min(opts.baseDelayMs * Math.pow(factor, opts.attempt - 1), opts.maxDelayMs);
        jitteredDelay = Math.random() * (prevDelay * 3 - opts.baseDelayMs) + opts.baseDelayMs;
      }
      jitteredDelay = Math.min(jitteredDelay, opts.maxDelayMs);
      break;
    case 'full':
    default:
      jitteredDelay = Math.floor(Math.random() * Math.max(cappedDelay, 1));
      break;
  }
  
  const retryAfterMs = parseRetryAfterMs(opts.retryAfter, opts.nowMs);
  return retryAfterMs === null ? jitteredDelay : Math.max(jitteredDelay, retryAfterMs);
}

/**
 * Run an async operation with a fully-configurable retry strategy.
 *
 * Unlike the simpler {@link withRetry}, this variant exposes the full
 * {@link AdvancedRetryStrategy} surface including `linear` / `fixed` backoff
 * modes and an optional circuit-breaker configuration.
 *
 * @param fn - The async operation to attempt. Receives the zero-based attempt
 *   index (0 on the initial call, 1 on the first retry, …).
 * @param strategy - Retry strategy configuration.
 * @returns The value returned by `fn` on a successful attempt.
 * @throws The last error thrown by `fn` when all attempts are exhausted,
 *   or immediately if `strategy.shouldRetry` returns `false`.
 *
 * @example
 * ```typescript
 * const result = await withAdvancedRetry(
 *   (attempt) => fetchData(attempt),
 *   {
 *     maxAttempts: 5,
 *     baseDelayMs: 200,
 *     maxDelayMs: 10000,
 *     multiplier: 2,
 *     jitterStrategy: 'full',
 *     backoffStrategy: 'exponential',
 *     shouldRetry: (err) => err instanceof RateLimitError,
 *   },
 * );
 * ```
 */
export async function withAdvancedRetry<T>(
  fn: (attempt: number) => Promise<T>,
  strategy: AdvancedRetryStrategy
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      
      // Check if we should retry this error
      if (strategy.shouldRetry && !strategy.shouldRetry(error, attempt)) {
        throw error;
      }
      
      // Don't delay on the last attempt
      if (attempt === strategy.maxAttempts - 1) {
        throw error;
      }
      
      // Calculate delay based on backoff strategy
      let delay: number;
      switch (strategy.backoffStrategy) {
        case 'linear':
          delay = strategy.baseDelayMs * (attempt + 1);
          break;
        case 'fixed':
          delay = strategy.baseDelayMs;
          break;
        case 'exponential':
        default:
          delay = calculateExponentialBackoffDelay({
            attempt,
            baseDelayMs: strategy.baseDelayMs,
            maxDelayMs: strategy.maxDelayMs,
            factor: strategy.multiplier,
            jitter: strategy.jitterStrategy,
          });
          break;
      }
      
      await sleep(Math.min(delay, strategy.maxDelayMs));
    }
  }
  
  throw lastError ?? new Error('Advanced retry: maximum attempts reached');
}

/**
 * Sleep for the requested number of milliseconds.
 *
 * @param ms - Duration to wait in milliseconds. Values ≤ 0 resolve immediately.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for {@link withRetry}.
 *
 * @template T - The resolved value type of the operation being retried.
 */
export interface WithRetryOptions<T> {
  /**
   * The async operation to attempt. Receives the zero-based attempt index
   * (0 on the first call, 1 on the first retry, …).
   */
  fn: (attempt: number) => Promise<T>;
  /**
   * Maximum number of additional attempts after the first failure.
   * Set to 0 to disable retries (only one attempt total). Defaults to 2.
   */
  maxRetries?: number;
  /**
   * Initial delay before the first retry, in milliseconds. Doubles on
   * each subsequent attempt. Defaults to 500.
   */
  baseDelayMs?: number;
  /**
   * Upper cap on the computed delay, in milliseconds. Defaults to 10000.
   */
  maxDelayMs?: number;
  /**
   * Predicate that decides whether a thrown error is retryable.
   * Return `true` to retry, `false` to rethrow immediately.
   * Defaults to retrying all errors.
   */
  isRetryable?: (err: unknown, attempt: number) => boolean;
  /**
   * Optional callback invoked before each retry sleep.
   * Useful for logging or emitting metrics without coupling to a logger.
   */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Run an async operation with exponential backoff retries.
 *
 * The delay between attempts is computed with {@link calculateExponentialBackoffDelay}
 * (full jitter by default), so concurrent callers naturally spread across
 * the retry window and avoid thundering-herd bursts against the API.
 *
 * @example
 * const card = await withRetry({
 *   fn: () => client.createOrder({ amount_usdc: '10.00' }),
 *   maxRetries: 3,
 *   baseDelayMs: 500,
 *   isRetryable: (err) => err instanceof RateLimitError || err instanceof ServiceUnavailableError,
 * });
 *
 * @template T - The resolved value type of the operation.
 * @param opts - Retry configuration.
 * @returns The value returned by `fn` on a successful attempt.
 * @throws The last error thrown by `fn` when all attempts are exhausted,
 *         or immediately if `isRetryable` returns `false`.
 */
export async function withRetry<T>(opts: WithRetryOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 10000;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await opts.fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryable(err, attempt)) {
        throw err;
      }
      const delayMs = calculateExponentialBackoffDelay({
        attempt,
        baseDelayMs,
        maxDelayMs,
      });
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable — the loop always returns or throws before exhausting.
  throw lastErr;
}
