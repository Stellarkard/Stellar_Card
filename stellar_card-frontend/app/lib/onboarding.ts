// Onboarding flow state management with localStorage persistence
// Tracks user progress through the first-run experience

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface OnboardingState {
  started: boolean;
  currentStep: number;
  steps: OnboardingStep[];
  completed: boolean;
  skipped: boolean;
  lastUpdated: number;
}

const STORAGE_KEY = 'stellar_card_onboarding';

// Default onboarding steps
export const DEFAULT_STEPS: Omit<OnboardingStep, 'completed'>[] = [
  {
    id: 'welcome',
    title: 'Welcome to Stellar_Card',
    description: 'Learn the basics of managing your virtual cards',
  },
  {
    id: 'create-agent',
    title: 'Create Your First Agent',
    description: 'Set up an API key to start processing orders',
  },
  {
    id: 'configure-wallet',
    title: 'Connect Your Wallet',
    description: 'Link your Stellar wallet for payments',
  },
  {
    id: 'test-order',
    title: 'Test an Order',
    description: 'Try creating a test order to see the flow',
  },
];

/**
 * Get current onboarding state from localStorage
 */
export function getOnboardingState(): OnboardingState | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as OnboardingState;
    return state;
  } catch (error) {
    console.error('Failed to load onboarding state:', error);
    return null;
  }
}

/**
 * Initialize new onboarding state
 */
export function initializeOnboarding(): OnboardingState {
  const state: OnboardingState = {
    started: true,
    currentStep: 0,
    steps: DEFAULT_STEPS.map((step) => ({ ...step, completed: false })),
    completed: false,
    skipped: false,
    lastUpdated: Date.now(),
  };

  saveOnboardingState(state);
  return state;
}

/**
 * Save onboarding state to localStorage
 */
export function saveOnboardingState(state: OnboardingState): void {
  if (typeof window === 'undefined') return;

  try {
    const updated = { ...state, lastUpdated: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save onboarding state:', error);
  }
}

/**
 * Mark a specific step as completed
 */
export function completeStep(stepId: string): OnboardingState | null {
  const state = getOnboardingState();
  if (!state) return null;

  const stepIndex = state.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) return state;

  state.steps[stepIndex].completed = true;

  // Auto-advance to next incomplete step
  const nextIncomplete = state.steps.findIndex((s) => !s.completed);
  if (nextIncomplete !== -1) {
    state.currentStep = nextIncomplete;
  } else {
    // All steps completed
    state.completed = true;
  }

  saveOnboardingState(state);
  return state;
}

/**
 * Move to next step in the onboarding flow
 */
export function nextStep(): OnboardingState | null {
  const state = getOnboardingState();
  if (!state) return null;

  if (state.currentStep < state.steps.length - 1) {
    state.currentStep += 1;
    saveOnboardingState(state);
  }

  return state;
}

/**
 * Move to previous step in the onboarding flow
 */
export function previousStep(): OnboardingState | null {
  const state = getOnboardingState();
  if (!state) return null;

  if (state.currentStep > 0) {
    state.currentStep -= 1;
    saveOnboardingState(state);
  }

  return state;
}

/**
 * Skip the entire onboarding flow
 */
export function skipOnboarding(): void {
  const state = getOnboardingState() || initializeOnboarding();
  state.skipped = true;
  state.completed = true;
  saveOnboardingState(state);
}

/**
 * Reset onboarding state (for testing or re-onboarding)
 */
export function resetOnboarding(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if user should see onboarding
 */
export function shouldShowOnboarding(): boolean {
  const state = getOnboardingState();
  if (!state) return true;
  return !state.completed && !state.skipped;
}

/**
 * Get progress percentage
 */
export function getProgress(state: OnboardingState): number {
  const completed = state.steps.filter((s) => s.completed).length;
  return Math.round((completed / state.steps.length) * 100);
}
