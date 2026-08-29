// Centralized theme utilities for the Stellar_Card frontend.
// Provides reusable style generators and component patterns
// to ensure visual consistency across the application.

import { THEME_COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS, MOTION } from './themeConstants';

export interface ButtonStyle {
  padding: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: number;
  borderRadius: string;
  cursor: string;
  transition: string;
}

export interface CardStyle {
  padding: string;
  background: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
}

export interface BadgeStyle {
  padding: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: number;
  borderRadius: string;
  display: string;
  alignItems: string;
}

export interface InputStyle {
  padding: string;
  fontSize: string;
  fontFamily: string;
  background: string;
  color: string;
  border: string;
  borderRadius: string;
  outline: string;
  transition: string;
}

// Button styles
export function getPrimaryButtonStyle(): ButtonStyle {
  return {
    padding: `${SPACING.sm} ${SPACING.md}`,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontMono,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    borderRadius: BORDER_RADIUS.base,
    cursor: 'pointer',
    transition: `background ${MOTION.duration.fast}, border-color ${MOTION.duration.fast}`,
  };
}

export function getSecondaryButtonStyle(): ButtonStyle {
  return {
    padding: `${SPACING.sm} ${SPACING.md}`,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontMono,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    borderRadius: BORDER_RADIUS.base,
    cursor: 'pointer',
    transition: `background ${MOTION.duration.fast}, border-color ${MOTION.duration.fast}`,
  };
}

// Card styles
export function getCardStyle(): CardStyle {
  return {
    padding: SPACING.lg,
    background: THEME_COLORS.surface2,
    border: `1px solid ${THEME_COLORS.border}`,
    borderRadius: BORDER_RADIUS.md,
    boxShadow: SHADOWS.card,
  };
}

export function getElevatedCardStyle(): CardStyle {
  return {
    padding: SPACING.lg,
    background: THEME_COLORS.bgElev,
    border: `1px solid ${THEME_COLORS.borderStrong}`,
    borderRadius: BORDER_RADIUS.md,
    boxShadow: SHADOWS.float,
  };
}

// Badge styles
export function getBadgeStyle(_tone: 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'neutral' = 'neutral'): BadgeStyle {
  return {
    padding: `${SPACING.xs} ${SPACING.sm}`,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontMono,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
    borderRadius: BORDER_RADIUS.full,
    display: 'inline-flex',
    alignItems: 'center',
  };
}

// Input styles
export function getInputStyle(): InputStyle {
  return {
    padding: `${SPACING.sm} ${SPACING.md}`,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontBody,
    background: THEME_COLORS.surface,
    color: THEME_COLORS.fg,
    border: `1px solid ${THEME_COLORS.border}`,
    borderRadius: BORDER_RADIUS.base,
    outline: 'none',
    transition: `border-color ${MOTION.duration.fast}`,
  };
}

// Status colors helper
export function getStatusColors(status: string): { color: string; background: string; border: string } {
  const statusMap: Record<string, { color: string; background: string; border: string }> = {
    pending_payment: { color: THEME_COLORS.yellow, background: THEME_COLORS.yellowMuted, border: THEME_COLORS.yellowBorder },
    payment_confirmed: { color: THEME_COLORS.blue, background: THEME_COLORS.blueMuted, border: THEME_COLORS.blueBorder },
    ordering: { color: THEME_COLORS.purple, background: THEME_COLORS.purpleMuted, border: THEME_COLORS.purpleBorder },
    claim_received: { color: THEME_COLORS.purple, background: THEME_COLORS.purpleMuted, border: THEME_COLORS.purpleBorder },
    stage1_done: { color: THEME_COLORS.purple, background: THEME_COLORS.purpleMuted, border: THEME_COLORS.purpleBorder },
    delivered: { color: THEME_COLORS.green, background: THEME_COLORS.greenMuted, border: THEME_COLORS.greenBorder },
    failed: { color: THEME_COLORS.red, background: THEME_COLORS.redMuted, border: THEME_COLORS.redBorder },
    refund_pending: { color: THEME_COLORS.yellow, background: THEME_COLORS.yellowMuted, border: THEME_COLORS.yellowBorder },
    awaiting_approval: { color: THEME_COLORS.purple, background: THEME_COLORS.purpleMuted, border: THEME_COLORS.purpleBorder },
    awaiting_payment: { color: THEME_COLORS.yellow, background: THEME_COLORS.yellowMuted, border: THEME_COLORS.yellowBorder },
    processing: { color: THEME_COLORS.blue, background: THEME_COLORS.blueMuted, border: THEME_COLORS.blueBorder },
    ready: { color: THEME_COLORS.green, background: THEME_COLORS.greenMuted, border: THEME_COLORS.greenBorder },
    refunded: { color: THEME_COLORS.yellow, background: THEME_COLORS.yellowMuted, border: THEME_COLORS.yellowBorder },
    rejected: { color: THEME_COLORS.red, background: THEME_COLORS.redMuted, border: THEME_COLORS.redBorder },
    expired: { color: THEME_COLORS.fgDim, background: THEME_COLORS.surface, border: THEME_COLORS.borderStrong },
  };

  return statusMap[status] || { color: THEME_COLORS.fgDim, background: THEME_COLORS.surface, border: THEME_COLORS.border };
}
