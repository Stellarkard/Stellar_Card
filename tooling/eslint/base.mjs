/**
 * Repository-wide ESLint policy shared by package-specific flat configs.
 *
 * Framework integrations remain in each package so dependencies resolve from
 * that package; generic JavaScript and TypeScript policy lives here.
 */
export const repositoryIgnores = [
  '**/.next/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/out/**',
  '**/next-env.d.ts',
];

export const repositoryRules = {
  eqeqeq: ['error', 'always'],
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-trailing-spaces': 'error',
  'prefer-const': 'error',
};

export default {
  repositoryIgnores,
  repositoryRules,
};
