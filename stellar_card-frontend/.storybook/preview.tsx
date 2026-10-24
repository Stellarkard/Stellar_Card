import type { Preview } from '@storybook/react';
import '../app/globals.css';

import { ThemeProvider } from '../app/dashboard/_lib/ThemeProvider';
import { useWalletConnection, MockWalletContext, MockWalletSandboxProvider, useWalletSandbox } from '../app/dashboard/_lib/useWalletConnection';
import { useState } from 'react';

// Helper component to manage mock wallet state inside Storybook
const StorybookMockWalletProvider = ({ children }: { children: React.ReactNode }) => {
  const wallet = useWalletConnection();
  
  return (
    <MockWalletContext.Provider value={wallet}>
      {children}
    </MockWalletContext.Provider>
  );
};

// Helper component for wallet sandbox testing - allows stories to toggle wallet states
const StorybookWalletSandbox = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<'disconnected' | 'connecting' | 'connected' | 'error' | 'insufficient_balance' | 'network_mismatch'>('disconnected');
  
  const stateMap: Record<string, WalletConnectionState> = {
    disconnected: 'disconnected',
    connecting: 'connecting',
    connected: 'connected',
    error: 'error',
    insufficient_balance: 'insufficient_balance',
    network_mismatch: 'network_mismatch',
  };

  const toggleState = useCallback((newState: keyof typeof stateMap) => {
    setState(stateMap[newState]);
  }, []);

  return (
    <MockWalletSandboxContext.Provider value={{ state, setState: toggleState, reset: () => setState('disconnected') }}>
      <StorybookMockWalletProvider>
        {children}
      </StorybookMockWalletProvider>
    </MockWalletSandboxContext.Provider>
  );
};

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#050505' },
        { name: 'light', value: '#fafaf7' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      config: {
        rules: [
          {
            id: 'color-contrast',
            enabled: true,
          },
          {
            id: 'label-has-associated-control',
            enabled: true,
          },
          {
            id: 'button-name',
            enabled: true,
          },
        ],
      },
    },
    docs: {
      toc: true,
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider>
        <StorybookWalletSandbox>
          <div
            style={{
              padding: '2rem',
              background: 'var(--bg)',
              color: 'var(--fg)',
              minHeight: '100vh',
              fontFamily: 'var(--font-body)',
            }}
          >
            <Story />
          </div>
        </StorybookWalletSandbox>
      </ThemeProvider>
    ),
  ],
};

export default preview;
