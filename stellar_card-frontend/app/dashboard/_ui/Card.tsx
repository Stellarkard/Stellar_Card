// Card — a surface-elevated container. Used for KPI tiles, chart frames,
// table wrappers, side pane sections. Padding optional so tables can go
// edge-to-edge inside a card.
//
// A11y (#136):
//   - When a title is present the card renders as a <section> with an
//     accessible heading so screen readers can navigate by landmark.
//   - aria-labelledby ties the section to its title text.
//   - Without a title the card stays a plain <div> to avoid polluting
//     the landmark list with anonymous regions.

import type { CSSProperties, ReactNode } from 'react';
import { useId } from 'react';

interface Props {
  children: ReactNode;
  padding?: string | number;
  style?: CSSProperties;
  title?: ReactNode;
  actions?: ReactNode;
}

export function Card({ children, padding = '1rem 1.25rem', style, title, actions }: Props) {
  const headingId = useId();
  const isEdgeToEdge = padding === 0 || padding === '0';
  const Tag = title ? 'section' : 'div';
  return (
    <Tag
      aria-labelledby={title ? headingId : undefined}
      className={isEdgeToEdge ? 'dashboard-card dashboard-card-scroll' : 'dashboard-card'}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-card)',
        overflow: isEdgeToEdge ? 'hidden' : undefined,
        ...style,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            minHeight: 44,
          }}
        >
          <div
            id={headingId}
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--fg-muted)',
            }}
          >
            {title}
          </div>
          {actions}
        </div>
      )}
      <div
        style={{
          padding: typeof padding === 'number' ? `${padding}px` : padding,
          overflowX: padding === 0 || padding === '0' ? 'auto' : undefined,
        }}
      >
        {children}
      </div>
    </Tag>
  );
}
