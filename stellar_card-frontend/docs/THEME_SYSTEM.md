# Theme System Documentation

Complete guide to the Stellar_Card design system including colors, typography, spacing, and component tokens.

## Overview

The theme system provides a standardized set of design tokens that ensure consistency across the application. All values reference CSS variables defined in `app/globals.css`, allowing for seamless dark/light theme switching.

## Architecture

```
app/
  globals.css                    # CSS variable definitions
  dashboard/
    _ui/
      theme-tokens.ts            # Standardized design tokens
      tokens.ts                  # Component-specific tokens (legacy)
    _lib/
      themeConstants.ts          # Theme constants (legacy)
```

## Using Theme Tokens

### Import

```tsx
import { theme, colors, typography, spacing } from '@/app/dashboard/_ui/theme-tokens';
```

### Basic Usage

```tsx
function MyComponent() {
  return (
    <div style={{
      background: colors.surface.base,
      color: colors.foreground.base,
      padding: spacing[4],
      borderRadius: borderRadius.md,
      fontFamily: typography.family.body,
      fontSize: typography.size.base,
    }}>
      Content
    </div>
  );
}
```

## Color System

### Background & Foreground

```tsx
colors.background.base       // --bg: Main canvas
colors.background.elevated   // --bg-elev: Elevated surface
colors.background.elevated2  // --bg-elev-2: Double elevated

colors.foreground.base       // --fg: Primary text
colors.foreground.muted      // --fg-muted: Secondary text
colors.foreground.dim        // --fg-dim: Tertiary text
```

### Surface Colors

```tsx
colors.surface.base    // --surface: Card background
colors.surface.level2  // --surface-2: Nested surface
colors.surface.level3  // --surface-3: Double nested
colors.surface.hover   // --surface-hover: Hover state
```

### Borders

```tsx
colors.border.base       // --border: Standard border
colors.border.strong     // --border-strong: Emphasized border
colors.border.hairline   // --border-hairline: Subtle divider
```

### Semantic Colors

```tsx
// Success (green)
colors.semantic.success.base    // --green
colors.semantic.success.dim     // --green-dim
colors.semantic.success.muted   // --green-muted (background)
colors.semantic.success.border  // --green-border
colors.semantic.success.glow    // --green-glow (shadow)

// Error (red)
colors.semantic.error.base      // --red
colors.semantic.error.muted     // --red-muted
colors.semantic.error.border    // --red-border

// Warning (yellow)
colors.semantic.warning.base    // --yellow
colors.semantic.warning.muted   // --yellow-muted
colors.semantic.warning.border  // --yellow-border

// Info (blue)
colors.semantic.info.base       // --blue
colors.semantic.info.muted      // --blue-muted
colors.semantic.info.border     // --blue-border

// Neutral (purple)
colors.semantic.neutral.base    // --purple
colors.semantic.neutral.muted   // --purple-muted
colors.semantic.neutral.border  // --purple-border
```

## Typography System

### Font Families

```tsx
typography.family.display  // --font-display: Fraunces (headings)
typography.family.body     // --font-body: IBM Plex Sans
typography.family.mono     // --font-mono: IBM Plex Mono
```

### Font Sizes

Based on rem units (16px base):

```tsx
typography.size.xs      // 0.64rem  (10.24px)
typography.size.sm      // 0.7rem   (11.2px)
typography.size.base    // 0.75rem  (12px)
typography.size.md      // 0.78rem  (12.48px)
typography.size.lg      // 0.82rem  (13.12px)
typography.size.xl      // 0.875rem (14px)
typography.size['2xl']  // 0.95rem  (15.2px)
typography.size['3xl']  // 1rem     (16px)
typography.size['4xl']  // 1.125rem (18px)
typography.size['5xl']  // 1.25rem  (20px)
typography.size['6xl']  // 1.5rem   (24px)
```

### Font Weights

```tsx
typography.weight.normal    // 400
typography.weight.medium    // 500
typography.weight.semibold  // 600
typography.weight.bold      // 700
```

### Line Heights

```tsx
typography.lineHeight.tight    // 0.96  (display headings)
typography.lineHeight.snug     // 1.2
typography.lineHeight.normal   // 1.4
typography.lineHeight.relaxed  // 1.5
typography.lineHeight.loose    // 1.65  (body text)
```

### Letter Spacing

```tsx
typography.letterSpacing.tighter  // -0.03em
typography.letterSpacing.tight    // -0.025em
typography.letterSpacing.normal   // 0em
typography.letterSpacing.wide     // 0.08em  (uppercase labels)
typography.letterSpacing.wider    // 0.14em  (eyebrow text)
```

## Spacing System

4px base unit scale:

```tsx
spacing.px   // 1px
spacing[0]   // 0
spacing[0.5] // 0.125rem (2px)
spacing[1]   // 0.25rem  (4px)
spacing[2]   // 0.5rem   (8px)
spacing[3]   // 0.75rem  (12px)
spacing[4]   // 1rem     (16px)
spacing[6]   // 1.5rem   (24px)
spacing[8]   // 2rem     (32px)
spacing[12]  // 3rem     (48px)
spacing[16]  // 4rem     (64px)
spacing[24]  // 6rem     (96px)
```

### Usage Examples

```tsx
// Padding
<div style={{ padding: spacing[4] }}>         // 16px
<div style={{ padding: spacing[8] }}>         // 32px
<div style={{ paddingTop: spacing[2] }}>      // 8px

// Margin
<div style={{ marginBottom: spacing[6] }}>    // 24px

// Gap
<div style={{ gap: spacing[3] }}>             // 12px
```

## Border Radius

```tsx
borderRadius.none   // 0
borderRadius.sm     // 4px   (pills, tags)
borderRadius.base   // 6px   (buttons, inputs)
borderRadius.md     // 8px   (small cards)
borderRadius.lg     // 10px  (modals)
borderRadius.xl     // 12px  (large cards)
borderRadius['2xl'] // 16px
borderRadius['3xl'] // 24px
borderRadius.full   // 9999px (circles)
```

## Shadows

```tsx
shadows.card   // --shadow-card: Standard card elevation
shadows.hero   // --shadow-hero: Hero section depth
shadows.float  // --shadow-float: Floating elements
shadows.none   // none: No shadow
```

## Motion & Animation

### Easing Functions

```tsx
motion.easing.out      // cubic-bezier(0.16, 1, 0.3, 1)
motion.easing.inOut    // cubic-bezier(0.77, 0, 0.18, 1)
motion.easing.spring   // cubic-bezier(0.34, 1.56, 0.64, 1)
```

### Duration

```tsx
motion.duration.instant  // 0ms
motion.duration.fast     // 120ms  (micro-interactions)
motion.duration.normal   // 300ms  (standard transitions)
motion.duration.slow     // 500ms  (page transitions)
motion.duration.slower   // 800ms  (complex animations)
```

### Usage

```tsx
<div style={{
  transition: `transform ${motion.duration.normal} ${motion.easing.out}`,
}}>
```

## Z-Index Scale

Layered stacking context:

```tsx
zIndex.base          // 0   (default)
zIndex.dropdown      // 10  (dropdowns)
zIndex.sticky        // 20  (sticky headers)
zIndex.fixed         // 30  (fixed elements)
zIndex.modalBackdrop // 40  (modal backdrop)
zIndex.modal         // 50  (modal content)
zIndex.popover       // 60  (popovers)
zIndex.tooltip       // 70  (tooltips)
zIndex.notification  // 80  (toasts)
```

## Breakpoints

Responsive design breakpoints:

```tsx
breakpoints.sm    // 640px   (mobile landscape)
breakpoints.md    // 768px   (tablets)
breakpoints.lg    // 1024px  (desktop)
breakpoints.xl    // 1280px  (large desktop)
breakpoints['2xl'] // 1536px  (ultra-wide)
```

### Media Query Helper

```tsx
const mq = `@media (min-width: ${breakpoints.md})`;
```

## Component Tokens

Pre-defined component sizes:

### Buttons

```tsx
theme.components.button.height.sm   // 32px
theme.components.button.height.md   // 40px
theme.components.button.height.lg   // 48px

theme.components.button.padding.sm  // 0.5rem 0.875rem
theme.components.button.padding.md  // 0.625rem 1.125rem
theme.components.button.padding.lg  // 0.75rem 1.5rem
```

### Inputs

```tsx
theme.components.input.height.sm  // 32px
theme.components.input.height.md  // 40px
theme.components.input.height.lg  // 48px
```

### Cards

```tsx
theme.components.card.padding.sm  // 0.75rem
theme.components.card.padding.md  // 1rem
theme.components.card.padding.lg  // 1.5rem
theme.components.card.padding.xl  // 2rem
```

## Helper Functions

### createStyles

Type-safe inline styles:

```tsx
import { createStyles } from '@/app/dashboard/_ui/theme-tokens';

const styles = createStyles({
  container: {
    background: colors.surface.base,
    padding: spacing[4],
  },
  text: {
    color: colors.foreground.muted,
    fontSize: typography.size.base,
  },
});

<div style={styles.container}>
  <p style={styles.text}>Text</p>
</div>
```

## Dark/Light Theme

Themes switch via `data-theme` attribute on `<html>`:

```tsx
// Dark theme (default)
<html>...</html>

// Light theme
<html data-theme="light">...</html>
```

All CSS variables automatically update. Components using theme tokens adapt without code changes.

### Theme Toggle

```tsx
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'light' ? '' : 'light');
}
```

## Migration Guide

### From themeConstants.ts

```tsx
// Old
import { THEME_COLORS } from '@/app/dashboard/_lib/themeConstants';
const bg = THEME_COLORS.bg;

// New
import { colors } from '@/app/dashboard/_ui/theme-tokens';
const bg = colors.background.base;
```

### From tokens.ts

```tsx
// Old
import { TONE_VARS, typography } from '@/app/dashboard/_ui/tokens';
const { fg } = TONE_VARS.green;

// New
import { colors } from '@/app/dashboard/_ui/theme-tokens';
const fg = colors.semantic.success.base;
```

### From Inline CSS Variables

```tsx
// Old
<div style={{ color: 'var(--fg)' }} />

// New
import { colors } from '@/app/dashboard/_ui/theme-tokens';
<div style={{ color: colors.foreground.base }} />
```

## Best Practices

### Do's

✅ Use theme tokens for all styling
✅ Reference semantic colors for status
✅ Use spacing scale consistently
✅ Apply typography scale systematically
✅ Leverage motion tokens for animations
✅ Follow z-index hierarchy

### Don'ts

❌ Hardcode color values
❌ Use arbitrary spacing values
❌ Mix px and rem inconsistently
❌ Create custom z-index values
❌ Bypass theme for "one-off" styles

## Testing

Theme tokens are fully tested:

```bash
npm run test app/dashboard/_ui/theme-tokens.test.ts
```

## TypeScript Support

Full type safety:

```tsx
import type { Theme, ThemeColors } from '@/app/dashboard/_ui/theme-tokens';

function useThemeColor(path: keyof ThemeColors) {
  return colors[path];
}
```

## Resources

- [CSS Variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
- [Design Tokens](https://css-tricks.com/what-are-design-tokens/)
- [Color Theory](https://www.smashingmagazine.com/2016/04/web-developer-guide-color/)
