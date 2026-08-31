// Dynamic imports for heavy dashboard pages and components.
//
// Using next/dynamic keeps each shell component out of the initial JS
// bundle. The dashboard shell boots immediately — only the heavy
// modals/drawers/chart code is deferred until first render.
//
// ssr: false   — these are client-only interactive components; SSR
//               would add work for no gain (dashboard is auth-gated).

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

export const DynamicModal = dynamic(
  () => import('../_ui/Modal').then((m) => ({ default: m.Modal })),
  { ssr: false },
);

export const DynamicDrawer = dynamic(
  () => import('../_ui/Drawer').then((m) => ({ default: m.Drawer })),
  { ssr: false },
);

export const DynamicQrCode = dynamic(
  () => import('../_ui/QrCode').then((m) => ({ default: m.QrCode })),
  { ssr: false },
);

export const DynamicOnboardingModal = dynamic(
  () => import('../_shell/OnboardingModal').then((m) => ({ default: m.OnboardingModal })),
  { ssr: false },
);
