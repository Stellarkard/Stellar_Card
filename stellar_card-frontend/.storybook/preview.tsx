import type { Preview } from '@storybook/react';
import '../app/globals.css';

import { ThemeProvider } from '../app/dashboard/_lib/ThemeProvider';
import { useWalletConnection, MockWalletContext } from '../app/dashboard/_lib/useWalletConnection';

// Helper component to manage mock wallet state inside Storybook
const StorybookMockWalletProvider = ({ children }: { children: React.ReactNode }) => {
  // Since this is outside the MockWalletContext.Provider, it will call the real implementation
  // and manage its own state internally, which we then provide to the stories.
  const wallet = useWalletConnection();
  
  return (
    <MockWalletContext.Provider value={wallet}>
      {children}
    </MockWalletContext.Provider>
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
        <StorybookMockWalletProvider>
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
        </StorybookMockWalletProvider>
      </ThemeProvider>
    ),
  ],
};

export default preview;
