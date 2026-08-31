import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { OnboardingModal, TOTAL_STEPS } from './OnboardingModal';

const meta = {
  title: 'Components/Onboarding/OnboardingModal',
  component: OnboardingModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Multi-step onboarding modal for first-time dashboard users. Features smooth step transitions, progress tracking, and state persistence.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof OnboardingModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default onboarding modal showing the complete flow
 */
export const Default: Story = {
  render: () => (
    <div style={{ padding: '2rem' }}>
      <OnboardingModal />
      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'var(--blue-muted)',
          borderRadius: '8px',
          color: 'var(--blue)',
          fontSize: '0.85rem',
        }}
      >
        <p style={{ margin: 0 }}>
          💡 <strong>Tip:</strong> This onboarding modal is only shown once per user (stored in
          localStorage as "sc_onboarding_done"). Clear localStorage or use your browser's dev tools
          to test the flow again.
        </p>
      </div>
    </div>
  ),
};

/**
 * Onboarding modal in the context of a dashboard layout
 */
export const InDashboard: Story = {
  render: () => (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Mock Header */}
      <div
        style={{
          height: '64px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 1.5rem',
          background: 'var(--surface)',
        }}
      >
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Stellar Card Dashboard</span>
      </div>

      {/* Mock Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-dim)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
          <p style={{ fontSize: '1rem', margin: 0 }}>Dashboard content area</p>
          <p style={{ fontSize: '0.85rem', margin: '0.5rem 0 0', color: 'var(--fg-dim)' }}>
            The onboarding modal appears on top with a backdrop
          </p>
        </div>
      </div>

      {/* Onboarding Modal */}
      <OnboardingModal />
    </div>
  ),
};

/**
 * Showcase of all onboarding steps with step progression
 */
export const StepProgression: Story = {
  render: () => {
    const StepProgressionDemo = () => {
      const [step, setStep] = useState(1);

      return (
        <div style={{ padding: '2rem' }}>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ margin: '0 0 1rem' }}>Onboarding Steps</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setStep(i + 1)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: step === i + 1 ? '2px solid var(--green)' : '1px solid var(--border)',
                    background: step === i + 1 ? 'var(--green-muted)' : 'transparent',
                    color: step === i + 1 ? 'var(--green)' : 'var(--fg)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  Step {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '2rem',
              background: 'var(--surface)',
              minHeight: '400px',
            }}
          >
            {step === 1 && (
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>👋</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Welcome to Stellar_Card</h3>
                <p style={{ margin: 0, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
                  Issue virtual Visa cards for your AI agents in about 60 seconds. Pay in USDC or
                  XLM on Stellar — get a real card number back instantly.
                </p>
              </div>
            )}

            {step === 2 && (
              <div>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'var(--green-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  💰
                </div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Add funds to an agent wallet</h3>
                <p style={{ margin: '0 0 1rem', color: 'var(--fg-dim)', lineHeight: 1.6 }}>
                  Each agent has its own Stellar wallet. Send USDC or XLM to the wallet address
                  shown on the agent detail page.
                </p>
                <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--fg-dim)', fontSize: '0.9rem' }}>
                  <li>Go to Agents in the sidebar</li>
                  <li>Open an agent and copy its wallet address</li>
                  <li>Send USDC or XLM from any Stellar wallet</li>
                </ol>
              </div>
            )}

            {step === 3 && (
              <div>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'var(--green-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  👤
                </div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Create your first agent</h3>
                <p style={{ margin: '0 0 1rem', color: 'var(--fg-dim)', lineHeight: 1.6 }}>
                  An agent maps to one API key and one wallet. When the agent submits a payment,
                  Stellar_Card checks its policy and issues a virtual Visa card.
                </p>
                <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--fg-dim)', fontSize: '0.9rem' }}>
                  <li>Click + New agent in the sidebar</li>
                  <li>Set a spend limit and label</li>
                  <li>Copy the API key and pass it to your agent</li>
                </ol>
              </div>
            )}

            {step === 4 && (
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🚀</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>You&apos;re all set</h3>
                <p style={{ margin: 0, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
                  Your dashboard is live. Check the docs for SDK usage, webhook setup, and approval
                  flows.
                </p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Progress: {step} / {TOTAL_STEPS}
          </div>
        </div>
      );
    };

    return <StepProgressionDemo />;
  },
};

/**
 * Accessibility features showcase
 */
export const AccessibilityFeatures: Story = {
  render: () => (
    <div style={{ padding: '2rem', maxWidth: '800px' }}>
      <h2 style={{ margin: '0 0 1.5rem' }}>Onboarding Accessibility Features</h2>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div style={{ padding: '1rem', background: 'var(--green-muted)', borderRadius: '8px' }}>
          <h3 style={{ color: 'var(--green)', margin: '0 0 0.5rem' }}>⌨️ Keyboard Navigation</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--green)', fontSize: '0.9rem' }}>
            <li>← Arrow Left: Go to previous step</li>
            <li>→ Arrow Right: Go to next step</li>
            <li>Escape: Close the modal</li>
          </ul>
        </div>

        <div style={{ padding: '1rem', background: 'var(--blue-muted)', borderRadius: '8px' }}>
          <h3 style={{ color: 'var(--blue)', margin: '0 0 0.5rem' }}>♿ ARIA Support</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--blue)', fontSize: '0.9rem' }}>
            <li>role="dialog" and aria-modal="true"</li>
            <li>Proper aria-label for screen readers</li>
            <li>aria-describedby for step content</li>
            <li>Semantic HTML structure</li>
          </ul>
        </div>

        <div style={{ padding: '1rem', background: 'var(--yellow-muted)', borderRadius: '8px' }}>
          <h3 style={{ color: 'var(--yellow)', margin: '0 0 0.5rem' }}>🎨 Visual Indicators</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--yellow)', fontSize: '0.9rem' }}>
            <li>Progress bar showing completion</li>
            <li>Step indicator dots for quick reference</li>
            <li>Keyboard shortcut hints</li>
            <li>Smooth animations for transitions</li>
          </ul>
        </div>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'var(--surface)',
          borderRadius: '8px',
          fontSize: '0.85rem',
          color: 'var(--fg-dim)',
          border: '1px solid var(--border)',
        }}
      >
        <strong>Test Accessibility:</strong> Open DevTools, disable CSS in styles, and use keyboard
        only navigation. The modal should still be fully functional and readable.
      </div>
    </div>
  ),
};

/**
 * Mobile view of onboarding modal
 */
export const MobileView: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'iphone12',
    },
  },
  render: () => (
    <div style={{ width: '100%', height: '100vh', background: 'var(--bg)' }}>
      <OnboardingModal />
    </div>
  ),
};

/**
 * Onboarding with custom styling
 */
export const Customization: Story = {
  render: () => (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ margin: '0 0 1rem' }}>Onboarding Customization Options</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Steps</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Customize the number of steps, titles, descriptions, and content for each step.
          </p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Storage</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Configure storage key, enable debugging, and track onboarding progress across sessions.
          </p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Callbacks</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Hook into onComplete, onSkip, and step change events for custom logic.
          </p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Validation</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Add validation functions to prevent advancing until conditions are met.
          </p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Theming</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Uses design tokens (CSS variables) for consistent styling across the app.
          </p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Persistence</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-dim)' }}>
            Automatic state persistence with localStorage fallback and memory storage.
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'var(--blue-muted)',
          borderRadius: '8px',
          color: 'var(--blue)',
          fontSize: '0.85rem',
        }}
      >
        <p style={{ margin: 0 }}>
          ℹ️ All customization is done through the <code>OnboardingFlowConfig</code> type. See the
          implementation guide for detailed API documentation.
        </p>
      </div>
    </div>
  ),
};

/**
 * Testing onboarding flow states
 */
export const TestingStates: Story = {
  render: () => (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ margin: '0 0 1.5rem' }}>Testing Onboarding States</h2>

      <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
        <div
          style={{
            padding: '1rem',
            background: 'var(--blue-muted)',
            borderRadius: '8px',
            border: '1px solid var(--blue)',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', color: 'var(--blue)', fontSize: '0.95rem' }}>
            Clear Storage
          </h3>
          <code
            style={{
              display: 'block',
              background: 'rgba(0,0,0,0.2)',
              padding: '0.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              margin: '0.5rem 0 0',
              overflow: 'auto',
            }}
          >
            localStorage.removeItem('sc_onboarding_done')
          </code>
        </div>

        <div
          style={{
            padding: '1rem',
            background: 'var(--green-muted)',
            borderRadius: '8px',
            border: '1px solid var(--green)',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', color: 'var(--green)', fontSize: '0.95rem' }}>
            Mark as Completed
          </h3>
          <code
            style={{
              display: 'block',
              background: 'rgba(0,0,0,0.2)',
              padding: '0.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              margin: '0.5rem 0 0',
              overflow: 'auto',
            }}
          >
            localStorage.setItem('sc_onboarding_done', '1')
          </code>
        </div>

        <div
          style={{
            padding: '1rem',
            background: 'var(--yellow-muted)',
            borderRadius: '8px',
            border: '1px solid var(--yellow)',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', color: 'var(--yellow)', fontSize: '0.95rem' }}>
            View All Storage
          </h3>
          <code
            style={{
              display: 'block',
              background: 'rgba(0,0,0,0.2)',
              padding: '0.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              margin: '0.5rem 0 0',
              overflow: 'auto',
            }}
          >
            console.log(localStorage)
          </code>
        </div>
      </div>

      <div
        style={{
          padding: '1rem',
          background: 'var(--surface)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          fontSize: '0.85rem',
          color: 'var(--fg-dim)',
        }}
      >
        <p style={{ margin: 0 }}>
          💡 Use your browser's DevTools to manipulate localStorage and test different onboarding
          states.
        </p>
      </div>
    </div>
  ),
};
