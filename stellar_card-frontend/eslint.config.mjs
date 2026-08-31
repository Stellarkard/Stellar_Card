// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { repositoryIgnores, repositoryRules } from '../tooling/eslint/base.mjs';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([...repositoryIgnores]),
  {
    rules: repositoryRules,
  },
  ...storybook.configs['flat/recommended'],
]);

export default eslintConfig;
