# Global State System Guide

This guide documents the comprehensive global loading, empty, and error state system implemented in Stellar Card frontend.

## Overview

The state system provides a unified approach to handling async data states across the application:
- **Loading**: Skeleton loaders and loading spinners
- **Empty**: Empty state UI when no data is available
- **Error**: Error boundaries and recovery UI
- **Success**: Regular content rendering

## Components

### GlobalStateProvider

Main component for handling page-level state. Wraps content and renders appropriate UI based on async status.

```tsx
import { GlobalStateProvider } from '@/components';
import { useAsyncState } from '@/lib/useAsyncState';

function MyPage() {
  const { status, data, error } = useAsyncState(async () => {
    return await fetchData();
  });

  return (
    <GlobalStateProvider status={status} error={error} isEmpty={!data?.length}>
      {() => <Content data={data} />}
    </GlobalStateProvider>
  );
}
```

### SectionLoadingState

Handles state for individual sections within a page. Supports compact variant for inline use.

```tsx
import { SectionLoadingState } from '@/components';

function Section() {
  const { status, data, error } = useAsyncState(fetchSectionData);

  return (
    <SectionLoadingState
      status={status}
      error={error}
      isEmpty={!data?.length}
      variant="compact"
      emptyTitle="No items"
    >
      {() => <ItemList items={data} />}
    </SectionLoadingState>
  );
}
```

### LoadingState

Renders skeleton loaders and loading spinners.

```tsx
import { LoadingState, Skeleton } from '@/components';

// Simple skeleton
<Skeleton width="100%" height={20} />

// Loading state with multiple lines
<LoadingState lines={3} />

// Loading with avatar
<LoadingState avatar title />

// Full page loading
<PageLoadingSkeleton />
```

### ErrorState

Displays error messages with optional retry action.

```tsx
import { ErrorState } from '@/components';

<ErrorState
  title="Failed to load"
  message="Please check your connection"
  onRetry={() => refetch()}
/>
```

### EmptyState

Shows when no data is available.

```tsx
import { EmptyState } from '@/components';

<EmptyState
  title="No data found"
  description="Try adjusting your filters"
  action={<button>Clear filters</button>}
  icon={<EmptyIcon />}
  compact={true}
/>
```

## Navigation System

### ResponsiveNav

Flexible navigation component supporting desktop and mobile layouts.

```tsx
import { ResponsiveNav } from '@/components';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: <Icon /> },
  { href: '/settings', label: 'Settings' },
];

<ResponsiveNav
  items={items}
  variant="horizontal"
  onNavigate={(href) => console.log(href)}
/>
```

Variants:
- `horizontal`: Hamburger menu on mobile, horizontal nav on desktop
- `vertical`: Vertical stacked menu
- `sidebar`: Sticky sidebar navigation

## Onboarding System

Create guided onboarding flows for first-time users.

```tsx
import {
  OnboardingProvider,
  OnboardingModal,
  useOnboarding,
} from '@/components';

const steps = [
  {
    id: 'welcome',
    title: 'Welcome to Stellar Card',
    description: 'Learn the basics in 2 minutes',
  },
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    description: 'Manage your cards here',
  },
];

function App() {
  return (
    <OnboardingProvider
      steps={steps}
      onComplete={() => console.log('Done!')}
      storageKey="user-onboarding"
    >
      <YourApp />
      <OnboardingModal showProgress showSkip />
    </OnboardingProvider>
  );
}

// In any component
function DashboardButton() {
  const { currentStep } = useOnboarding();
  return (
    <OnboardingTooltip stepId="dashboard">
      <button>Dashboard</button>
    </OnboardingTooltip>
  );
}
```

## Performance Features

### LazyLoad

Defer rendering of components until they're visible.

```tsx
import { LazyLoad } from '@/components';

<LazyLoad
  threshold={0.1}
  fallback={<Skeleton />}
  onVisible={() => fetchData()}
>
  <ExpensiveComponent />
</LazyLoad>
```

### VirtualScroll

Render large lists efficiently.

```tsx
import { VirtualScroll } from '@/components';

<VirtualScroll
  items={largeArray}
  itemHeight={50}
  containerHeight={400}
  renderItem={(item, index) => <Item key={index} data={item} />}
/>
```

### Performance Utilities

```tsx
import {
  createOptimizedComponent,
  debounce,
  throttle,
  memoizeAsync,
} from '@/lib/performance';

// Memoized component
const OptimizedList = createOptimizedComponent(MyList, 'OptimizedList');

// Debounce search
const handleSearch = debounce((query) => {
  search(query);
}, 300);

// Throttle scroll events
const handleScroll = throttle(() => {
  updateUI();
}, 100);

// Cache async operations
const getCachedData = memoizeAsync(fetchData, 60000);
```

## Best Practices

1. Use `GlobalStateProvider` for page-level async data
2. Use `SectionLoadingState` for section-level data within pages
3. Always provide meaningful loading states with skeleton loaders
4. Set appropriate empty state messages to guide users
5. Implement error recovery with retry actions
6. Use `LazyLoad` for below-the-fold content
7. Use `VirtualScroll` for lists over 100 items
8. Wrap expensive components with `createOptimizedComponent`
9. Use debounce for search and input handlers
10. Use throttle for scroll and resize events

## Customization

All components use CSS custom properties for theming:
- `--surface`: Background colors
- `--fg`: Foreground/text colors
- `--border`: Border colors
- `--green`: Primary action color
- `--ease-out`: Standard easing function

Customize by setting these in your CSS or theme provider.
