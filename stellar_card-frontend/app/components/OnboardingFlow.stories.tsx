import type { Meta, StoryObj } from '@storybook/react';
import { OnboardingFlow } from './OnboardingFlow';
import { useEffect } from 'react';
import { resetOnboarding } from '@/app/lib/onboarding';

const meta = {
  title: 'Components/OnboardingFlow',
  component: OnboardingFlow,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'First-run onboarding flow with state persistence. Tracks user progress through initial setup steps.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      // Reset onboarding for story isolation
      useEffect(() => {
        resetOnboarding();
      }, []);
      return <Story />;
    },
  ],
} satisfies Meta<typeof OnboardingFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onComplete: () => console.log('Onboarding completed'),
    onSkip: () => console.log('Onboarding skipped'),
  },
};

export const WithCallback: Story = {
  args: {
    onComplete: () => {
      alert('Welcome! Onboarding completed.');
    },
    onSkip: () => {
      alert('Onboarding skipped.');
    },
  },
};
