// Dynamic import wrapper for Drawer.
// Since drawers are typically hidden on initial page load, lazy-loading
// defers parsing/executing the drawer logic until it's actually needed.

import dynamic from 'next/dynamic';

export const LazyDrawer = dynamic(
  () => import('./Drawer').then((m) => ({ default: m.Drawer })),
  {
    ssr: false,
    loading: () => null,
  },
);
