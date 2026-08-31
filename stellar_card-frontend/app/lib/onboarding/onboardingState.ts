/**
 * Onboarding state persistence utilities
 * Part 1: Enhanced state management with localStorage and session tracking
 * Provides robust onboarding flow state persistence
 */

export interface OnboardingState {
  completed: boolean;
  currentStep: number;
  visitedSteps: number[];
  startedAt: number;
  completedAt: number | null;
  skipped: boolean;
  version: string;
}

export interface OnboardingStepState {
  id: string;
  completed: boolean;
  skipped: boolean;
  visitCount: number;
  lastVisited: number;
  metadata?: Record<string, unknown>;
}

const ONBOARDING_STATE_KEY = 'stellar_card.onboarding.state';
const ONBOARDING_STEPS_KEY = 'stellar_card.onboarding.steps';
const ONBOARDING_VERSION = '1.0.0';

/**
 * Get the current onboarding state from localStorage
 */
export function getOnboardingState(): OnboardingState | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(ONBOARDING_STATE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as OnboardingState;
    
    // Version check - reset if version mismatch
    if (state.version !== ONBOARDING_VERSION) {
      clearOnboardingState();
      return null;
    }

    return state;
  } catch (error) {
    console.error('Failed to load onboarding state:', error);
    return null;
  }
}

/**
 * Save onboarding state to localStorage
 */
export function saveOnboardingState(state: Partial<OnboardingState>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getOnboardingState() || getDefaultOnboardingState();
    const updated = { ...current, ...state };
    
    window.localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save onboarding state:', error);
  }
}

/**
 * Clear onboarding state (for reset/debugging)
 */
export function clearOnboardingState(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(ONBOARDING_STATE_KEY);
    window.localStorage.removeItem(ONBOARDING_STEPS_KEY);
  } catch (error) {
    console.error('Failed to clear onboarding state:', error);
  }
}

/**
 * Get default onboarding state
 */
export function getDefaultOnboardingState(): OnboardingState {
  return {
    completed: false,
    currentStep: 0,
    visitedSteps: [],
    startedAt: Date.now(),
    completedAt: null,
    skipped: false,
    version: ONBOARDING_VERSION,
  };
}

/**
 * Mark onboarding as started
 */
export function startOnboarding(): void {
  const state = getOnboardingState();
  
  if (!state || state.completed) {
    saveOnboardingState(getDefaultOnboardingState());
  }
}

/**
 * Mark onboarding as completed
 */
export function completeOnboarding(): void {
  saveOnboardingState({
    completed: true,
    completedAt: Date.now(),
    skipped: false,
  });
}

/**
 * Mark onboarding as skipped
 */
export function skipOnboarding(): void {
  saveOnboardingState({
    completed: true,
    completedAt: Date.now(),
    skipped: true,
  });
}

/**
 * Update current step
 */
export function setCurrentStep(step: number): void {
  const state = getOnboardingState();
  const visitedSteps = state?.visitedSteps || [];
  
  if (!visitedSteps.includes(step)) {
    visitedSteps.push(step);
  }

  saveOnboardingState({
    currentStep: step,
    visitedSteps,
  });

  updateStepState(step.toString(), { visitCount: 1, lastVisited: Date.now() });
}

/**
 * Check if onboarding is completed
 */
export function isOnboardingCompleted(): boolean {
  const state = getOnboardingState();
  return state?.completed ?? false;
}

/**
 * Check if onboarding should be shown
 */
export function shouldShowOnboarding(): boolean {
  const state = getOnboardingState();
  return !state || !state.completed;
}

/**
 * Get onboarding progress percentage
 */
export function getOnboardingProgress(totalSteps: number): number {
  const state = getOnboardingState();
  if (!state) return 0;

  const { currentStep, completed } = state;
  if (completed) return 100;

  return Math.round(((currentStep + 1) / totalSteps) * 100);
}

// ── Per-step state management ─────────────────────────────────────────

/**
 * Get all step states
 */
export function getAllStepStates(): Record<string, OnboardingStepState> {
  if (typeof window === 'undefined') return {};

  try {
    const stored = window.localStorage.getItem(ONBOARDING_STEPS_KEY);
    if (!stored) return {};

    return JSON.parse(stored) as Record<string, OnboardingStepState>;
  } catch (error) {
    console.error('Failed to load step states:', error);
    return {};
  }
}

/**
 * Get state for a specific step
 */
export function getStepState(stepId: string): OnboardingStepState | null {
  const allStates = getAllStepStates();
  return allStates[stepId] || null;
}

/**
 * Update state for a specific step
 */
export function updateStepState(
  stepId: string,
  update: Partial<OnboardingStepState>
): void {
  if (typeof window === 'undefined') return;

  try {
    const allStates = getAllStepStates();
    const current = allStates[stepId] || {
      id: stepId,
      completed: false,
      skipped: false,
      visitCount: 0,
      lastVisited: Date.now(),
    };

    allStates[stepId] = { ...current, ...update };

    window.localStorage.setItem(ONBOARDING_STEPS_KEY, JSON.stringify(allStates));
  } catch (error) {
    console.error('Failed to update step state:', error);
  }
}

/**
 * Mark a step as completed
 */
export function completeStep(stepId: string, metadata?: Record<string, unknown>): void {
  updateStepState(stepId, {
    completed: true,
    lastVisited: Date.now(),
    metadata,
  });
}

/**
 * Mark a step as skipped
 */
export function skipStep(stepId: string): void {
  updateStepState(stepId, {
    skipped: true,
    lastVisited: Date.now(),
  });
}

/**
 * Check if a step has been visited
 */
export function hasVisitedStep(stepId: string): boolean {
  const state = getStepState(stepId);
  return state?.visitCount ? state.visitCount > 0 : false;
}

/**
 * Get completion percentage for all steps
 */
export function getStepsCompletionRate(stepIds: string[]): number {
  const states = getAllStepStates();
  const completed = stepIds.filter((id) => states[id]?.completed).length;
  
  return stepIds.length > 0 ? Math.round((completed / stepIds.length) * 100) : 0;
}

// ── Analytics helpers ─────────────────────────────────────────────────

/**
 * Get onboarding analytics data
 */
export function getOnboardingAnalytics(): {
  state: OnboardingState | null;
  steps: Record<string, OnboardingStepState>;
  duration: number | null;
  completionRate: number;
} {
  const state = getOnboardingState();
  const steps = getAllStepStates();
  
  const duration = state && state.completedAt
    ? state.completedAt - state.startedAt
    : null;

  const stepIds = Object.keys(steps);
  const completionRate = getStepsCompletionRate(stepIds);

  return {
    state,
    steps,
    duration,
    completionRate,
  };
}

/**
 * Export onboarding data for debugging
 */
export function exportOnboardingData(): string {
  const analytics = getOnboardingAnalytics();
  return JSON.stringify(analytics, null, 2);
}

/**
 * Import onboarding data (for testing/migration)
 */
export function importOnboardingData(jsonData: string): void {
  if (typeof window === 'undefined') return;

  try {
    const data = JSON.parse(jsonData);
    
    if (data.state) {
      window.localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(data.state));
    }
    
    if (data.steps) {
      window.localStorage.setItem(ONBOARDING_STEPS_KEY, JSON.stringify(data.steps));
    }
  } catch (error) {
    console.error('Failed to import onboarding data:', error);
  }
}

// ── Session tracking ──────────────────────────────────────────────────

/**
 * Track onboarding session for analytics
 */
export function trackOnboardingEvent(
  event: 'start' | 'step_view' | 'step_complete' | 'skip' | 'complete',
  metadata?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;

  // This would integrate with your analytics service
  const eventData = {
    event: `onboarding_${event}`,
    timestamp: Date.now(),
    metadata,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('[Onboarding Event]', eventData);
  }

  // TODO: Send to analytics service (e.g., PostHog, Mixpanel, etc.)
}
