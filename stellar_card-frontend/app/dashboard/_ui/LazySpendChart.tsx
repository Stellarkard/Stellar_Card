// Dynamic import wrapper for SpendChart.
// SpendChart is a client component that runs heavy SVG path calculations.
// Lazy-loading it means the chart code is split into its own chunk and
// not included in the initial dashboard JS bundle — pages that mount
// before the chart data is ready pay no parse cost for this module.

import dynamic from 'next/dynamic';

export const LazySpendChart = dynamic(
  () => import('./SpendChart').then((m) => ({ default: m.SpendChart })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 200,
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
        Loading…
      </div>
    ),
  },
);
