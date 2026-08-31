// Core configuration for the global loading / empty / error state system
// (Part 2 of the ui-states roadmap).
//
// Parts 1 and 3 introduced the state primitives and the orchestration
// layer. This module consolidates the values that were previously
// duplicated as inline literals across those components — default copy,
// retry policy, persistence key prefix, and skeleton geometry — into a
// single typed source of truth. Tuning the shared UX now happens here.

/** Retry policy for async state orchestration (see StateManager). */
export interface RetryConfig {
  /** Maximum number of retry attempts after the initial failure. */
  attempts: number;
  /** Base delay in milliseconds before the first retry. */
  baseDelayMs: number;
}

/** Default retry policy: 3 attempts with 1s base backoff. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  attempts: 3,
  baseDelayMs: 1000,
};

/** Prefix applied to every localStorage persistence key. */
export const PERSIST_KEY_PREFIX = 'state_';

/** Default number of skeleton lines rendered while loading. */
export const DEFAULT_LOADING_LINES = 3;

/**
 * Default user-facing copy shared by the loading, empty, and error
 * primitives. Keeping the strings here prevents drift between the
 * page-level and section-level variants.
 */
export const DEFAULT_STATE_COPY = {
  loading: {
    label: 'Loading…',
  },
  empty: {
    /** Page-level empty title. */
    title: 'No data found',
    /** Section-level empty title. */
    sectionTitle: 'No data',
    description: 'There is nothing to display at the moment.',
  },
  error: {
    /** Fallback error title used by ErrorState. */
    title: 'Something went wrong',
    /** Fallback error message used by ErrorState. */
    message: 'An unexpected error occurred. Please try again.',
    /** Page-level error title used by the providers. */
    pageTitle: 'Failed to load',
    /** Compact section error title. */
    compactTitle: 'Error',
  },
} as const;

/**
 * Build the storage key used to persist a named state slot.
 *
 * @param key Named slot (without prefix).
 * @returns Prefixed key, e.g. `buildPersistKey('orders')` → `'state_orders'`.
 */
export function buildPersistKey(key: string): string {
  return `${PERSIST_KEY_PREFIX}${key}`;
}

/**
 * Exponential backoff delay for the given attempt index.
 *
 * Attempt 0 → baseDelay, 1 → 2×, 2 → 4×, and so on. The exponent is
 * clamped to 30 so a misconfigured attempt count can never overflow to
 * `Infinity` (which would make the delay wait forever).
 *
 * @param attempt     Zero-based attempt index.
 * @param baseDelayMs Base delay in milliseconds.
 */
export function retryDelayForAttempt(
  attempt: number,
  baseDelayMs: number = DEFAULT_RETRY_CONFIG.baseDelayMs,
): number {
  const exponent = Math.min(Math.max(attempt, 0), 30);
  return baseDelayMs * 2 ** exponent;
}

/**
 * Whether another retry is allowed given the attempts made so far.
 *
 * @param retryCount Retries already performed.
 * @param attempts   Maximum retry attempts allowed.
 */
export function isWithinRetryLimit(
  retryCount: number,
  attempts: number = DEFAULT_RETRY_CONFIG.attempts,
): boolean {
  return retryCount < attempts;
}
