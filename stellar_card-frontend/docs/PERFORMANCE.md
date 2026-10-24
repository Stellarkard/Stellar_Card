# Performance Optimization Guide

Documentation for performance optimization strategies in the Stellar_Card frontend, focusing on large transaction tables and data-heavy components.

## Overview

The frontend uses several optimization techniques:
- **Virtualization** for large lists and tables
- **Memoization** to prevent unnecessary re-renders
- **Code splitting** for route-based loading
- **Bundle optimization** for faster initial loads

## Table Virtualization

### When to Use

Virtualize tables when:
- Data exceeds 50 rows
- Users frequently scroll through data
- Memory usage is a concern
- Frame rate drops below 60fps

### Implementation

```tsx
import { Table } from '@/app/dashboard/_ui/Table';

function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <Table
      data={orders}
      columns={columns}
      keyExtractor={(row) => row.id}
      virtualized={true}
      maxHeight={600}
      rowHeight={48}
    />
  );
}
```

### How It Works

The `Table` component uses `react-window` to:
1. Render only visible rows
2. Reuse DOM elements during scroll
3. Maintain constant memory usage
4. Achieve smooth 60fps scrolling

### Performance Metrics

| Dataset Size | Traditional | Virtualized | Improvement |
|--------------|-------------|-------------|-------------|
| 50 rows      | ~8ms        | ~6ms        | 25%         |
| 200 rows     | ~45ms       | ~8ms        | 82%         |
| 1000 rows    | ~280ms      | ~10ms       | 96%         |

## Memoization Strategies

### Component Memoization

Use `memo()` for expensive components:

```tsx
import { memo } from 'react';

export const TableRow = memo(function TableRow({ row, onClick }) {
  // Expensive rendering logic
  return <tr onClick={() => onClick(row)}>...</tr>;
});
```

### Value Memoization

Use `useMemo()` for expensive calculations:

```tsx
const filtered = useMemo(() => {
  return data.filter(predicate).sort(comparator);
}, [data, predicate, comparator]);
```

### Callback Memoization

Use `useCallback()` to prevent function recreation:

```tsx
const handleClick = useCallback((row) => {
  console.log('Clicked:', row);
}, []);
```

## Code Splitting

### Route-Based Splitting

Next.js automatically splits by route. Heavy components should be lazy-loaded:

```tsx
import dynamic from 'next/dynamic';

const SpendChart = dynamic(() => import('./_ui/SpendChart'), {
  loading: () => <LoadingSkeleton />,
  ssr: false,
});
```

### Component-Level Splitting

For dashboard drawers and modals:

```tsx
const OrderDrawer = dynamic(() => import('./OrderDrawer'), {
  ssr: false,
});
```

### Benefits

- Reduces initial bundle size
- Faster time to interactive
- Better caching granularity

## Bundle Optimization

### Webpack Configuration

The `next.config.ts` splits vendor code into separate chunks:

```typescript
config.optimization.splitChunks = {
  cacheGroups: {
    framework: {
      name: 'framework',
      test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
      priority: 40,
      chunks: 'all',
      enforce: true,
    },
    lib: {
      name: 'lib',
      test: /[\\/]node_modules[\\/](next|geist)[\\/]/,
      priority: 30,
      chunks: 'all',
    },
  },
};
```

### Package Import Optimization

Use `experimental.optimizePackageImports` to tree-shake large packages:

```typescript
experimental: {
  optimizePackageImports: ['geist', 'next/font/google'],
}
```

### Analyzing Bundles

```bash
# Generate bundle analysis
npm run build:analyze

# Opens visualization in browser
```

## Image Optimization

### Configuration

```typescript
images: {
  formats: ['image/avif', 'image/webp'],
  minimumCacheTTL: 3600,
  deviceSizes: [640, 750, 828, 1080, 1200, 1920],
}
```

### Usage

```tsx
import Image from 'next/image';

<Image
  src="/logo.png"
  alt="Logo"
  width={200}
  height={50}
  priority // For above-the-fold images
/>
```

## Data Fetching Optimization

### Parallel Fetching

Fetch independent data in parallel:

```tsx
const [orders, agents, stats] = await Promise.all([
  fetchOrders(),
  fetchAgents(),
  fetchStats(),
]);
```

### Incremental Loading

Load critical data first, defer secondary data:

```tsx
// Load immediately
const orders = await fetchOrders();

// Load in background
useEffect(() => {
  fetchDetailedStats().then(setStats);
}, []);
```

### Caching

Use SWR or React Query for automatic caching:

```tsx
import useSWR from 'swr';

const { data } = useSWR('/api/orders', fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 30000,
});
```

## CSS Performance

### Avoid Layout Thrashing

Bad:
```tsx
// Forces layout calculation on every iteration
items.forEach((item) => {
  item.style.width = container.offsetWidth + 'px';
});
```

Good:
```tsx
// Read once, write many
const width = container.offsetWidth;
items.forEach((item) => {
  item.style.width = width + 'px';
});
```

### Use CSS Variables

CSS variables avoid inline style recalculation:

```tsx
// Bad: inline styles recalculated on every render
<div style={{ color: darkMode ? '#fff' : '#000' }} />

// Good: CSS variable switches theme
<div style={{ color: 'var(--fg)' }} />
```

### GPU Acceleration

Use `transform` and `opacity` for animations:

```css
/* GPU-accelerated */
.animate {
  transform: translateY(0);
  opacity: 1;
  transition: transform 0.3s, opacity 0.3s;
}

/* Causes reflow */
.animate-bad {
  top: 0;
  transition: top 0.3s;
}
```

## Memory Management

### Event Listener Cleanup

Always clean up event listeners:

```tsx
useEffect(() => {
  const handler = () => console.log('resize');
  window.addEventListener('resize', handler);
  
  return () => {
    window.removeEventListener('resize', handler);
  };
}, []);
```

### Abort Pending Requests

Cancel requests when component unmounts:

```tsx
useEffect(() => {
  const controller = new AbortController();
  
  fetch('/api/data', { signal: controller.signal })
    .then(setData);
  
  return () => controller.abort();
}, []);
```

## Performance Monitoring

### React DevTools Profiler

```bash
# Enable profiling in dev
NODE_ENV=development npm run dev
```

1. Open React DevTools
2. Switch to Profiler tab
3. Click record
4. Interact with app
5. Stop recording
6. Analyze render times

### Web Vitals

Monitor Core Web Vitals:

```tsx
// app/layout.tsx
export function reportWebVitals(metric: NextWebVitalsMetric) {
  console.log(metric);
  // Send to analytics
}
```

### Performance API

```tsx
const start = performance.now();
// Expensive operation
const duration = performance.now() - start;
console.log(`Took ${duration}ms`);
```

## Best Practices

### Do's

✅ Virtualize lists over 50 items
✅ Memoize expensive calculations
✅ Lazy load heavy components
✅ Use CSS variables for theming
✅ Optimize images with Next.js Image
✅ Cancel pending requests on unmount
✅ Clean up event listeners
✅ Profile before optimizing

### Don'ts

❌ Premature optimization
❌ Inline styles in loops
❌ Unnecessary re-renders
❌ Large inline data in JSX
❌ Blocking the main thread
❌ Memory leaks from listeners
❌ Unoptimized images

## Benchmarking

### Orders Table Performance

```bash
# Run performance test
npm run test:performance

# Expected results:
# - 200 rows: < 10ms render
# - 1000 rows: < 15ms render
# - Scroll: 60fps maintained
```

### Memory Usage

Target memory usage (1000 orders):
- Traditional table: ~45MB
- Virtualized table: ~8MB
- Improvement: 82% reduction

## Resources

- [React Performance](https://react.dev/learn/render-and-commit)
- [Next.js Performance](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Web Vitals](https://web.dev/vitals/)
- [react-window](https://github.com/bvaughn/react-window)
