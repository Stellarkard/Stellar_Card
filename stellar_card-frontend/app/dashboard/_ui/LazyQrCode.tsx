import dynamic from 'next/dynamic';

export const LazyQrCode = dynamic(
  () => import('./QrCode').then((m) => ({ default: m.QrCode })),
  {
    ssr: false,
    loading: () => null,
  },
);
