// Core configuration and pure helpers for the first-run onboarding flow
// (Part 2 of the onboarding roadmap).
//
// Part 1 introduced the OnboardingProvider/Modal/Tooltip components and the
// dashboard wizard. This module consolidates the values and logic that were
// previously duplicated as inline literals — the persistence key, the
// completed marker, safe localStorage access, and step navigation math —
// into a single typed source of truth that works in Node (SSR/tests) and the
// browser alike.

/** Minimal storage surface the onboarding helpers need (satisfied by `localStorage`). */
export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Default localStorage key used to persist onboarding completion. */
export const DEFAULT_ONBOARDING_STORAGE_KEY = 'onboarding-completed';

/** Value written to storage once onboarding is completed or skipped. */
export const ONBOARDING_COMPLETED_VALUE = 'true';

/**
 * Resolve the ambient browser storage, or `null` when running outside the
 * browser or when storage access is blocked (e.g. incognito strict mode).
 */
function resolveStorage(): OnboardingStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether onboarding has already been completed for the given storage key.
 * Safe to call during SSR (returns `false`) and when storage throws.
 */
export function readOnboardingCompleted(
  storageKey: string = DEFAULT_ONBOARDING_STORAGE_KEY,
  storage: OnboardingStorage | null = resolveStorage(),
): boolean {
  if (!storage) return false;
  try {
    return !!storage.getItem(storageKey);
  } catch {
    return false;
  }
}

/**
 * Persist the completion marker for the given storage key. No-op when storage
 * is unavailable or throws.
 */
export function markOnboardingCompleted(
  storageKey: string = DEFAULT_ONBOARDING_STORAGE_KEY,
  storage: OnboardingStorage | null = resolveStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey, ONBOARDING_COMPLETED_VALUE);
  } catch {
    // Storage blocked — best effort only.
  }
}

/**
 * Clear the completion marker so onboarding runs again (e.g. "restart tour").
 * No-op when storage is unavailable or throws.
 */
export function clearOnboardingCompleted(
  storageKey: string = DEFAULT_ONBOARDING_STORAGE_KEY,
  storage: OnboardingStorage | null = resolveStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // Storage blocked — best effort only.
  }
}

/**
 * Percentage progress (0–100) for the step at `currentStepIndex` of
 * `totalSteps`. Returns 0 for an empty step list and never exceeds 100.
 */
export function getOnboardingProgress(currentStepIndex: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  const current = Math.max(0, currentStepIndex);
  return Math.min(100, ((current + 1) / totalSteps) * 100);
}

/** Whether `index` is a valid step index for a list of `totalSteps` steps. */
export function isValidStepIndex(index: number, totalSteps: number): boolean {
  return index >= 0 && index < totalSteps;
}

/** Whether there is a next step after `currentStepIndex`. */
export function canGoNext(currentStepIndex: number, totalSteps: number): boolean {
  return currentStepIndex < totalSteps - 1;
}

/** Whether there is a previous step before `currentStepIndex`. */
export function canGoPrevious(currentStepIndex: number): boolean {
  return currentStepIndex > 0;
}