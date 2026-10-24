/**
 * useOnboardingFlow Hook
 * 
 * Complete onboarding flow management hook with:
 * - State persistence (with fallbacks)
 * - Step navigation
 * - Progress tracking
 * - Callback handling
 */

'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { getOnboardingStorage, type OnboardingState } from './onboarding-storage';
import { createOnboardingConfig, type OnboardingFlowConfig, type OnboardingStepConfig } from './onboarding-config';

export interface UseOnboardingFlowOptions {
  /** Auto-initialize on first render */
  autoInit?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

export interface UseOnboardingFlowReturn {
  // State
  isVisible: boolean;
  isCompleted: boolean;
  currentStep: OnboardingStepConfig | null;
  currentStepIndex: number;
  progress: number;
  stepCount: number;
  
  // Navigation
  nextStep: () => Promise<void>;
  previousStep: () => void;
  goToStep: (id: string) => Promise<void>;
  skipStep: () => Promise<void>;
  skipOnboarding: () => Promise<void>;
  
  // Control
  startOnboarding: () => void;
  closeOnboarding: () => void;
  resetOnboarding: () => void;
  completeOnboarding: () => Promise<void>;
  
  // Query
  canGoBack: boolean;
  canGoForward: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
}

/**
 * Hook for managing onboarding flow with state persistence
 */
export function useOnboardingFlow(
  flowConfig: OnboardingFlowConfig,
  options: UseOnboardingFlowOptions = {}
): UseOnboardingFlowReturn {
  const { autoInit = true, debug = false } = options;

  // Create config instance
  const configRef = useRef(createOnboardingConfig(flowConfig));
  const storageRef = useRef(getOnboardingStorage({ keyPrefix: 'onboarding', version: 1, debug }));

  // State
  const [isVisible, setIsVisible] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Get current step and related values
  const config = configRef.current;
  const storage = storageRef.current;
  const storageKey = config.getStorageKey();

  const currentStep = currentStepId ? config.getStep(currentStepId) : null;
  const visibleSteps = config.getVisibleSteps();
  const currentStepIndex = currentStepId ? config.getVisibleStepIndex(currentStepId) : 0;
  const progress = currentStepId ? config.getProgress(currentStepId) : 0;

  // Check navigation possibilities
  const canGoBack = currentStepId ? config.getPreviousStep(currentStepId) !== undefined : false;
  const canGoForward = currentStepId ? config.getNextStep(currentStepId) !== undefined : false;
  const isFirstStep = currentStepId ? config.isFirstStep(currentStepId) : false;
  const isLastStep = currentStepId ? config.isLastStep(currentStepId) : false;

  // Initialize onboarding from storage
  const initializeOnboarding = useCallback(async () => {
    try {
      const state = storage.getState(storageKey);
      
      if (state?.completed) {
        setIsCompleted(true);
        setIsVisible(false);
        return;
      }

      // Get saved step or start from first
      let stepId = state?.currentStep ? visibleSteps[state.currentStep]?.id : visibleSteps[0]?.id;
      if (!stepId && visibleSteps.length > 0) {
        stepId = visibleSteps[0].id;
      }

      if (stepId) {
        setCurrentStepId(stepId);
        await config.onStepEnter(stepId);
        setIsVisible(true);
      }
    } catch (error) {
      console.error('Error initializing onboarding:', error);
      if (debug) {
        console.error('[useOnboardingFlow] Initialize error:', error);
      }
    }
  }, [config, storage, storageKey, visibleSteps, debug]);

  // Auto-initialize on mount
  useEffect(() => {
    if (autoInit) {
      initializeOnboarding();
    }
  }, [autoInit, initializeOnboarding]);

  // Save step progress to storage
  const saveProgress = useCallback(async (stepId: string) => {
    if (!stepId) return;

    const stepIndex = config.getVisibleStepIndex(stepId);
    storage.setCurrentStep(stepIndex, storageKey);

    if (debug) {
      console.log('[useOnboardingFlow] Saved progress:', { stepId, stepIndex });
    }
  }, [config, storage, storageKey, debug]);

  // Navigate to next step
  const nextStep = useCallback(async () => {
    if (!currentStepId || isTransitioning) return;

    setIsTransitioning(true);
    try {
      // Validate current step
      const isValid = await config.validateStep(currentStepId);
      if (!isValid) {
        console.warn('Step validation failed');
        setIsTransitioning(false);
        return;
      }

      // Exit current step
      await config.onStepExit(currentStepId);

      // Get next step
      const nextStepConfig = config.getNextStep(currentStepId);
      
      if (!nextStepConfig) {
        // Last step reached
        await completeOnboarding();
        return;
      }

      // Enter next step
      await config.onStepEnter(nextStepConfig.id);
      setCurrentStepId(nextStepConfig.id);
      await saveProgress(nextStepConfig.id);
      config.getFlow().onStepChange?.(nextStepConfig.id, config.getVisibleStepIndex(nextStepConfig.id));

      if (debug) {
        console.log('[useOnboardingFlow] Next step:', nextStepConfig.id);
      }
    } finally {
      setIsTransitioning(false);
    }
  }, [currentStepId, isTransitioning, config, saveProgress, debug]);

  // Navigate to previous step
  const previousStep = useCallback(() => {
    if (!currentStepId) return;

    const prevStepConfig = config.getPreviousStep(currentStepId);
    if (!prevStepConfig) return;

    setCurrentStepId(prevStepConfig.id);
    saveProgress(prevStepConfig.id);
    config.getFlow().onStepChange?.(prevStepConfig.id, config.getVisibleStepIndex(prevStepConfig.id));

    if (debug) {
      console.log('[useOnboardingFlow] Previous step:', prevStepConfig.id);
    }
  }, [currentStepId, config, saveProgress, debug]);

  // Go to specific step
  const goToStep = useCallback(async (stepId: string) => {
    if (stepId === currentStepId || isTransitioning) return;

    const step = config.getStep(stepId);
    if (!step) {
      console.error(`Step not found: ${stepId}`);
      return;
    }

    setIsTransitioning(true);
    try {
      if (currentStepId) {
        await config.onStepExit(currentStepId);
      }

      await config.onStepEnter(stepId);
      setCurrentStepId(stepId);
      await saveProgress(stepId);
      config.getFlow().onStepChange?.(stepId, config.getVisibleStepIndex(stepId));

      if (debug) {
        console.log('[useOnboardingFlow] Go to step:', stepId);
      }
    } finally {
      setIsTransitioning(false);
    }
  }, [currentStepId, isTransitioning, config, saveProgress, debug]);

  // Skip current step
  const skipStep = useCallback(async () => {
    if (!currentStepId || !config.isStepSkippable(currentStepId)) return;

    if (debug) {
      console.log('[useOnboardingFlow] Skip step:', currentStepId);
    }

    await nextStep();
  }, [currentStepId, config, nextStep, debug]);

  // Skip entire onboarding
  const skipOnboarding = useCallback(async () => {
    if (currentStepId) {
      await config.onStepExit(currentStepId);
    }

    storage.markCompleted(storageKey);
    config.getFlow().onSkip?.();

    setIsCompleted(true);
    setIsVisible(false);
    setCurrentStepId(null);

    if (debug) {
      console.log('[useOnboardingFlow] Skip onboarding');
    }
  }, [currentStepId, config, storage, storageKey, debug]);

  // Complete onboarding
  const completeOnboarding = useCallback(async () => {
    if (currentStepId) {
      await config.onStepExit(currentStepId);
    }

    storage.markCompleted(storageKey);
    config.getFlow().onComplete?.();

    setIsCompleted(true);
    setIsVisible(false);
    setCurrentStepId(null);

    if (debug) {
      console.log('[useOnboardingFlow] Complete onboarding');
    }
  }, [currentStepId, config, storage, storageKey, debug]);

  // Start onboarding (reset and show)
  const startOnboarding = useCallback(() => {
    storage.reset(storageKey);
    config.invalidateCache();
    setIsCompleted(false);
    setCurrentStepId(visibleSteps[0]?.id || null);
    setIsVisible(true);

    if (debug) {
      console.log('[useOnboardingFlow] Start onboarding');
    }
  }, [config, storage, storageKey, visibleSteps, debug]);

  // Close onboarding (hide but don't mark complete)
  const closeOnboarding = useCallback(() => {
    setIsVisible(false);

    if (debug) {
      console.log('[useOnboardingFlow] Close onboarding');
    }
  }, [debug]);

  // Reset onboarding
  const resetOnboarding = useCallback(() => {
    storage.reset(storageKey);
    setIsCompleted(false);
    setIsVisible(false);
    setCurrentStepId(null);

    if (debug) {
      console.log('[useOnboardingFlow] Reset onboarding');
    }
  }, [config, storage, storageKey, debug]);

  return {
    isVisible,
    isCompleted,
    currentStep,
    currentStepIndex,
    progress,
    stepCount: visibleSteps.length,
    nextStep,
    previousStep,
    goToStep,
    skipStep,
    skipOnboarding,
    startOnboarding,
    closeOnboarding,
    resetOnboarding,
    completeOnboarding,
    canGoBack,
    canGoForward,
    isFirstStep,
    isLastStep,
  };
}
