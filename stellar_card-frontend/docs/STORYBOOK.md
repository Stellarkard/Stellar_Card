# Storybook Documentation

Complete documentation for Storybook setup, testing, and component development in the Stellar_Card frontend.

## Overview

Storybook is configured with:
- **Next.js integration** via `@storybook/nextjs-vite`
- **Automatic documentation** with `@storybook/addon-docs`
- **Accessibility testing** via `@storybook/addon-a11y`
- **Visual testing** integration ready for Chromatic
- **Vitest integration** for component testing within stories

## Quick Start

```bash
# Start Storybook dev server
npm run storybook

# Build Storybook for production
npm run build-storybook

# Run Storybook tests
npm run test:storybook
```

## Configuration

### Main Configuration (`.storybook/main.ts`)

Storybook is configured to:
- Find all `*.stories.tsx` files in the `app/` directory
- Use Vite as the build tool for fast HMR
- Load essential addons (essentials, a11y, docs, vitest)
- Resolve `@/` alias to the project root

### Preview Configuration (`.storybook/preview.tsx`)

Global decorators apply:
- **Theme wrapper** for dark/light theme testing
- **Global CSS** from `app/globals.css`
- **Mock wallet provider** for dashboard components
- **Default backgrounds** (dark/light theme)

### Test Configuration (`.storybook/test-runner.ts`)

Automated test runner:
- Runs accessibility checks on all stories
- Detects console errors during rendering
- Supports story-level test assertions
- Integrates with CI/CD pipelines

## Writing Stories

### Basic Story Structure

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta = {
  title: 'Dashboard/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Primary button component with multiple variants.',
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    children: 'Click me',
    variant: 'primary',
  },
};

export const Secondary: Story = {
  args: {
    children: 'Secondary',
    variant: 'secondary',
  },
};
```

### Interactive Stories

Use `play` functions for interaction testing:

```tsx
import { userEvent, within } from '@storybook/testing-library';
import { expect } from '@storybook/test';

export const WithInteraction: Story = {
  args: {
    onClick: () => console.log('Clicked'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');
    
    await userEvent.click(button);
    await expect(button).toHaveFocus();
  },
};
```

### Accessibility Testing

Stories automatically run a11y checks. For custom validation:

```tsx
import { testAccessibility } from '@/.storybook/test-utils';

export const WithA11y: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await testAccessibility(canvas);
  },
};
```

## Testing Utilities

### Available Helpers (`.storybook/test-utils.tsx`)

- `testAccessibility(canvas)` - Validates basic a11y requirements
- `testKeyboardNavigation(canvas, element)` - Tests keyboard focus
- `testResponsive(page, viewports)` - Tests responsive behavior
- `testThemeToggle(canvas)` - Validates dark/light theme switching
- `mockData.order()` - Generates mock order data
- `mockData.agent()` - Generates mock agent data

### Example Usage

```tsx
import { testThemeToggle, mockData } from '@/.storybook/test-utils';

export const ThemeAware: Story = {
  args: {
    order: mockData.order({ status: 'delivered' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await testThemeToggle(canvas);
  },
};
```

## Testing Hooks Integration

Storybook integrates with Vitest via `@storybook/addon-vitest`:

```bash
# Run all tests including story tests
npm test

# Run only Storybook tests
npm run test:storybook
```

Stories with `play` functions automatically become test cases. The test runner:
1. Renders each story
2. Executes the `play` function
3. Captures console errors
4. Runs accessibility audits
5. Reports results

## Best Practices

### Component Organization

```
app/
  dashboard/
    _ui/
      Button.tsx
      Button.stories.tsx       # Co-located with component
      Button.test.tsx          # Unit tests
  components/
    Modal.tsx
    Modal.stories.tsx
```

### Story Naming

Use descriptive names that reflect the component state:

```tsx
export const Default: Story = {};
export const WithLongText: Story = {};
export const Disabled: Story = {};
export const Loading: Story = {};
export const Error: Story = {};
```

### Documentation

Add descriptions at component and story level:

```tsx
const meta = {
  title: 'Dashboard/Button',
  component: Button,
  parameters: {
    docs: {
      description: {
        component: 'Detailed component description.',
      },
    },
  },
} satisfies Meta<typeof Button>;

export const WithTooltip: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Shows button with tooltip on hover.',
      },
    },
  },
};
```

### Performance Testing

For components with performance concerns:

```tsx
export const LargeDataset: Story = {
  args: {
    data: generateItems(1000),
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders 1000 items with virtualization. Should maintain 60fps.',
      },
    },
  },
};
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Install dependencies
  run: npm ci

- name: Build Storybook
  run: npm run build-storybook

- name: Run Storybook tests
  run: npm run test:storybook
```

## Troubleshooting

### Stories Not Appearing

- Check file matches `*.stories.tsx` pattern
- Ensure story is in `app/` directory
- Verify meta export exists

### CSS Not Loading

- Check `globals.css` import in `.storybook/preview.tsx`
- Verify Vite configuration resolves paths correctly

### Mock Data Issues

- Use mock providers from `.storybook/preview.tsx`
- Import test utilities from `.storybook/test-utils.tsx`

### Theme Not Switching

- Ensure `ThemeProvider` decorator is active
- Check `data-theme` attribute on root element

## Resources

- [Storybook Documentation](https://storybook.js.org/docs)
- [Vitest Integration](https://storybook.js.org/docs/writing-tests/test-runner)
- [Accessibility Testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- [Visual Testing](https://storybook.js.org/docs/writing-tests/visual-testing)
