// Unit tests for theme utilities — pure logic, no DOM.

import { describe, it, expect } from 'vitest';
import {
  getPrimaryButtonStyle,
  getSecondaryButtonStyle,
  getCardStyle,
  getElevatedCardStyle,
  getBadgeStyle,
  getInputStyle,
  getStatusColors,
} from './themeUtilities';
import { THEME_COLORS, TYPOGRAPHY, BORDER_RADIUS } from './themeConstants';

describe('getPrimaryButtonStyle', () => {
  it('returns a valid button style object', () => {
    const style = getPrimaryButtonStyle();
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('fontSize');
    expect(style).toHaveProperty('fontFamily');
    expect(style).toHaveProperty('fontWeight');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('cursor');
    expect(style).toHaveProperty('transition');
  });

  it('uses mono font family', () => {
    const style = getPrimaryButtonStyle();
    expect(style.fontFamily).toBe(TYPOGRAPHY.fontMono);
  });

  it('uses semibold font weight', () => {
    const style = getPrimaryButtonStyle();
    expect(style.fontWeight).toBe(TYPOGRAPHY.fontWeight.semibold);
  });
});

describe('getSecondaryButtonStyle', () => {
  it('returns a valid button style object', () => {
    const style = getSecondaryButtonStyle();
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('fontSize');
    expect(style).toHaveProperty('fontFamily');
  });
});

describe('getCardStyle', () => {
  it('returns a valid card style object', () => {
    const style = getCardStyle();
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('background');
    expect(style).toHaveProperty('border');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('boxShadow');
  });

  it('uses surface-2 background', () => {
    const style = getCardStyle();
    expect(style.background).toBe(THEME_COLORS.surface2);
  });

  it('uses md border radius', () => {
    const style = getCardStyle();
    expect(style.borderRadius).toBe(BORDER_RADIUS.md);
  });
});

describe('getElevatedCardStyle', () => {
  it('returns a valid elevated card style', () => {
    const style = getElevatedCardStyle();
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('background');
    expect(style).toHaveProperty('boxShadow');
  });

  it('uses bg-elev background', () => {
    const style = getElevatedCardStyle();
    expect(style.background).toBe(THEME_COLORS.bgElev);
  });

  it('uses float shadow', () => {
    const style = getElevatedCardStyle();
    expect(style.boxShadow).toBe('var(--shadow-float)');
  });
});

describe('getBadgeStyle', () => {
  it('returns a valid badge style for neutral tone', () => {
    const style = getBadgeStyle('neutral');
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('fontSize');
    expect(style).toHaveProperty('fontFamily');
    expect(style).toHaveProperty('fontWeight');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('display');
    expect(style).toHaveProperty('alignItems');
  });

  it('uses full border radius for pill shape', () => {
    const style = getBadgeStyle();
    expect(style.borderRadius).toBe(BORDER_RADIUS.full);
  });

  it('uses sm font size', () => {
    const style = getBadgeStyle();
    expect(style.fontSize).toBe(TYPOGRAPHY.fontSize.sm);
  });
});

describe('getInputStyle', () => {
  it('returns a valid input style object', () => {
    const style = getInputStyle();
    expect(style).toHaveProperty('padding');
    expect(style).toHaveProperty('fontSize');
    expect(style).toHaveProperty('fontFamily');
    expect(style).toHaveProperty('background');
    expect(style).toHaveProperty('color');
    expect(style).toHaveProperty('border');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('outline');
    expect(style).toHaveProperty('transition');
  });

  it('uses body font family', () => {
    const style = getInputStyle();
    expect(style.fontFamily).toBe(TYPOGRAPHY.fontBody);
  });

  it('uses surface background', () => {
    const style = getInputStyle();
    expect(style.background).toBe(THEME_COLORS.surface);
  });

  it('has no outline', () => {
    const style = getInputStyle();
    expect(style.outline).toBe('none');
  });
});

describe('getStatusColors', () => {
  it('returns yellow colors for pending_payment status', () => {
    const colors = getStatusColors('pending_payment');
    expect(colors.color).toBe(THEME_COLORS.yellow);
    expect(colors.background).toBe(THEME_COLORS.yellowMuted);
    expect(colors.border).toBe(THEME_COLORS.yellowBorder);
  });

  it('returns blue colors for payment_confirmed status', () => {
    const colors = getStatusColors('payment_confirmed');
    expect(colors.color).toBe(THEME_COLORS.blue);
    expect(colors.background).toBe(THEME_COLORS.blueMuted);
    expect(colors.border).toBe(THEME_COLORS.blueBorder);
  });

  it('returns purple colors for ordering status', () => {
    const colors = getStatusColors('ordering');
    expect(colors.color).toBe(THEME_COLORS.purple);
    expect(colors.background).toBe(THEME_COLORS.purpleMuted);
    expect(colors.border).toBe(THEME_COLORS.purpleBorder);
  });

  it('returns green colors for delivered status', () => {
    const colors = getStatusColors('delivered');
    expect(colors.color).toBe(THEME_COLORS.green);
    expect(colors.background).toBe(THEME_COLORS.greenMuted);
    expect(colors.border).toBe(THEME_COLORS.greenBorder);
  });

  it('returns red colors for failed status', () => {
    const colors = getStatusColors('failed');
    expect(colors.color).toBe(THEME_COLORS.red);
    expect(colors.background).toBe(THEME_COLORS.redMuted);
    expect(colors.border).toBe(THEME_COLORS.redBorder);
  });

  it('returns dim colors for expired status', () => {
    const colors = getStatusColors('expired');
    expect(colors.color).toBe(THEME_COLORS.fgDim);
    expect(colors.background).toBe(THEME_COLORS.surface);
    expect(colors.border).toBe(THEME_COLORS.borderStrong);
  });

  it('returns neutral colors for unknown status', () => {
    const colors = getStatusColors('unknown_status');
    expect(colors.color).toBe(THEME_COLORS.fgDim);
    expect(colors.background).toBe(THEME_COLORS.surface);
    expect(colors.border).toBe(THEME_COLORS.border);
  });

  it('returns colors for all documented statuses', () => {
    const statuses = [
      'pending_payment', 'payment_confirmed', 'ordering', 'claim_received',
      'stage1_done', 'delivered', 'failed', 'refund_pending', 'awaiting_approval',
      'awaiting_payment', 'processing', 'ready', 'refunded', 'rejected', 'expired',
    ];
    for (const status of statuses) {
      const colors = getStatusColors(status);
      expect(colors).toHaveProperty('color');
      expect(colors).toHaveProperty('background');
      expect(colors).toHaveProperty('border');
    }
  });
});
