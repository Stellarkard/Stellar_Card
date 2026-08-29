// Dynamic imports for heavy dashboard pages and components (#133).
//
// Using next/dynamic keeps each shell component out of the initial JS
// bundle. The dashboard shell still boots immediately — only the heavy
// modals/drawers/chart code is deferred until first render.
//
// ssr: false   — these are client-only interactive components; SSR
//               would add work for no gain (dashboard is auth-gated).
// loading: undefined — callers provide their own loading state via
//               Suspense / skeleton patterns already in place.

import dynamic from 'next/dynamic';

export const DynamicCommandPalette = dynamic(
  () => import('../_shell/CommandPalette').then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);

export const DynamicCreateAgentDrawer = dynamic(
  () => import('../_shell/CreateAgentDrawer').then((m) => ({ default: m.CreateAgentDrawer })),
  { ssr: false },
);

export const DynamicSpendChart = dynamic(
  () => import('../_ui/SpendChart').then((m) => ({ default: m.SpendChart })),
  { ssr: false },
);

export const DynamicGlobalSearch = dynamic(
  () => import('../_shell/GlobalSearch').then((m) => ({ default: m.GlobalSearch })),
  { ssr: false },
);
