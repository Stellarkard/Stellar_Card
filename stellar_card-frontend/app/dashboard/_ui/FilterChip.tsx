// Pill-shaped filter chip used in headers of list/table pages. Optional
// tone shows a colored dot on the left; `count` lives on the right in
// mono so totals line up.
//
// A11y (#136):
//   - type="button" prevents form submission.
//   - aria-pressed reflects the active/inactive toggle state.

import type { ReactNode } from 'react';
import type { PillTone } from './Pill';
import { toneTokens, token } from './tokens';
import { typography } from './tokens';

interface Props {
  active: boolean;
  onClick: () => void;
  count?: number;
  tone?: PillTone;
  children: ReactNode;
}

export function FilterChip({ active, onClick, count, tone, children }: Props) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.35rem 0.7rem',
        background: active ? token.surface : 'transparent',
        border: `1px solid ${active ? token.borderStrong : token.border}`,
        borderRadius: 999,
        fontSize: '0.72rem',
        lineHeight: 1,
        color: active ? token.fg : token.fgMuted,
        cursor: 'pointer',
        fontWeight: active ? 600 : 500,
        whiteSpace: 'nowrap',
      }}
    >
      {tone && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: toneTokens[tone].fg,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
        {children}
      </span>
      {count !== undefined && (
        <span
          style={{
            color: token.fgDim,
            fontFamily: token.fontMono,
            fontSize: '0.66rem',
            color: 'var(--fg-dim)',
            fontFamily: typography.fontMono,
            fontSize: typography.size.xs,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            paddingLeft: '0.05rem',
            // Mono digits sit ~1px above their baseline relative to the
            // sans label — nudge them down so the chip reads as one row.
            transform: 'translateY(0.5px)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
