import type { StorybookConfig } from '@storybook/nextjs-vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../app/**/*.stories.@(ts|tsx)'],
  // Storybook 9+ folds essentials (controls, actions, backgrounds, viewport,
  // toolbars, measure, outline) into core, so only non-core addons are listed
  // here. Do not re-add "@storybook/addon-essentials" — it only ships up to
  // v8.6.x and its peer dependency on that range breaks install (npm ERESOLVE)
  // against storybook@10.
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': resolve(__dirname, '../'),
    };
    return config;
  },
};

export default config;
