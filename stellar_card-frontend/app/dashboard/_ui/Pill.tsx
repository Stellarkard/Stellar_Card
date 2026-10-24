// Colored status pill with a leading dot. Drives agent state badges and
// order status badges. Colors map to the CSS variable palette so both
// themes look right.

import type { ReactNode } from 'react';
import { type Tone, TONE_VARS, typography } from './tokens';

/** @deprecated Import `Tone` from `./tokens` instead. */
export type PillTone = Tone;

interface Props {
  tone?: Tone;
  pulse?: boolean;
  children: ReactNode;
  title?: string;
}

export function Pill({ tone = 'neutral', pulse, children, title }: Props) {
  const c = TONE_VARS[tone];
  return (
    <span
      role="status"
      title={title}
      aria-label={title ?? (typeof children === 'string' ? children : undefined)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        fontSize: typography.size.base,
        fontFamily: typography.fontMono,
        color: c.fg,
        padding: '0.2rem 0.55rem',
        borderRadius: 4,
        border: `1px solid ${c.border}`,
        background: c.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
          animation: pulse ? 'pulse 2s ease-in-out infinite' : undefined,
        }}
      />
      {children}
    </span>
  );
}
