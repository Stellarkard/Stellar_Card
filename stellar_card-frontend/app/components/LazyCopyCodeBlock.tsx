import dynamic from 'next/dynamic';

export const LazyCopyCodeBlock = dynamic(
  () => import('./CopyCodeBlock').then((m) => ({ default: m.CopyCodeBlock })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 120,
          background: 'var(--surface)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
    ),
  },
);
