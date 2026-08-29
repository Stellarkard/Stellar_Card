import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBoundary } from './ErrorBoundary';
import { useState } from 'react';

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

// Component that throws an error
function ThrowError() {
  throw new Error('This is a simulated error for demonstration');
}

function ErrorDemo() {
  const [shouldError, setShouldError] = useState(false);

  if (shouldError) {
    return <ThrowError />;
  }

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <p style={{ marginBottom: '1rem', color: 'var(--fg-muted)' }}>No error yet</p>
      <button
        onClick={() => setShouldError(true)}
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--red)',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Trigger Error
      </button>
    </div>
  );
}

export const Working: Story = {
  render: () => (
    <ErrorBoundary>
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--fg)' }}>This content rendered successfully!</p>
      </div>
    </ErrorBoundary>
  ),
};

export const WithError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowError />
    </ErrorBoundary>
  ),
};

export const WithCustomFallback: Story = {
  render: () => (
    <ErrorBoundary
      fallback={
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            background: 'var(--red-muted)',
            border: '1px solid var(--red-border)',
            borderRadius: 8,
            color: 'var(--red)',
          }}
        >
          <p>Custom error fallback UI</p>
        </div>
      }
    >
      <ThrowError />
    </ErrorBoundary>
  ),
};

export const Interactive: Story = {
  render: () => (
    <ErrorBoundary onError={(error, info) => console.log('Error caught:', error, info)}>
      <ErrorDemo />
    </ErrorBoundary>
  ),
};
