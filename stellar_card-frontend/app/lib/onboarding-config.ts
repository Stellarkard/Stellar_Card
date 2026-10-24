/**
 * Onboarding Configuration System
 * 
 * Provides a flexible way to configure onboarding flows with:
 * - Customizable steps
 * - Conditional step display
 * - Custom callbacks
 * - Step metadata and validation
 */

import type { ReactNode } from 'react';

export interface OnboardingStepConfig {
  /** Unique step identifier */
  id: string;
  /** Step title */
  title: string;
  /** Step description */
  description?: string;
  /** Step content (React component or HTML) */
  content?: ReactNode;
  /** Optional icon/emoji */
  icon?: string;
  /** Whether this step can be skipped */
  skippable?: boolean;
  /** Condition to show this step (function returning boolean) */
  condition?: () => boolean;
  /** Validation function before moving to next step */
  validate?: () => boolean | Promise<boolean>;
  /** Callback when entering this step */
  onEnter?: () => void | Promise<void>;
  /** Callback when exiting this step */
  onExit?: () => void | Promise<void>;
  /** Custom action button */
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
  /** Step metadata */
  metadata?: Record<string, unknown>;
}

export interface OnboardingFlowConfig {
  /** Flow identifier */
  id: string;
  /** Flow name */
  name: string;
  /** Flow description */
  description?: string;
  /** All available steps */
  steps: OnboardingStepConfig[];
  /** Callback when flow is completed */
  onComplete?: () => void | Promise<void>;
  /** Callback when flow is skipped */
  onSkip?: () => void | Promise<void>;
  /** Callback on each step change */
  onStepChange?: (stepId: string, stepIndex: number) => void;
  /** Storage key for this flow */
  storageKey?: string;
  /** Allow skipping individual steps */
  allowSkipSteps?: boolean;
  /** Allow going back to previous steps */
  allowPreviousSteps?: boolean;
  /** Auto-advance to next step after duration (ms) */
  autoAdvanceDuration?: number;
  /** Flow metadata */
  metadata?: Record<string, unknown>;
}

/**
 * OnboardingConfig class for managing onboarding flow configuration
 */
export class OnboardingConfig {
  private flow: OnboardingFlowConfig;
  private visibleSteps: OnboardingStepConfig[] | null = null;

  constructor(flow: OnboardingFlowConfig) {
    this.validate(flow);
    this.flow = flow;
  }

  /**
   * Validate flow configuration
   */
  private validate(flow: OnboardingFlowConfig): void {
    if (!flow.id || typeof flow.id !== 'string') {
      throw new Error('OnboardingFlowConfig must have a non-empty id');
    }

    if (!flow.name || typeof flow.name !== 'string') {
      throw new Error('OnboardingFlowConfig must have a non-empty name');
    }

    if (!flow.steps || !Array.isArray(flow.steps) || flow.steps.length === 0) {
      throw new Error('OnboardingFlowConfig must have at least one step');
    }

    const stepIds = new Set<string>();
    for (const step of flow.steps) {
      if (!step.id || typeof step.id !== 'string') {
        throw new Error('Each OnboardingStepConfig must have a non-empty id');
      }
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step id: ${step.id}`);
      }
      stepIds.add(step.id);

      if (!step.title || typeof step.title !== 'string') {
        throw new Error(`Step ${step.id} must have a non-empty title`);
      }
    }
  }

  /**
   * Get the flow configuration
   */
  public getFlow(): OnboardingFlowConfig {
    return this.flow;
  }

  /**
   * Get all steps (including those hidden by conditions)
   */
  public getAllSteps(): OnboardingStepConfig[] {
    return this.flow.steps;
  }

  /**
   * Get only visible steps (respecting conditions)
   */
  public getVisibleSteps(): OnboardingStepConfig[] {
    if (this.visibleSteps) {
      return this.visibleSteps;
    }

    this.visibleSteps = this.flow.steps.filter((step) => {
      if (step.condition) {
        return step.condition();
      }
      return true;
    });

    return this.visibleSteps;
  }

  /**
   * Invalidate visible steps cache (call when conditions change)
   */
  public invalidateCache(): void {
    this.visibleSteps = null;
  }

  /**
   * Get step by id
   */
  public getStep(id: string): OnboardingStepConfig | undefined {
    return this.flow.steps.find((step) => step.id === id);
  }

  /**
   * Get step index among all steps
   */
  public getStepIndex(id: string): number {
    return this.flow.steps.findIndex((step) => step.id === id);
  }

  /**
   * Get step index among visible steps
   */
  public getVisibleStepIndex(id: string): number {
    return this.getVisibleSteps().findIndex((step) => step.id === id);
  }

  /**
   * Get next step
   */
  public getNextStep(currentId: string): OnboardingStepConfig | undefined {
    const visibleSteps = this.getVisibleSteps();
    const currentIndex = visibleSteps.findIndex((step) => step.id === currentId);
    if (currentIndex === -1 || currentIndex === visibleSteps.length - 1) {
      return undefined;
    }
    return visibleSteps[currentIndex + 1];
  }

  /**
   * Get previous step
   */
  public getPreviousStep(currentId: string): OnboardingStepConfig | undefined {
    if (!this.flow.allowPreviousSteps) {
      return undefined;
    }

    const visibleSteps = this.getVisibleSteps();
    const currentIndex = visibleSteps.findIndex((step) => step.id === currentId);
    if (currentIndex <= 0) {
      return undefined;
    }
    return visibleSteps[currentIndex - 1];
  }

  /**
   * Check if step is skippable
   */
  public isStepSkippable(id: string): boolean {
    const step = this.getStep(id);
    if (!step) return false;

    const defaultSkippable = this.flow.allowSkipSteps !== false;
    return step.skippable !== false && defaultSkippable;
  }

  /**
   * Validate step before proceeding
   */
  public async validateStep(id: string): Promise<boolean> {
    const step = this.getStep(id);
    if (!step) return false;

    if (step.validate) {
      return step.validate();
    }
    return true;
  }

  /**
   * Call step enter callback
   */
  public async onStepEnter(id: string): Promise<void> {
    const step = this.getStep(id);
    if (step?.onEnter) {
      return step.onEnter();
    }
  }

  /**
   * Call step exit callback
   */
  public async onStepExit(id: string): Promise<void> {
    const step = this.getStep(id);
    if (step?.onExit) {
      return step.onExit();
    }
  }

  /**
   * Check if this is the last step
   */
  public isLastStep(id: string): boolean {
    const visibleSteps = this.getVisibleSteps();
    return visibleSteps[visibleSteps.length - 1]?.id === id;
  }

  /**
   * Check if this is the first step
   */
  public isFirstStep(id: string): boolean {
    const visibleSteps = this.getVisibleSteps();
    return visibleSteps[0]?.id === id;
  }

  /**
   * Get storage key
   */
  public getStorageKey(): string {
    return this.flow.storageKey || `onboarding_${this.flow.id}`;
  }

  /**
   * Get progress percentage
   */
  public getProgress(currentId: string): number {
    const visibleSteps = this.getVisibleSteps();
    if (visibleSteps.length === 0) return 0;

    const currentIndex = visibleSteps.findIndex((step) => step.id === currentId);
    if (currentIndex === -1) return 0;

    return ((currentIndex + 1) / visibleSteps.length) * 100;
  }

  /**
   * Get step count
   */
  public getStepCount(): number {
    return this.getVisibleSteps().length;
  }

  /**
   * Export configuration as JSON
   */
  public toJSON(): OnboardingFlowConfig {
    return this.flow;
  }
}

/**
 * Create an onboarding configuration
 */
export function createOnboardingConfig(flow: OnboardingFlowConfig): OnboardingConfig {
  return new OnboardingConfig(flow);
}

/**
 * Merge multiple onboarding configurations
 */
export function mergeOnboardingConfigs(
  baseFlow: OnboardingFlowConfig,
  override: Partial<OnboardingFlowConfig>
): OnboardingFlowConfig {
  return {
    ...baseFlow,
    ...override,
    steps: override.steps || baseFlow.steps,
    metadata: {
      ...baseFlow.metadata,
      ...override.metadata,
    },
  };
}
