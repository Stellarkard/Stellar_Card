import { describe, it, expect } from 'vitest';
import {
  theme,
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  motion,
  zIndex,
  createStyles,
} from './theme-tokens';

describe('theme-tokens', () => {
  describe('colors', () => {
    it('should have background colors', () => {
      expect(colors.background.base).toBe('var(--bg)');
      expect(colors.background.elevated).toBe('var(--bg-elev)');
      expect(colors.background.elevated2).toBe('var(--bg-elev-2)');
    });

    it('should have foreground colors', () => {
      expect(colors.foreground.base).toBe('var(--fg)');
      expect(colors.foreground.muted).toBe('var(--fg-muted)');
      expect(colors.foreground.dim).toBe('var(--fg-dim)');
    });

    it('should have semantic colors', () => {
      expect(colors.semantic.success.base).toBe('var(--green)');
      expect(colors.semantic.error.base).toBe('var(--red)');
      expect(colors.semantic.warning.base).toBe('var(--yellow)');
      expect(colors.semantic.info.base).toBe('var(--blue)');
    });

    it('should have surface colors', () => {
      expect(colors.surface.base).toBe('var(--surface)');
      expect(colors.surface.level2).toBe('var(--surface-2)');
      expect(colors.surface.level3).toBe('var(--surface-3)');
    });

    it('should have border colors', () => {
      expect(colors.border.base).toBe('var(--border)');
      expect(colors.border.strong).toBe('var(--border-strong)');
      expect(colors.border.hairline).toBe('var(--border-hairline)');
    });
  });

  describe('typography', () => {
    it('should have font families', () => {
      expect(typography.family.display).toBe('var(--font-display)');
      expect(typography.family.body).toBe('var(--font-body)');
      expect(typography.family.mono).toBe('var(--font-mono)');
    });

    it('should have font sizes in rem', () => {
      expect(typography.size.xs).toBe('0.64rem');
      expect(typography.size.base).toBe('0.75rem');
      expect(typography.size['4xl']).toBe('1.125rem');
    });

    it('should have font weights', () => {
      expect(typography.weight.normal).toBe(400);
      expect(typography.weight.medium).toBe(500);
      expect(typography.weight.semibold).toBe(600);
      expect(typography.weight.bold).toBe(700);
    });

    it('should have line heights', () => {
      expect(typography.lineHeight.tight).toBe(0.96);
      expect(typography.lineHeight.normal).toBe(1.4);
      expect(typography.lineHeight.loose).toBe(1.65);
    });

    it('should have letter spacing values', () => {
      expect(typography.letterSpacing.tight).toBe('-0.025em');
      expect(typography.letterSpacing.wide).toBe('0.08em');
    });
  });

  describe('spacing', () => {
    it('should have consistent 4px base unit', () => {
      expect(spacing[1]).toBe('0.25rem'); // 4px
      expect(spacing[2]).toBe('0.5rem');  // 8px
      expect(spacing[4]).toBe('1rem');    // 16px
      expect(spacing[8]).toBe('2rem');    // 32px
    });

    it('should have px and 0 values', () => {
      expect(spacing.px).toBe('1px');
      expect(spacing[0]).toBe('0');
    });

    it('should have large spacing values', () => {
      expect(spacing[12]).toBe('3rem');
      expect(spacing[16]).toBe('4rem');
      expect(spacing[24]).toBe('6rem');
    });
  });

  describe('borderRadius', () => {
    it('should have border radius scale', () => {
      expect(borderRadius.none).toBe('0');
      expect(borderRadius.sm).toBe('4px');
      expect(borderRadius.base).toBe('6px');
      expect(borderRadius.full).toBe('9999px');
    });
  });

  describe('shadows', () => {
    it('should reference CSS variables', () => {
      expect(shadows.card).toBe('var(--shadow-card)');
      expect(shadows.hero).toBe('var(--shadow-hero)');
      expect(shadows.float).toBe('var(--shadow-float)');
    });

    it('should have none option', () => {
      expect(shadows.none).toBe('none');
    });
  });

  describe('motion', () => {
    it('should have easing functions', () => {
      expect(motion.easing.out).toBe('var(--ease-out)');
      expect(motion.easing.inOut).toBe('var(--ease-in-out)');
      expect(motion.easing.spring).toBe('var(--ease-spring)');
    });

    it('should have duration scale', () => {
      expect(motion.duration.instant).toBe('0ms');
      expect(motion.duration.fast).toBe('120ms');
      expect(motion.duration.normal).toBe('300ms');
      expect(motion.duration.slow).toBe('500ms');
    });
  });

  describe('zIndex', () => {
    it('should have layered z-index scale', () => {
      expect(zIndex.base).toBe(0);
      expect(zIndex.dropdown).toBe(10);
      expect(zIndex.modal).toBe(50);
      expect(zIndex.tooltip).toBe(70);
    });

    it('should have increasing values', () => {
      expect(zIndex.dropdown).toBeLessThan(zIndex.modal);
      expect(zIndex.modal).toBeLessThan(zIndex.tooltip);
    });
  });

  describe('theme object', () => {
    it('should consolidate all tokens', () => {
      expect(theme.colors).toBeDefined();
      expect(theme.typography).toBeDefined();
      expect(theme.spacing).toBeDefined();
      expect(theme.borderRadius).toBeDefined();
      expect(theme.shadows).toBeDefined();
      expect(theme.motion).toBeDefined();
      expect(theme.zIndex).toBeDefined();
      expect(theme.breakpoints).toBeDefined();
      expect(theme.components).toBeDefined();
    });
  });

  describe('createStyles helper', () => {
    it('should return styles object unchanged', () => {
      const styles = {
        container: { padding: '1rem', color: 'red' },
        text: { fontSize: '14px' },
      };
      
      const result = createStyles(styles);
      expect(result).toEqual(styles);
    });

    it('should be type-safe', () => {
      const styles = createStyles({
        button: {
          background: colors.semantic.success.base,
          padding: spacing[4],
          borderRadius: borderRadius.md,
        },
      });
      
      expect(styles.button.background).toBe('var(--green)');
    });
  });

  describe('component tokens', () => {
    it('should have button sizes', () => {
      expect(theme.components.button.height.sm).toBe('32px');
      expect(theme.components.button.height.md).toBe('40px');
      expect(theme.components.button.height.lg).toBe('48px');
    });

    it('should have input sizes', () => {
      expect(theme.components.input.height.sm).toBe('32px');
      expect(theme.components.input.height.md).toBe('40px');
    });

    it('should have card padding', () => {
      expect(theme.components.card.padding.sm).toBe('0.75rem');
      expect(theme.components.card.padding.xl).toBe('2rem');
    });
  });
});
