// OnboardingModal — multi-step wizard shown to first-time dashboard users.
// State is persisted in localStorage so the modal never re-appears after
// the user completes or explicitly dismisses it.
//
// Steps:
//   1. Welcome  — what Stellar_Card is in one sentence
//   2. Add funds — how to top up a wallet
//   3. Create agent — how to issue a virtual card
//   4. Ready  — link to docs, mark done
//
// Features:
//   - Animated step transitions with fade + slide
//   - Progress dots for visual step tracking
//   - Keyboard navigation (Escape to close, Arrow keys to navigate)
//   - Accessible with proper ARIA attributes

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

export const STORAGE_KEY = 'sc_onboarding_done';
export const TOTAL_STEPS = 4;

export interface StepProps {
  onNext: () => void;
  onSkip: () => void;
}

// ── Step Components ──────────────────────────────────────────────────

export function Step1Welcome({ onNext, onSkip }: StepProps) {
  return (
    <div className="onboarding-step" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>👋</div>
      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--fg)' }}>
        Welcome to Stellar_Card
      </h2>
      <p style={{ margin: '0.6rem 0 0', fontSize: '0.82rem', color: 'var(--fg-dim)', lineHeight: 1.6, maxWidth: 340 }}>
        Issue virtual Visa cards for your AI agents in about 60 seconds. Pay in USDC or XLM on
        Stellar — get a real card number back instantly.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
        <button onClick={onNext} style={primaryBtn} autoFocus>Get started →</button>
        <button onClick={onSkip} style={ghostBtn}>Skip tour</button>
      </div>
    </div>
  );
}

export function Step2Funds({ onNext, onSkip }: StepProps) {
  return (
    <div className="onboarding-step" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
      <div style={stepIcon}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      </div>
      <h2 style={heading}>Add funds to an agent wallet</h2>
      <p style={body}>
        Each agent has its own Stellar wallet. Send USDC or XLM to the wallet address shown on the
        agent detail page. Funds arrive in seconds on Stellar mainnet.
      </p>
      <ol style={{ margin: '0.75rem 0 0', padding: '0 0 0 1.25rem', fontSize: '0.78rem', color: 'var(--fg-dim)', lineHeight: 1.8 }}>
        <li>Go to <strong style={{ color: 'var(--fg)' }}>Agents</strong> in the sidebar</li>
        <li>Open an agent and copy its wallet address</li>
        <li>Send USDC or XLM from any Stellar wallet</li>
      </ol>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
        <button onClick={onNext} style={primaryBtn} autoFocus>Next →</button>
        <button onClick={onSkip} style={ghostBtn}>Skip tour</button>
      </div>
    </div>
  );
}

export function Step3Agent({ onNext, onSkip }: StepProps) {
  return (
    <div className="onboarding-step" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
      <div style={stepIcon}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />
        </svg>
      </div>
      <h2 style={heading}>Create your first agent</h2>
      <p style={body}>
        An agent maps to one API key and one wallet. When the agent submits a payment, Stellar_Card
        checks its policy and issues a virtual Visa card for that exact amount.
      </p>
      <ol style={{ margin: '0.75rem 0 0', padding: '0 0 0 1.25rem', fontSize: '0.78rem', color: 'var(--fg-dim)', lineHeight: 1.8 }}>
        <li>Click <strong style={{ color: 'var(--fg)' }}>+ New agent</strong> in the sidebar</li>
        <li>Set a spend limit and label</li>
        <li>Copy the API key and pass it to your agent</li>
      </ol>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
        <button onClick={onNext} style={primaryBtn} autoFocus>Next →</button>
        <button onClick={onSkip} style={ghostBtn}>Skip tour</button>
      </div>
    </div>
  );
}

export function Step4Ready({ onDone }: { onDone: () => void }) {
  return (
    <div className="onboarding-step" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🚀</div>
      <h2 style={heading}>You&apos;re all set</h2>
      <p style={body}>
        Your dashboard is live. Check the docs for SDK usage, webhook setup, and approval flows.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
        <Link href="/docs" style={primaryBtn}>
          Read the docs
        </Link>
        <button onClick={onDone} style={ghostBtn} autoFocus>
          Go to dashboard
        </button>
      </div>
    </div>
  );
}

// ── Step indicator dots ──────────────────────────────────────────────

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center', padding: '0.5rem 0' }}>
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          style={{
            width: currentStep === i + 1 ? 20 : 6,
            height: 6,
            borderRadius: 3,
            background: currentStep === i + 1 ? 'var(--green)' : 'var(--border)',
            transition: 'width 300ms var(--ease-out), background 300ms var(--ease-out)',
          }}
        />
      ))}
    </div>
  );
}

// ── Main Modal Component ─────────────────────────────────────────────

export function OnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(1);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* localStorage blocked (incognito strict mode) — don't show */
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* ignore */ }
    setVisible(false);
  }, []);

  const goToStep = useCallback((nextStep: number) => {
    setIsAnimating(true);
    setTimeout(() => {
      setStep(nextStep);
      setIsAnimating(false);
    }, 150);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dismiss();
      } else if (e.key === 'ArrowRight' && step < TOTAL_STEPS) {
        goToStep(step + 1);
      } else if (e.key === 'ArrowLeft' && step > 1) {
        goToStep(step - 1);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, step, dismiss, goToStep]);

  if (!visible) return null;

  const progress = (step / TOTAL_STEPS) * 100;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          zIndex: 200,
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
        aria-hidden
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Getting started"
        aria-describedby="onboarding-step-content"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201,
          width: 'min(440px, calc(100vw - 2rem))',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-hero)',
          overflow: 'hidden',
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--border)' }}>
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'var(--green)',
              transition: 'width 300ms var(--ease-out)',
            }}
          />
        </div>

        {/* Step counter + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem 0' }}>
          <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', letterSpacing: '0.08em' }}>
            STEP {step} / {TOTAL_STEPS}
          </span>
          <button
            onClick={dismiss}
            aria-label="Close onboarding"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--fg-dim)',
              cursor: 'pointer',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Step indicator dots */}
        <StepIndicator currentStep={step} totalSteps={TOTAL_STEPS} />

        {/* Step content */}
        <div
          id="onboarding-step-content"
          style={{
            padding: '0.5rem 1.25rem 1.5rem',
            opacity: isAnimating ? 0 : 1,
            transform: isAnimating ? 'translateY(8px)' : 'translateY(0)',
            transition: 'opacity 150ms ease-out, transform 150ms ease-out',
          }}
        >
          {step === 1 && <Step1Welcome onNext={() => goToStep(2)} onSkip={dismiss} />}
          {step === 2 && <Step2Funds onNext={() => goToStep(3)} onSkip={dismiss} />}
          {step === 3 && <Step3Agent onNext={() => goToStep(4)} onSkip={dismiss} />}
          {step === 4 && <Step4Ready onDone={dismiss} />}
        </div>

        {/* Keyboard hint */}
        <div style={{ padding: '0 1.25rem 0.75rem', textAlign: 'center' }}>
          <span style={{ fontSize: '0.6rem', color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            ← → navigate • esc close
          </span>
        </div>
      </div>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}

// ── Shared style objects ──────────────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 0.9rem',
  borderRadius: 7,
  background: 'var(--green-muted)',
  color: 'var(--green)',
  border: '1px solid var(--green-border)',
  fontSize: '0.78rem',
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  textDecoration: 'none',
};

const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.5rem 0.9rem',
  borderRadius: 7,
  background: 'transparent',
  color: 'var(--fg-dim)',
  border: '1px solid var(--border)',
  fontSize: '0.78rem',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

const stepIcon: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: 'var(--green-muted)',
  border: '1px solid var(--green-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '0.75rem',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--fg)',
  fontFamily: 'var(--font-body)',
};

const body: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: '0.82rem',
  color: 'var(--fg-dim)',
  lineHeight: 1.6,
  maxWidth: 360,
};
