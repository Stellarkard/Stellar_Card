import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOnboardingState,
  initializeOnboarding,
  saveOnboardingState,
  completeStep,
  nextStep,
  previousStep,
  skipOnboarding,
  resetOnboarding,
  shouldShowOnboarding,
  getProgress,
  DEFAULT_STEPS,
} from './onboarding';

describe('onboarding', () => {
  beforeEach(() => {
    resetOnboarding();
  });

  afterEach(() => {
    resetOnboarding();
  });

  describe('initialization', () => {
    it('should return null when no state exists', () => {
      const state = getOnboardingState();
      expect(state).toBeNull();
    });

    it('should initialize new onboarding state', () => {
      const state = initializeOnboarding();
      expect(state.started).toBe(true);
      expect(state.currentStep).toBe(0);
      expect(state.completed).toBe(false);
      expect(state.skipped).toBe(false);
      expect(state.steps).toHaveLength(DEFAULT_STEPS.length);
    });

    it('should save state to localStorage', () => {
      const state = initializeOnboarding();
      const retrieved = getOnboardingState();
      expect(retrieved).toEqual(state);
    });
  });

  describe('step navigation', () => {
    beforeEach(() => {
      initializeOnboarding();
    });

    it('should advance to next step', () => {
      const state = nextStep();
      expect(state?.currentStep).toBe(1);
    });

    it('should not advance past last step', () => {
      const initial = getOnboardingState();
      if (!initial) return;

      // Advance to last step
      for (let i = 0; i < initial.steps.length - 1; i++) {
        nextStep();
      }

      const beforeLast = getOnboardingState();
      const afterLast = nextStep();
      
      expect(beforeLast?.currentStep).toBe(afterLast?.currentStep);
    });

    it('should go back to previous step', () => {
      nextStep();
      nextStep();
      const state = previousStep();
      expect(state?.currentStep).toBe(1);
    });

    it('should not go before first step', () => {
      const state = previousStep();
      expect(state?.currentStep).toBe(0);
    });
  });

  describe('step completion', () => {
    beforeEach(() => {
      initializeOnboarding();
    });

    it('should mark step as completed', () => {
      const state = completeStep('welcome');
      expect(state?.steps[0].completed).toBe(true);
    });

    it('should auto-advance to next incomplete step', () => {
      const state = completeStep('welcome');
      expect(state?.currentStep).toBe(1);
    });

    it('should mark onboarding as completed when all steps done', () => {
      DEFAULT_STEPS.forEach((step) => {
        completeStep(step.id);
      });

      const state = getOnboardingState();
      expect(state?.completed).toBe(true);
    });
  });

  describe('skipping', () => {
    beforeEach(() => {
      initializeOnboarding();
    });

    it('should mark onboarding as skipped', () => {
      skipOnboarding();
      const state = getOnboardingState();
      expect(state?.skipped).toBe(true);
      expect(state?.completed).toBe(true);
    });
  });

  describe('shouldShowOnboarding', () => {
    it('should return true when no state exists', () => {
      expect(shouldShowOnboarding()).toBe(true);
    });

    it('should return false when completed', () => {
      initializeOnboarding();
      skipOnboarding();
      expect(shouldShowOnboarding()).toBe(false);
    });

    it('should return true when started but not completed', () => {
      initializeOnboarding();
      expect(shouldShowOnboarding()).toBe(true);
    });
  });

  describe('getProgress', () => {
    beforeEach(() => {
      initializeOnboarding();
    });

    it('should return 0 when no steps completed', () => {
      const state = getOnboardingState();
      if (!state) return;
      expect(getProgress(state)).toBe(0);
    });

    it('should return 25% when 1 of 4 steps completed', () => {
      completeStep('welcome');
      const state = getOnboardingState();
      if (!state) return;
      expect(getProgress(state)).toBe(25);
    });

    it('should return 100% when all steps completed', () => {
      DEFAULT_STEPS.forEach((step) => {
        completeStep(step.id);
      });
      const state = getOnboardingState();
      if (!state) return;
      expect(getProgress(state)).toBe(100);
    });
  });
});
