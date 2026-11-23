// Verifies the analytics chart wrappers in app/lib/dynamic-imports.tsx
// render a SectionLoadingState skeleton (with a reserved, height-matched
// box) while their code-split chunk is still loading.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DynamicSpendChart, DynamicHorizontalBar } from '../lib/dynamic-imports';

describe('Analytics chart lazy loading', () => {
  it('exposes the code-split chart wrappers', () => {
    expect(DynamicSpendChart).toBeDefined();
    expect(DynamicHorizontalBar).toBeDefined();
  });

  it('serves the SectionLoadingState skeleton while the chunk loads', () => {
    // Server rendering never runs the IntersectionObserver effect, so
    // LazyLoad renders its fallback — the same loading state a user sees
    // until the deferred chart chunk resolves.
    const markup = renderToStaticMarkup(<DynamicSpendChart data={[]} height={220} />);

    expect(markup).toContain('data-test="chart-loading-skeleton"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('skeleton-shimmer');
  });

  it('reserves the chart height in the placeholder to avoid layout shift', () => {
    const markup = renderToStaticMarkup(<DynamicSpendChart data={[]} height={220} />);

    // Plot area (220) + reserved axis/caption chrome (48).
    expect(markup).toContain('height:268px');
    expect(markup).toContain('min-height:268px');
  });
});
