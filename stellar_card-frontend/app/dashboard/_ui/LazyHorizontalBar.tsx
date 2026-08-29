// Dynamic import wrapper for HorizontalBar.
// HorizontalBar can render many rows with calculations, so lazy-loading
// it keeps the initial bundle smaller for pages that don't use charts.

import dynamic from 'next/dynamic';

export const LazyHorizontalBar = dynamic(
  () => import('./HorizontalBar').then((m) => ({ default: m.HorizontalBar })),
  {
    ssr: true,
    loading: () => (
      <div
        style={{
          height: 100,
          background: 'var(--surface-2)',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-dim)',
          fontSize: '0.75rem',
        }}
        aria-busy="true"
        aria-label="Loading chart"
      >
        Loading chart…
      </div>
    ),
  },
);
