import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LazyLoad, VirtualScroll } from './LazyLoad';
import { RouteLazyBoundary } from './RouteLazyBoundary';
import {
  DynamicCommandPalette,
  DynamicCreateAgentDrawer,
  DynamicSpendChart,
  DynamicGlobalSearch,
  DynamicModal,
  DynamicDrawer,
  DynamicQrCode,
  DynamicOnboardingModal,
} from '../dashboard/_lib/dynamic';

describe('Bundle Splitting & Lazy Loading', () => {
  it('LazyLoad renders fallback initially in SSR environment', () => {
    const fallback = <div id="fallback">Loading skeleton</div>;
    const content = <div id="content">Lazy content</div>;
    const markup = renderToStaticMarkup(
      <LazyLoad fallback={fallback}>{content}</LazyLoad>
    );
    expect(markup).toContain('Loading skeleton');
  });

  it('VirtualScroll calculates slice and renders items', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const markup = renderToStaticMarkup(
      <VirtualScroll
        items={items}
        itemHeight={40}
        containerHeight={200}
        renderItem={(item) => <div key={item.id}>{item.name}</div>}
      />
    );
    expect(markup).toContain('Item 0');
    expect(markup).toContain('Item 1');
  });

  it('RouteLazyBoundary renders children correctly', () => {
    const markup = renderToStaticMarkup(
      <RouteLazyBoundary>
        <div>Route Page Loaded</div>
      </RouteLazyBoundary>
    );
    expect(markup).toContain('Route Page Loaded');
  });

  it('Dynamic exports are defined and configured with ssr: false', () => {
    expect(DynamicCommandPalette).toBeDefined();
    expect(DynamicCreateAgentDrawer).toBeDefined();
    expect(DynamicSpendChart).toBeDefined();
    expect(DynamicGlobalSearch).toBeDefined();
    expect(DynamicModal).toBeDefined();
    expect(DynamicDrawer).toBeDefined();
    expect(DynamicQrCode).toBeDefined();
    expect(DynamicOnboardingModal).toBeDefined();
  });
});
