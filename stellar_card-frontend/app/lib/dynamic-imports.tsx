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
import { LazyLoad } from '../components/LazyLoad';
import { SectionLoadingState } from '../components/SectionLoadingState';

// ── Chart loading placeholder ────────────────────────────────────────
// The SVG charts below render their plot area at the caller-supplied
// `height` plus an x-axis label row and a caption underneath. Reserving
// that chrome in the placeholder keeps the surrounding card's box stable
// from skeleton → chart, so the deferred chunk never triggers layout
// shift. Reusing SectionLoadingState keeps chart loading visually
// consistent with every other async section in the app.
const CHART_CHROME_PX = 48;

interface ChartSkeletonProps {
  /** Plot-area height the real chart renders at. */
  height?: number;
}

function ChartSkeleton({ height = 200 }: ChartSkeletonProps) {
  return (
    <div
      data-test="chart-loading-skeleton"
      aria-busy="true"
      style={{
        height: height + CHART_CHROME_PX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SectionLoadingState status="loading" variant="compact" loadingLines={4}>
        {() => null}
      </SectionLoadingState>
    </div>
  );
}

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

// SpendChart is client-only (SVG geometry memoised over the full series),
// so it gets both layers of deferral: `dynamic` splits it into its own
// chunk and `LazyLoad` keeps that chunk from being fetched until the chart
// scrolls into view. The min-height wrapper plus the height-matched
// skeleton hold the card's box so nothing below it shifts on mount.
interface SpendChartProps {
  data: Array<{ date: string; amount: number; count: number }>;
  height?: number;
}

const SpendChartChunk = dynamic(
  () => import('../dashboard/_ui/SpendChart').then((mod) => mod.SpendChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function DynamicSpendChart({ data, height = 200 }: SpendChartProps) {
  return (
    <div style={{ minHeight: height + CHART_CHROME_PX }}>
      <LazyLoad fallback={<ChartSkeleton height={height} />}>
        <SpendChartChunk data={data} height={height} />
      </LazyLoad>
    </div>
  );
}

// HorizontalBar is pure SVG with no browser globals, so it stays server
// rendered (`ssr: true`) — only its chunk is split out. The skeleton still
// covers the client-navigation window while that chunk is fetching.
export const DynamicHorizontalBar = dynamic(
  () => import('../dashboard/_ui/HorizontalBar').then((mod) => mod.HorizontalBar),
  {
    ssr: true,
    loading: () => <ChartSkeleton height={140} />,
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
