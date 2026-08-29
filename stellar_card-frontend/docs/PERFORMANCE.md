# Performance Optimization Guide

This guide covers bundle optimization, code splitting, and runtime performance strategies for the Stellar_Card frontend.

## Bundle Size Analysis

### Run Bundle Analysis

```bash
npm run build:analyze
```

This generates a build report showing chunk sizes and identifies optimization opportunities. The threshold is 300 KB total JS—if exceeded, consider the strategies below.

### Current Optimization Strategy

The `next.config.ts` implements webpack chunk splitting that separates code into predictable layers:

1. **Framework chunk** (`framework.*.js`)
   - React, ReactDOM, scheduler
   - Changes rarely, highly cacheable
   - Priority: 40

2. **Library chunks** (`lib.next.*.js`, `lib.geist.*.js`)
   - Next.js internals and component libraries
   - Updates with framework upgrades
   - Priority: 30
   - Minimum 1 shared import (every library chunk must appear in at least 1 other chunk to split)

3. **Vendors chunk** (`vendors.*.js`)
   - All other node_modules packages
   - Shared dependencies from multiple routes
   - Priority: 20
   - Minimum 2 shared imports (only chunks reused by 2+ entrypoints split here)

4. **App chunks** (route-specific JS)
   - Page-level and component code
   - Loaded on-demand per route
   - Individually cacheable

## Code Splitting Patterns

### Dynamic Imports (Route-based)

For heavy features that aren't on the homepage or critical paths, use dynamic imports with `next/dynamic`:

```typescript
// ✅ Good: Defers loading until route visits
import dynamic from 'next/dynamic';

const Analytics = dynamic(() => import('./Analytics'), {
  loading: () => <LoadingState />,
});

export default function AnalyticsPage() {
  return <Analytics />;
}
```

### Lazy Component Loading

For components only shown conditionally, use dynamic imports:

```typescript
// ✅ Good: Only loads when expanded
const DetailedMetrics = dynamic(() => import('./DetailedMetrics'), {
  ssr: false, // Only needed on client
  loading: () => <Skeleton />,
});

export function MetricsPanel({ expanded }) {
  return (
    <>
      {expanded && <DetailedMetrics />}
    </>
  );
}
```

### Client Component Boundaries

Mark components as client components with `'use client'` only when necessary—too many creates a cascading effect that prevents tree-shaking:

```typescript
// ✅ Good: Minimal client boundary
'use client';
import { usePathname } from 'next/navigation';

export function NavLinks() {
  // Only this component needs client features
}
```

```typescript
// ❌ Avoid: Spreads client requirement up the tree
'use client';
export function PageLayout() {
  return <NavLinks />; // Now NavLinks can't be server-side
}
```

## Image Optimization

### Responsive Images

Use the Next.js Image component with responsive sizes:

```typescript
import Image from 'next/image';

export function Card() {
  return (
    <Image
      src="/card.png"
      alt="Virtual card"
      width={384}
      height={600}
      sizes="(max-width: 640px) 90vw, (max-width: 900px) 70vw, 50vw"
      priority={false} // Only set true for above-the-fold images
    />
  );
}
```

### Static Assets

- Store images in `/public` (CDN-cached)
- Use WebP format with JPEG fallback
- Compress with tools like ImageOptim or TinyPNG before committing

## Font Loading

Fonts are loaded at build time via `next/font/google`. Each font file counts toward bundle size:

### Current Setup (see `app/layout.tsx`)

- **Fraunces** (display) — only loaded for hero/headings, ~15 KB
- **IBM Plex Sans** (body) — primary typeface, ~35 KB
- **IBM Plex Mono** (data) — code blocks/numbers, ~25 KB

Keep font subset usage minimal to avoid bloat.

## Runtime Performance

### Memoization

Memoize expensive computations at component boundaries:

```typescript
import { memo } from 'react';

export const Card = memo(function Card({ data }) {
  return <div>{expensiveRender(data)}</div>;
});
```

### List Virtualization

For long lists (100+ items), use virtualization to render only visible rows:

```typescript
import { FixedSizeList } from 'react-window';

export function AgentList({ agents }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={agents.length}
      itemSize={50}
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>{agents[index].name}</div>
      )}
    </FixedSizeList>
  );
}
```

## Monitoring

### Web Vitals

Monitor Core Web Vitals in production:

- **LCP** (Largest Contentful Paint) — target < 2.5s
- **FID** (First Input Delay) — target < 100ms (replaced by INP in 2024)
- **CLS** (Cumulative Layout Shift) — target < 0.1

Track via Google Analytics or WebVitals library:

```typescript
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

export function reportWebVitals(metric) {
  console.log(metric);
  // Send to analytics service
}
```

### Bundle Size CI/CD

Add to your CI pipeline to catch regressions:

```bash
npm run build:analyze && node -e "
  const totalSize = process.env.JS_SIZE_KB || 0;
  if (totalSize > 350) {
    console.error('❌ Bundle size exceeds 350 KB');
    process.exit(1);
  }
"
```

## Checklist

- [ ] Run `npm run build:analyze` after adding dependencies
- [ ] Use dynamic imports for routes > 100 KB
- [ ] Keep client component boundaries minimal
- [ ] Optimize images before commit
- [ ] Set `priority` prop only for above-the-fold images
- [ ] Test on slow 4G network (Chrome DevTools)
- [ ] Monitor Core Web Vitals in production
