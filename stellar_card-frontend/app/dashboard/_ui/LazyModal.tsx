import dynamic from 'next/dynamic';

export const LazyModal = dynamic(
  () => import('./Modal').then((m) => ({ default: m.Modal })),
  {
    ssr: false,
    loading: () => null,
  },
);
