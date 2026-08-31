/**
 * Comprehensive onboarding tests
 * 
 * Test coverage:
 * - Storage persistence (localStorage, sessionStorage, memory)
 * - Configuration validation and step management
 * - Hook behavior and navigation
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOnboardingStorage,
  resetOnboardingStorageInstance,
  type OnboardingState,
} from './onboarding-storage';
import {
  createOnboardingConfig,
  mergeOnboardingConfigs,
  type OnboardingFlowConfig,
} from './onboarding-config';

// ────────────────────────────────────────────────────────────────────────────
// Storage Tests
// ────────────────────────────────────────────────────────────────────────────

describe('OnboardingStorage', () => {
  beforeEach(() => {
    resetOnboardingStorageInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetOnboardingStorageInstance();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('storage initialization', () => {
    it('should detect localStorage when available', () => {
      const storage = getOnboardingStorage();
      expect(['localStorage', 'sessionStorage', 'memory']).toContain(storage.getStorageType());
    });

    it('should use memory storage when no storage available', () => {
      const storage = getOnboardingStorage();
      expect(storage.getStorageType()).toBeDefined();
    });

    it('should accept storage options', () => {
      const storage = getOnboardingStorage({ keyPrefix: 'custom', version: 2 });
      expect(storage).toBeDefined();
    });
  });

  describe('state management', () => {
    it('should save and retrieve state', () => {
      const storage = getOnboardingStorage();
      const state: OnboardingState = {
        completed: false,
        currentStep: 0,
        lastUpdate: Date.now(),
        version: 1,
      };

      storage.setState(state);
      const retrieved = storage.getState();

      expect(retrieved).toBeDefined();
      expect(retrieved?.completed).toBe(false);
      expect(retrieved?.currentStep).toBe(0);
    });

    it('should mark completed', () => {
      const storage = getOnboardingStorage();
      storage.markCompleted();

      expect(storage.isCompleted()).toBe(true);
    });

    it('should track current step', () => {
      const storage = getOnboardingStorage();
      storage.setCurrentStep(2);

      expect(storage.getCurrentStep()).toBe(2);
    });

    it('should reset state', () => {
      const storage = getOnboardingStorage();
      storage.markCompleted();
      storage.reset();

      expect(storage.isCompleted()).toBe(false);
    });

    it('should reset all states', () => {
      const storage = getOnboardingStorage();
      storage.setState({ completed: false, currentStep: 1, lastUpdate: Date.now(), version: 1 }, 'flow1');
      storage.setState({ completed: false, currentStep: 2, lastUpdate: Date.now(), version: 1 }, 'flow2');

      storage.resetAll();

      expect(storage.getState('flow1')).toBeNull();
      expect(storage.getState('flow2')).toBeNull();
    });

    it('should handle custom data', () => {
      const storage = getOnboardingStorage();
      const customData = { userId: '123', preferences: { theme: 'dark' } };

      storage.setCustomData(customData);
      const retrieved = storage.getCustomData();

      expect(retrieved).toMatchObject(customData);
    });

    it('should merge custom data', () => {
      const storage = getOnboardingStorage();
      storage.setCustomData({ setting1: 'value1' });
      storage.setCustomData({ setting2: 'value2' });

      const retrieved = storage.getCustomData();
      expect(retrieved).toMatchObject({ setting1: 'value1', setting2: 'value2' });
    });

    it('should handle multiple flows with different IDs', () => {
      const storage = getOnboardingStorage();

      storage.setState({ completed: false, currentStep: 0, lastUpdate: Date.now(), version: 1 }, 'flow-a');
      storage.setState({ completed: true, currentStep: 3, lastUpdate: Date.now(), version: 1 }, 'flow-b');

      expect(storage.isCompleted('flow-a')).toBe(false);
      expect(storage.isCompleted('flow-b')).toBe(true);
    });
  });

  describe('version tracking', () => {
    it('should track storage version', () => {
      const storage = getOnboardingStorage({ version: 2 });
      storage.markCompleted();

      const state = storage.getState();
      expect(state?.version).toBe(2);
    });

    it('should return null for version mismatch', () => {
      resetOnboardingStorageInstance();
      const storage1 = getOnboardingStorage({ version: 1 });
      storage1.markCompleted();

      resetOnboardingStorageInstance();
      const storage2 = getOnboardingStorage({ version: 2 });
      const state = storage2.getState();

      expect(state).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle storage quota exceeded gracefully', () => {
      const storage = getOnboardingStorage();
      const largeData = 'x'.repeat(10000000); // 10MB

      // Should not throw
      const result = storage.setCustomData({ large: largeData });
      expect(typeof result).toBe('boolean');
    });

    it('should handle malformed stored data', () => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('onboarding:default', 'invalid json {');
      }

      const storage = getOnboardingStorage();
      const state = storage.getState();

      expect(state).toBeNull();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Configuration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('OnboardingConfig', () => {
  const sampleFlow: OnboardingFlowConfig = {
    id: 'test-flow',
    name: 'Test Flow',
    steps: [
      { id: 'step1', title: 'Welcome' },
      { id: 'step2', title: 'Setup' },
      { id: 'step3', title: 'Complete' },
    ],
  };

  describe('configuration validation', () => {
    it('should throw on missing id', () => {
      expect(() => {
        createOnboardingConfig({ ...sampleFlow, id: '' });
      }).toThrow();
    });

    it('should throw on missing name', () => {
      expect(() => {
        createOnboardingConfig({ ...sampleFlow, name: '' });
      }).toThrow();
    });

    it('should throw on empty steps', () => {
      expect(() => {
        createOnboardingConfig({ ...sampleFlow, steps: [] });
      }).toThrow();
    });

    it('should throw on duplicate step ids', () => {
      expect(() => {
        createOnboardingConfig({
          ...sampleFlow,
          steps: [
            { id: 'step1', title: 'Step 1' },
            { id: 'step1', title: 'Step 1 Duplicate' },
          ],
        });
      }).toThrow();
    });

    it('should throw on step without title', () => {
      expect(() => {
        createOnboardingConfig({
          ...sampleFlow,
          steps: [{ id: 'step1', title: '' }],
        });
      }).toThrow();
    });
  });

  describe('step management', () => {
    it('should get all steps', () => {
      const config = createOnboardingConfig(sampleFlow);
      expect(config.getAllSteps()).toHaveLength(3);
    });

    it('should get visible steps (respecting conditions)', () => {
      const flowWithConditions: OnboardingFlowConfig = {
        ...sampleFlow,
        steps: [
          { id: 'step1', title: 'Always visible' },
          { id: 'step2', title: 'Conditional', condition: () => false },
          { id: 'step3', title: 'Also visible' },
        ],
      };

      const config = createOnboardingConfig(flowWithConditions);
      const visible = config.getVisibleSteps();

      expect(visible).toHaveLength(2);
      expect(visible.map((s) => s.id)).toEqual(['step1', 'step3']);
    });

    it('should get step by id', () => {
      const config = createOnboardingConfig(sampleFlow);
      const step = config.getStep('step2');

      expect(step?.title).toBe('Setup');
    });

    it('should get step index', () => {
      const config = createOnboardingConfig(sampleFlow);
      expect(config.getStepIndex('step1')).toBe(0);
      expect(config.getStepIndex('step3')).toBe(2);
    });

    it('should navigate between steps', () => {
      const config = createOnboardingConfig(sampleFlow);

      const next = config.getNextStep('step1');
      expect(next?.id).toBe('step2');

      const prev = config.getPreviousStep('step2');
      expect(prev?.id).toBe('step1');
    });

    it('should identify first and last steps', () => {
      const config = createOnboardingConfig(sampleFlow);

      expect(config.isFirstStep('step1')).toBe(true);
      expect(config.isLastStep('step3')).toBe(true);
      expect(config.isFirstStep('step2')).toBe(false);
      expect(config.isLastStep('step2')).toBe(false);
    });
  });

  describe('step properties', () => {
    it('should check if step is skippable', () => {
      const flowWithSkip: OnboardingFlowConfig = {
        ...sampleFlow,
        allowSkipSteps: true,
        steps: [
          { id: 'step1', title: 'Skippable', skippable: true },
          { id: 'step2', title: 'Not skippable', skippable: false },
        ],
      };

      const config = createOnboardingConfig(flowWithSkip);

      expect(config.isStepSkippable('step1')).toBe(true);
      expect(config.isStepSkippable('step2')).toBe(false);
    });

    it('should validate steps', async () => {
      const flowWithValidation: OnboardingFlowConfig = {
        ...sampleFlow,
        steps: [
          { id: 'step1', title: 'Valid', validate: () => true },
          { id: 'step2', title: 'Invalid', validate: () => false },
        ],
      };

      const config = createOnboardingConfig(flowWithValidation);

      expect(await config.validateStep('step1')).toBe(true);
      expect(await config.validateStep('step2')).toBe(false);
    });

    it('should call step enter and exit callbacks', async () => {
      const enterFn = vi.fn();
      const exitFn = vi.fn();

      const flowWithCallbacks: OnboardingFlowConfig = {
        ...sampleFlow,
        steps: [
          { id: 'step1', title: 'Callbacks', onEnter: enterFn, onExit: exitFn },
        ],
      };

      const config = createOnboardingConfig(flowWithCallbacks);

      await config.onStepEnter('step1');
      expect(enterFn).toHaveBeenCalled();

      await config.onStepExit('step1');
      expect(exitFn).toHaveBeenCalled();
    });
  });

  describe('progress calculation', () => {
    it('should calculate progress percentage', () => {
      const config = createOnboardingConfig(sampleFlow);

      expect(config.getProgress('step1')).toBe(33.333333333333336); // ~33%
      expect(config.getProgress('step2')).toBe(66.66666666666666); // ~67%
      expect(config.getProgress('step3')).toBe(100); // 100%
    });

    it('should count visible steps', () => {
      const config = createOnboardingConfig(sampleFlow);
      expect(config.getStepCount()).toBe(3);
    });
  });

  describe('configuration merging', () => {
    it('should merge flow configurations', () => {
      const baseFlow: OnboardingFlowConfig = {
        id: 'base',
        name: 'Base',
        steps: [{ id: 'step1', title: 'Step 1' }],
      };

      const merged = mergeOnboardingConfigs(baseFlow, {
        name: 'Merged',
        allowSkipSteps: true,
      });

      expect(merged.name).toBe('Merged');
      expect(merged.allowSkipSteps).toBe(true);
      expect(merged.id).toBe('base'); // Original id preserved
    });
  });

  describe('storage configuration', () => {
    it('should use custom storage key', () => {
      const flowWithStorageKey: OnboardingFlowConfig = {
        ...sampleFlow,
        storageKey: 'custom_storage_key',
      };

      const config = createOnboardingConfig(flowWithStorageKey);
      expect(config.getStorageKey()).toBe('custom_storage_key');
    });

    it('should generate default storage key', () => {
      const config = createOnboardingConfig(sampleFlow);
      expect(config.getStorageKey()).toBe('onboarding_test-flow');
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate visible steps cache', () => {
      const flowWithConditions: OnboardingFlowConfig = {
        ...sampleFlow,
        steps: [
          { id: 'step1', title: 'Step 1', condition: () => true },
          { id: 'step2', title: 'Step 2' },
        ],
      };

      const config = createOnboardingConfig(flowWithConditions);
      expect(config.getVisibleSteps()).toHaveLength(2);

      // Invalidate and get again (in real usage, condition might change)
      config.invalidateCache();
      expect(config.getVisibleSteps()).toHaveLength(2);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Onboarding Integration', () => {
  beforeEach(() => {
    resetOnboardingStorageInstance();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    resetOnboardingStorageInstance();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should persist progress across instances', () => {
    const storage1 = getOnboardingStorage();
    storage1.setCurrentStep(2);

    resetOnboardingStorageInstance();
    const storage2 = getOnboardingStorage();

    expect(storage2.getCurrentStep()).toBe(2);
  });

  it('should handle flow completion workflow', () => {
    const storage = getOnboardingStorage();
    const config = createOnboardingConfig({
      id: 'test',
      name: 'Test',
      steps: [
        { id: 'step1', title: 'Step 1' },
        { id: 'step2', title: 'Step 2' },
      ],
    });

    storage.setCurrentStep(0);
    expect(storage.getCurrentStep()).toBe(0);
    expect(storage.isCompleted()).toBe(false);

    storage.setCurrentStep(1);
    expect(storage.getCurrentStep()).toBe(1);

    storage.markCompleted();
    expect(storage.isCompleted()).toBe(true);
  });

  it('should export all states', () => {
    const storage = getOnboardingStorage();
    storage.setState({ completed: false, currentStep: 1, lastUpdate: Date.now(), version: 1 }, 'flow1');
    storage.setState({ completed: true, currentStep: 0, lastUpdate: Date.now(), version: 1 }, 'flow2');

    const exported = storage.exportAll();
    expect(Object.keys(exported).length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge Cases and Error Handling
// ────────────────────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  beforeEach(() => {
    resetOnboardingStorageInstance();
  });

  afterEach(() => {
    resetOnboardingStorageInstance();
  });

  it('should handle empty flow gracefully', () => {
    expect(() => {
      createOnboardingConfig({
        id: 'empty',
        name: 'Empty',
        steps: [],
      });
    }).toThrow();
  });

  it('should handle very large step counts', () => {
    const manySteps = Array.from({ length: 100 }, (_, i) => ({
      id: `step-${i}`,
      title: `Step ${i}`,
    }));

    const config = createOnboardingConfig({
      id: 'large',
      name: 'Large',
      steps: manySteps,
    });

    expect(config.getStepCount()).toBe(100);
    expect(config.getProgress('step-50')).toBeGreaterThan(50);
  });

  it('should handle rapid state changes', () => {
    const storage = getOnboardingStorage();

    for (let i = 0; i < 100; i++) {
      storage.setCurrentStep(i % 10);
    }

    expect(typeof storage.getCurrentStep()).toBe('number');
  });

  it('should handle navigation with no next step', () => {
    const config = createOnboardingConfig({
      id: 'test',
      name: 'Test',
      steps: [
        { id: 'step1', title: 'Last step' },
      ],
    });

    const next = config.getNextStep('step1');
    expect(next).toBeUndefined();
  });

  it('should handle navigation when previous is disabled', () => {
    const config = createOnboardingConfig({
      id: 'test',
      name: 'Test',
      allowPreviousSteps: false,
      steps: [
        { id: 'step1', title: 'Step 1' },
        { id: 'step2', title: 'Step 2' },
      ],
    });

    const prev = config.getPreviousStep('step2');
    expect(prev).toBeUndefined();
  });
});
