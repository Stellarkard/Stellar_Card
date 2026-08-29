'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface OnboardingStep {
  id: string;
  title: string;
  description?: string;
  content?: ReactNode;
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
  skip?: boolean;
}

interface OnboardingContextType {
  steps: OnboardingStep[];
  currentStepIndex: number;
  isOpen: boolean;
  isCompleted: boolean;
  currentStep: OnboardingStep | null;
  nextStep: () => void;
  previousStep: () => void;
  skipOnboarding: () => void;
  completeOnboarding: () => void;
  startOnboarding: () => void;
  closeOnboarding: () => void;
  goToStep: (index: number) => void;
  progress: number;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);

interface OnboardingProviderProps {
  steps: OnboardingStep[];
  children: ReactNode;
  onComplete?: () => void;
  onSkip?: () => void;
  storageKey?: string;
}

export function OnboardingProvider({
  steps,
  children,
  onComplete,
  onSkip,
  storageKey = 'onboarding-completed',
}: OnboardingProviderProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const completed = localStorage.getItem(storageKey);
      if (completed) {
        setIsCompleted(true);
      } else {
        setIsOpen(true);
      }
    }
  }, [storageKey]);

  const currentStep = steps[currentStepIndex] || null;
  const progress = currentStep ? ((currentStepIndex + 1) / steps.length) * 100 : 0;

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      completeOnboarding();
    }
  }, [currentStepIndex, steps.length]);

  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  }, [currentStepIndex]);

  const completeOnboarding = useCallback(() => {
    setIsCompleted(true);
    setIsOpen(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, 'true');
    }
    onComplete?.();
  }, [storageKey, onComplete]);

  const skipOnboarding = useCallback(() => {
    completeOnboarding();
    onSkip?.();
  }, [completeOnboarding, onSkip]);

  const startOnboarding = useCallback(() => {
    setIsOpen(true);
    setCurrentStepIndex(0);
    setIsCompleted(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  const closeOnboarding = useCallback(() => {
    setIsOpen(false);
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < steps.length) {
      setCurrentStepIndex(index);
    }
  }, [steps.length]);

  return (
    <OnboardingContext.Provider
      value={{
        steps,
        currentStepIndex,
        isOpen,
        isCompleted,
        currentStep,
        nextStep,
        previousStep,
        skipOnboarding,
        completeOnboarding,
        startOnboarding,
        closeOnboarding,
        goToStep,
        progress,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextType {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used inside OnboardingProvider');
  }
  return context;
}

interface OnboardingModalProps {
  showProgress?: boolean;
  showSkip?: boolean;
}

export function OnboardingModal({ showProgress = true, showSkip = true }: OnboardingModalProps) {
  const {
    isOpen,
    currentStep,
    currentStepIndex,
    steps,
    nextStep,
    previousStep,
    skipOnboarding,
    progress,
  } = useOnboarding();

  if (!isOpen || !currentStep) return null;

  return (
    <>
      <div
        className="onboarding-overlay"
        onClick={skipOnboarding}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 999,
        }}
      />
      <div
        className="onboarding-modal"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {showProgress && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                height: '4px',
                background: 'var(--border)',
                borderRadius: '2px',
                overflow: 'hidden',
                marginBottom: '0.5rem',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'var(--green)',
                  width: `${progress}%`,
                  transition: 'width 0.3s var(--ease-out)',
                }}
              />
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--fg-dim)',
                textAlign: 'right',
              }}
            >
              Step {currentStepIndex + 1} of {steps.length}
            </div>
          </div>
        )}

        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: 600,
            marginBottom: '0.5rem',
            color: 'var(--fg)',
          }}
        >
          {currentStep.title}
        </h2>

        {currentStep.description && (
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--fg-dim)',
              marginBottom: '1rem',
              lineHeight: 1.5,
            }}
          >
            {currentStep.description}
          </p>
        )}

        {currentStep.content && <div style={{ marginBottom: '1.5rem' }}>{currentStep.content}</div>}

        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
          }}
        >
          {showSkip && (
            <button
              onClick={skipOnboarding}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              Skip
            </button>
          )}

          {currentStepIndex > 0 && (
            <button
              onClick={previousStep}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--fg)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              Previous
            </button>
          )}

          <button
            onClick={nextStep}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--green)',
              border: 'none',
              borderRadius: '6px',
              color: 'var(--bg)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {currentStepIndex === steps.length - 1 ? 'Complete' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}

interface OnboardingTooltipProps {
  stepId: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function OnboardingTooltip({ stepId, children, position = 'bottom' }: OnboardingTooltipProps) {
  const { currentStep } = useOnboarding();

  if (!currentStep || currentStep.id !== stepId) {
    return <>{children}</>;
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      <div
        className="onboarding-tooltip"
        style={{
          position: 'absolute',
          [position]: 'calc(100% + 8px)',
          background: 'var(--green)',
          color: 'var(--bg)',
          padding: '0.5rem 0.75rem',
          borderRadius: '6px',
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
          zIndex: 1001,
        }}
      >
        {currentStep.description}
      </div>
    </div>
  );
}
