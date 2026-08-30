# Storybook Guide

This guide covers how Storybook is configured for the Stellar Card frontend, how to
write stories for reusable UI components, and how the Storybook suite is tested and
verified in CI.

## Overview

Storybook lets us develop, document, and visually test components in
`app/components/` and `app/dashboard/_ui/` in isolation, without needing to wire them
into a full page or spin up the backend.

- Config lives in `.storybook/` (`main.ts` for build config, `preview.tsx` for global
  decorators and parameters).
- Stories live next to the component they document, as `ComponentName.stories.tsx`.
- Story-driven interaction tests run through Vitest via `@storybook/addon-vitest`
  rather than the standalone `@storybook/test-runner` CLI.

## Running Storybook locally

```bash
npm run storybook          # start the dev server on :6006
npm run build-storybook    # produce a static build in storybook-static/
```

## Writing a story

Follow the existing stories in `app/dashboard/_ui/` or `app/components/` as a
template. A minimal story looks like:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Pill } from './Pill';

const meta: Meta<typeof Pill> = {
  title: 'Dashboard/Pill',
  component: Pill,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Pill>;

export const Default: Story = {
  args: { children: 'Active' },
};
```

Guidelines:

- Group stories under a `title` that mirrors the component's location (e.g.
  `Dashboard/Button`, `Marketing/HeroCard`) so the sidebar stays organized.
- Add the `autodocs` tag so the component gets a generated docs page (see
  `.storybook/main.ts`, `docs.autodocs: 'tag'`).
- Cover the meaningful states of a component (default, loading, error, empty,
  disabled) as separate named exports — not just the happy path.
- Components that consume wallet state can rely on the `MockWalletContext`
  decorator wired up in `.storybook/preview.tsx`; no extra provider setup is
  needed in the story itself.

## Global decorators and providers

`.storybook/preview.tsx` wraps every story in the app's `ThemeProvider` and a mock
wallet connection provider, and sets shared parameters (backgrounds, a11y rules,
controls matchers). If a component depends on additional app-level context, extend
the `decorators` array there rather than duplicating provider setup per-story.

## Testing

Storybook stories are exercised as part of the Vitest suite through the Vitest
project named `storybook`, defined in `vitest.config.ts`. This runs every story in a
real headless Chromium browser via Playwright and fails the run on render errors,
a11y violations, or failed play functions.

```bash
npm run test              # runs both the unit-test project and the storybook project
npm run test:storybook    # runs only the storybook project
```

> The `test:storybook` script previously invoked the standalone
> `@storybook/test-runner` CLI (`test-storybook`), which is not installed in this
> project — that binary always failed with "could not determine executable to run".
> Story testing here is handled by `@storybook/addon-vitest` instead, so the script
> now delegates to `vitest run --project=storybook`.

The first run needs Playwright's browser binaries installed locally:

```bash
npx playwright install --with-deps chromium
```

## CI

The `Frontend Storybook` workflow (`.github/workflows/frontend-storybook.yml`) runs
on every push and pull request that touches `stellar_card-frontend/`. It type-checks
and lints the project, runs the unit and Storybook test projects, builds the static
Storybook site, and uploads the build as a workflow artifact so it can be reviewed
without running Storybook locally.

## Dependency versions

All `@storybook/*` packages and the `storybook` package itself must stay on the same
major version. Storybook 9+ folds the old `addon-essentials` bundle (controls,
actions, backgrounds, viewport, toolbars, measure, outline) into core, so it should
not be added back as a dependency or to the `addons` array in `.storybook/main.ts` —
that package only publishes up to `v8.6.x`, and pairing it with `storybook@10.x`
reintroduces an `npm ERESOLVE` conflict that breaks `npm ci`.
