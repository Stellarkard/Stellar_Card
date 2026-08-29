import type { Preview } from '@storybook/react';
import '../app/globals.css';

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
    ),
  ],
};

export default preview;
