# Bundle Optimization Guide

This guide explains code splitting and lazy loading strategies in the Stellar Card frontend.

## Overview

Bundle size impacts:
- Initial page load time
- Time to interactive (TTI)
- Mobile performance
- First Contentful Paint (FCP)

We use Next.js dynamic imports to split heavy components into separate chunks.

## Lazy-Loaded Components

### Charts

**LazySpendChart**
- Used for time-series spend visualization
- Performs SVG path calculations
- Lazy loads on dashboard pages
- Falls back to loading skeleton

```tsx
import { LazySpendChart } from '@/app/dashboard/_ui/LazySpendChart';

export default function Dashboard() {
  return <LazySpendChart data={...} />;
}
```

**LazyHorizontalBar**
- Used for categorical data visualization
- Calculates bar widths and positions
- Lazy loads on analytics pages
- Best for rows with 10+ items

```tsx
import { LazyHorizontalBar } from '@/app/dashboard/_ui/LazyHorizontalBar';

export default function Analytics() {
  return <LazyHorizontalBar rows={...} />;
}
```

### Modals & Drawers

**LazyDrawer**
- Sliding side panel for details
- Hidden on page load, only visible on demand
- Deferred until user interaction
- No SSR (client-only)

```tsx
import { LazyDrawer } from '@/app/dashboard/_ui/LazyDrawer';

export default function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Details</button>
      <LazyDrawer open={open} onClose={() => setOpen(false)}>
        {/* Content */}
      </LazyDrawer>
    </>
  );
}
```

## When to Lazy-Load

Use dynamic imports for:
- **Heavy calculations**: SVG rendering, complex math
- **Large dependencies**: Chart libraries, data processors
- **Hidden on load**: Modals, drawers, popovers, tooltips
- **Below-the-fold content**: Features users must scroll to see
- **Route-based sections**: Pages only some users visit

Do NOT lazy-load:
- Core UI elements (buttons, inputs, cards)
- Above-the-fold content (hero, header)
- Components rendering immediately on load
- Small components (<5KB minified)

## Analysis

Check your bundle size:

```bash
npm run analyze
```

This builds and generates a visual breakdown of all chunks.

## Best Practices

### 1. Loading States
Always provide meaningful loading feedback:

```tsx
const LazyChart = dynamic(
  () => import('./Chart').then(m => ({ default: m.Chart })),
  {
    loading: () => <ChartSkeleton />,
  }
);
```

### 2. Error Boundaries
Wrap lazy components for resilience:

```tsx
<Suspense fallback={<Skeleton />}>
  <LazyChart {...props} />
</Suspense>
```

### 3. Hydration
Use `ssr: false` for client-only components:

```tsx
dynamic(() => import('./Drawer'), { ssr: false })
```

### 4. Naming Convention
Prefix lazy wrappers with `Lazy`:
- `Drawer.tsx` → `LazyDrawer.tsx`
- `SpendChart.tsx` → `LazySpendChart.tsx`

### 5. Document Decisions
Include comments explaining why something is lazy-loaded:

```tsx
// Dynamic import wrapper for HorizontalBar.
// HorizontalBar calculates positions for many rows, so lazy-loading
// defers this work until the chart is actually visible.
```

## Measuring Impact

### Before & After

Run `npm run build` and check `.next/static/chunks/`:

```
main-xxxx.js          <- Main bundle
pages-[id]-xxxx.js    <- Route-specific code
_ui-LazyChart-xxxx.js <- Lazy component chunk
```

Smaller main bundle = faster initial load.

### Real Performance

Use Chrome DevTools:
1. **Coverage** tab: shows unused JS
2. **Network** tab: monitors chunk downloads
3. **Performance** tab: measures TTI improvements

## Common Patterns

### Lazy Modal Example

```tsx
import dynamic from 'next/dynamic';
import { useState } from 'react';

const LazyOrderDetail = dynamic(
  () => import('./OrderDetail').then(m => ({ default: m.OrderDetail })),
  { ssr: false, loading: () => null }
);

export default function OrderList() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      {/* List content */}
      <LazyOrderDetail open={!!selected} orderId={selected} />
    </>
  );
}
```

### Lazy Chart Example

```tsx
import dynamic from 'next/dynamic';

const LazyChart = dynamic(
  () => import('./Chart').then(m => ({ default: m.Chart })),
  {
    ssr: true,
    loading: () => <div style={{height: 200}}>Loading…</div>,
  }
);

export default function Analytics() {
  return <LazyChart data={...} />;
}
```

## Future Improvements

- Route-based code splitting
- Third-party script deferral
- Image optimization pass
- CSS chunking strategy
- Web Workers for heavy computation
