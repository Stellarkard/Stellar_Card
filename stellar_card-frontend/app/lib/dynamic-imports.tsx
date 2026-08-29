// Dynamic import wrappers for heavy components. Next.js code-splits
// at the dynamic() boundary so these only load when their parent
// route renders. The `ssr: false` flag skips server rendering for
// components that depend on browser APIs (window, pointer events,
// requestAnimationFrame).
//
// Rule of thumb: any component that:
//   (a) depends on browser globals (window, canvas, requestAnimationFrame), or
//   (b) exceeds ~10 kB gzipped and is not needed above-the-fold
// should be wrapped here so marketing and initial dashboard loads stay fast.

'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '../components/LoadingState';

// ── Marketing surface ────────────────────────────────────────────────

export const DynamicHeroCard = dynamic(
  () => import('../components/HeroCard').then((mod) => mod.HeroCard),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
        <LoadingState>Loading card…</LoadingState>
      </div>
    ),
  }
);

export const DynamicHeroScene = dynamic(
  () => import('../components/HeroCard').then((mod) => mod.HeroScene),
  { ssr: false }
);

// ── Dashboard charts + heavy widgets ────────────────────────────────

export const DynamicSpendChart = dynamic(
  () => import('../dashboard/_ui/SpendChart').then((mod) => mod.SpendChart),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingState>Loading chart…</LoadingState>
      </div>
    ),
  }
);

export const DynamicQrCode = dynamic(
  () => import('../dashboard/_ui/QrCode').then((mod) => mod.QrCode),
  { ssr: false }
);

// ── Dashboard shell — deferred until after first paint ───────────────
// CommandPalette is only needed when the user presses ⌘K; loading it
// eagerly adds ~6 kB to every dashboard page initial JS.

export const DynamicCommandPalette = dynamic(
  () => import('../dashboard/_shell/CommandPalette').then((mod) => mod.CommandPalette),
  { ssr: false }
);

// CreateAgentDrawer is heavy (form + validation logic). Defer until the
// user explicitly opens it.
export const DynamicCreateAgentDrawer = dynamic(
  () => import('../dashboard/_shell/CreateAgentDrawer').then((mod) => mod.CreateAgentDrawer),
  { ssr: false }
);

// Onboarding modal is only needed for first-time users; skip entirely
// for returning users who have dismissed it.
export const DynamicOnboardingModal = dynamic(
  () => import('../dashboard/_shell/OnboardingModal').then((mod) => mod.OnboardingModal),
  { ssr: false }
);
