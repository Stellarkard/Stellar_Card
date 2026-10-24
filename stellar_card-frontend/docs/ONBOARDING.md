# Onboarding Flow Documentation

Guide to implementing and customizing the first-run onboarding experience in Stellar_Card frontend.

## Overview

The onboarding system provides a persistent, step-based introduction for new users. State is stored in localStorage, allowing users to pause and resume the flow across sessions.

## Architecture

```
app/
  lib/
    onboarding.ts              # State management
    onboarding.test.ts         # Unit tests
  components/
    OnboardingFlow.tsx         # React components
    OnboardingFlow.stories.tsx # Storybook stories
```

## Core Concepts

### State Persistence

Onboarding state is stored in localStorage under `stellar_card_onboarding`:

```typescript
interface OnboardingState {
  started: boolean;
  currentStep: number;
  steps: OnboardingStep[];
  completed: boolean;
  skipped: boolean;
  lastUpdated: number;
}
```

### Default Steps

Four default steps guide users through initial setup:

1. **Welcome** - Introduction to Stellar_Card
2. **Create Agent** - Set up first API key
3. **Configure Wallet** - Link Stellar wallet
4. **Test Order** - Create test order

## Quick Start

### Basic Implementation

```tsx
import { OnboardingProvider, OnboardingModal } from '@/app/components/OnboardingFlow';

function App() {
  return (
    <OnboardingProvider
      steps={[
        {
          id: 'welcome',
          title: 'Welcome to Stellar_Card',
          description: 'Get started with virtual card management',
        },
        {
          id: 'setup',
          title: 'Initial Setup',
          description: 'Configure your account',
        },
      ]}
      onComplete={() => console.log('Onboarding complete')}
      onSkip={() => console.log('Onboarding skipped')}
    >
      <OnboardingModal />
      <YourApp />
    </OnboardingProvider>
  );
}
```

### Dashboard Integration

```tsx
// app/dashboard/layout.tsx
import { OnboardingProvider, OnboardingModal } from '@/app/components/OnboardingFlow';
import { shouldShowOnboarding } from '@/app/lib/onboarding';

export default function DashboardLayout({ children }) {
  return (
    <OnboardingProvider
      steps={DASHBOARD_STEPS}
      onComplete={() => {
        // Track completion
        analytics.track('onboarding_completed');
      }}
    >
      {shouldShowOnboarding() && <OnboardingModal />}
      {children}
    </OnboardingProvider>
  );
}
```

## API Reference

### State Management Functions

#### getOnboardingState()

Retrieves current onboarding state from localStorage.

```typescript
const state = getOnboardingState();
if (state) {
  console.log(`Step ${state.currentStep + 1}/${state.steps.length}`);
}
```

#### initializeOnboarding()

Creates new onboarding state with default steps.

```typescript
const state = initializeOnboarding();
// Returns initialized OnboardingState
```

#### completeStep(stepId: string)

Marks a specific step as completed and advances to next.

```typescript
completeStep('welcome');
// Auto-advances to next incomplete step
```

#### nextStep()

Advances to the next step in the flow.

```typescript
const state = nextStep();
console.log(`Now on step ${state.currentStep}`);
```

#### previousStep()

Returns to the previous step.

```typescript
const state = previousStep();
```

#### skipOnboarding()

Marks entire flow as skipped and completed.

```typescript
skipOnboarding();
// User won't see onboarding again
```

#### resetOnboarding()

Clears all onboarding state (useful for testing).

```typescript
resetOnboarding();
// User will see onboarding on next visit
```

#### shouldShowOnboarding()

Checks if onboarding should be displayed.

```typescript
if (shouldShowOnboarding()) {
  // Show onboarding modal
}
```

#### getProgress(state: OnboardingState)

Calculates completion percentage.

```typescript
const progress = getProgress(state);
// Returns 0-100
```

### React Components

#### OnboardingProvider

Context provider managing onboarding state.

**Props:**
- `steps: OnboardingStep[]` - Array of onboarding steps
- `children: ReactNode` - App components
- `onComplete?: () => void` - Completion callback
- `onSkip?: () => void` - Skip callback
- `storageKey?: string` - localStorage key (default: 'onboarding-completed')

#### OnboardingModal

Modal UI for onboarding flow.

**Props:**
- `showProgress?: boolean` - Show progress bar (default: true)
- `showSkip?: boolean` - Show skip button (default: true)

#### useOnboarding()

Hook to access onboarding context.

```typescript
const {
  steps,
  currentStep,
  currentStepIndex,
  isOpen,
  isCompleted,
  progress,
  nextStep,
  previousStep,
  skipOnboarding,
  completeOnboarding,
} = useOnboarding();
```

## Customization

### Custom Steps

Define your own onboarding flow:

```tsx
const customSteps = [
  {
    id: 'intro',
    title: 'Welcome',
    description: 'Let\'s get you started',
    content: <IntroVideo />,
  },
  {
    id: 'api-key',
    title: 'Create API Key',
    description: 'Generate your first API key',
    content: <ApiKeyForm onSuccess={() => completeStep('api-key')} />,
  },
  {
    id: 'webhook',
    title: 'Configure Webhooks',
    description: 'Set up event notifications',
    content: <WebhookForm />,
  },
];
```

### Custom Styling

Override default styles:

```tsx
<OnboardingModal
  style={{
    background: 'var(--surface-2)',
    borderRadius: '16px',
    maxWidth: '600px',
  }}
/>
```

### Conditional Steps

Show steps based on user state:

```tsx
const steps = useMemo(() => {
  const base = [...DEFAULT_STEPS];
  
  if (user.role === 'admin') {
    base.push({
      id: 'team-setup',
      title: 'Invite Team Members',
      description: 'Add your team',
    });
  }
  
  return base;
}, [user.role]);
```

### Interactive Steps

Add actions to steps:

```tsx
{
  id: 'test-order',
  title: 'Create Test Order',
  content: (
    <TestOrderForm
      onSubmit={async (order) => {
        await createOrder(order);
        completeStep('test-order');
      }}
    />
  ),
}
```

## Progress Tracking

### Display Progress

```tsx
function OnboardingProgress() {
  const { progress, currentStepIndex, steps } = useOnboarding();
  
  return (
    <div>
      <div style={{ width: `${progress}%` }} />
      <span>Step {currentStepIndex + 1} of {steps.length}</span>
    </div>
  );
}
```

### Step Indicators

```tsx
function StepIndicators() {
  const { steps, currentStepIndex } = useOnboarding();
  
  return (
    <div>
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={i === currentStepIndex ? 'active' : ''}
        >
          {step.title}
        </div>
      ))}
    </div>
  );
}
```

## Analytics Integration

Track onboarding metrics:

```tsx
<OnboardingProvider
  steps={steps}
  onComplete={() => {
    analytics.track('onboarding_completed', {
      duration: Date.now() - state.lastUpdated,
      stepsCompleted: state.steps.filter(s => s.completed).length,
    });
  }}
  onSkip={() => {
    analytics.track('onboarding_skipped', {
      stepReached: state.currentStep,
    });
  }}
>
```

Track individual step completion:

```tsx
useEffect(() => {
  if (currentStep) {
    analytics.track('onboarding_step_viewed', {
      stepId: currentStep.id,
      stepIndex: currentStepIndex,
    });
  }
}, [currentStep, currentStepIndex]);
```

## Testing

### Unit Tests

```bash
npm run test app/lib/onboarding.test.ts
```

Tests cover:
- State initialization
- Step navigation
- Step completion
- Progress calculation
- localStorage persistence
- Edge cases

### Integration Tests

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('completes onboarding flow', async () => {
  render(
    <OnboardingProvider steps={testSteps}>
      <OnboardingModal />
    </OnboardingProvider>
  );
  
  // Click through all steps
  for (let i = 0; i < testSteps.length - 1; i++) {
    await userEvent.click(screen.getByText('Next'));
  }
  
  await userEvent.click(screen.getByText('Complete'));
  
  expect(shouldShowOnboarding()).toBe(false);
});
```

### Storybook

View onboarding components in isolation:

```bash
npm run storybook
```

Navigate to: Components → OnboardingFlow

## Best Practices

### Do's

✅ Keep steps short and focused
✅ Allow users to skip
✅ Save progress automatically
✅ Provide clear actions
✅ Track completion metrics
✅ Test on mobile viewports
✅ Validate step completion

### Don'ts

❌ Make onboarding mandatory
❌ Include too many steps (>5)
❌ Block critical features
❌ Require full completion
❌ Show repeatedly
❌ Ignore user preferences

## Accessibility

Onboarding is keyboard navigable:

```tsx
// Tab through buttons
<button>Previous</button>
<button>Next</button>
<button>Skip</button>

// Escape closes modal
onKeyDown={(e) => {
  if (e.key === 'Escape') skipOnboarding();
}}

// Focus management
useEffect(() => {
  if (isOpen) {
    modalRef.current?.focus();
  }
}, [isOpen]);
```

## Performance

### Lazy Loading

Load onboarding components only when needed:

```tsx
const OnboardingFlow = dynamic(
  () => import('@/app/components/OnboardingFlow'),
  { ssr: false }
);
```

### State Optimization

Minimize re-renders with selective context:

```tsx
const { currentStep } = useOnboarding();
// Only re-renders when currentStep changes
```

## Migration

### From Old Onboarding

```tsx
// Old localStorage key
const oldCompleted = localStorage.getItem('onboarding_done');

if (oldCompleted) {
  // Migrate to new system
  skipOnboarding();
}
```

## Troubleshooting

### Onboarding Not Appearing

Check localStorage:
```javascript
localStorage.getItem('stellar_card_onboarding');
```

### Reset for Testing

```javascript
resetOnboarding();
location.reload();
```

### State Not Persisting

Verify localStorage is available:
```javascript
if (typeof window !== 'undefined') {
  // localStorage available
}
```

## Resources

- [UX Best Practices](https://www.nngroup.com/articles/onboarding-checklist/)
- [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [First-Time User Experience](https://www.appcues.com/blog/user-onboarding-best-practices)
