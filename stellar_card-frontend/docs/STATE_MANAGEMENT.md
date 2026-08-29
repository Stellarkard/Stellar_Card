# Global Loading, Empty, and Error State System

This guide explains how to implement consistent loading, empty, and error states across the Stellar_Card frontend using the provided state management components and hooks.

## Overview

The state management system provides three core UI components and multiple hooks to handle async operations:

- **LoadingState** — Skeleton screens and loading indicators
- **EmptyState** — Empty data states with optional actions
- **ErrorState** — Error handling with retry capability
- **GlobalStateProvider** — Wrapper component that combines all three states
- **useAsyncState** — Hooks for managing async data fetching

## Components

### LoadingState

Displays skeleton screens while data is loading.

```typescript
import { LoadingState } from '@/app/components/LoadingState';

export function MyPage() {
  return <LoadingState lines={3} avatar title />;
}
```

**Props:**
- `lines?: number` — Number of skeleton lines (default: 3)
- `avatar?: boolean` — Show skeleton avatar
- `title?: boolean` — Show skeleton title
- `children?: ReactNode` — Custom loading message
- `className?: string` — CSS class

**Variants:**

```typescript
// Skeleton-only
<LoadingState lines={5} />

// With avatar
<LoadingState avatar title lines={4} />

// Custom message
<LoadingState>Processing your request…</LoadingState>

// Page-level loader
<PageLoadingSkeleton />
```

### EmptyState

Displays when no data is available.

```typescript
import { EmptyState } from '@/app/components/EmptyState';

export function AgentsList({ agents }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={<AgentIcon />}
        title="No agents yet"
        description="Create your first agent to get started"
        action={<CreateButton />}
      />
    );
  }
  return <AgentTable agents={agents} />;
}
```

**Props:**
- `title: string` — Main heading
- `description?: ReactNode` — Optional descriptive text
- `icon?: ReactNode` — Optional icon (top-left)
- `action?: ReactNode` — Optional CTA button or element
- `compact?: boolean` — Compact layout

**Example with action:**

```typescript
<EmptyState
  title="No data"
  description="Get started by creating a new item"
  action={
    <Link href="/create">
      <button>Create now</button>
    </Link>
  }
/>
```

### ErrorState

Displays error messages with optional retry button.

```typescript
import { ErrorState } from '@/app/components/ErrorState';

export function DataView() {
  const { error } = useAsyncState(fetchData);
  
  if (error) {
    return (
      <ErrorState
        title="Failed to load data"
        message={error.message}
        onRetry={() => window.location.reload()}
      />
    );
  }
}
```

**Props:**
- `title?: string` — Error heading (default: "Something went wrong")
- `message?: string` — Error description
- `digest?: string` — Error ID for support reference
- `onRetry?: () => void` — Retry callback
- `action?: ReactNode` — Additional action button

### GlobalStateProvider

Combines loading, empty, and error states in one component.

```typescript
import { GlobalStateProvider } from '@/app/components/GlobalStateProvider';
import { useAsyncState } from '@/app/lib/useAsyncState';

export function AgentsPage() {
  const { data: agents, status, error } = useAsyncState(fetchAgents);

  return (
    <GlobalStateProvider status={status} error={error} isEmpty={!agents?.length}>
      {() => <AgentTable agents={agents} />}
    </GlobalStateProvider>
  );
}
```

**Props:**
- `status: AsyncStatus` — Current async state ('idle', 'loading', 'success', 'error')
- `error?: Error | null` — Error object if status is 'error'
- `isEmpty?: boolean` — Show empty state if true
- `emptyTitle?: string` — Custom empty title
- `emptyDescription?: ReactNode` — Empty description
- `emptyAction?: ReactNode` — Empty CTA
- `emptyIcon?: ReactNode` — Empty icon
- `loadingLines?: number` — Number of skeleton lines
- `onRetry?: () => void` — Retry callback
- `children: () => ReactNode` — Render function (only called when status is 'success' and not empty)

## Hooks

### useAsyncState (Simple)

Minimal hook for basic async operations. Good for simple data fetches.

```typescript
import { useAsyncState } from '@/app/lib/useAsyncState';

async function fetchAgents() {
  const res = await fetch('/api/agents');
  return res.json();
}

export function AgentsList() {
  const { data, status, error, run } = useAsyncState(fetchAgents);

  return (
    <>
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState onRetry={run} />}
      {status === 'success' && <AgentTable agents={data} />}

      <button onClick={run}>Refresh</button>
    </>
  );
}
```

**Returns:**
- `data: T | null` — Fetched data
- `status: AsyncStatus` — Current state
- `loading: boolean` — True if status === 'loading'
- `error: Error | null` — Error object if failed
- `run: () => Promise<void>` — Manually re-run the fetch

### useAsyncState (Advanced)

Advanced hook with separate status checks. Better for complex state management.

```typescript
import { useAsyncState } from '@/app/dashboard/_lib/useAsyncState';

export function OrdersList() {
  const { execute, data, isLoading, isError, isEmpty, setEmpty } = useAsyncState<Order[]>();

  useEffect(() => {
    execute(fetch('/api/orders').then(r => r.json()));
  }, [execute]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;
  if (isEmpty) return <EmptyState title="No orders" />;
  
  return <OrderTable orders={data} />;
}
```

**Returns:**
- `data?: T` — Fetched data
- `status: State['status']` — Current state including 'empty'
- `isLoading: boolean` — True if loading
- `isSuccess: boolean` — True if success
- `isError: boolean` — True if error
- `isEmpty: boolean` — True if explicitly empty
- `error?: Error` — Error object
- `execute: (promise: Promise<T>) => Promise<T | undefined>` — Execute async operation
- `reset: () => void` — Reset to idle
- `setEmpty: () => void` — Mark as empty

## Patterns

### Pattern 1: Simple Page with GlobalStateProvider

```typescript
import { GlobalStateProvider } from '@/app/components/GlobalStateProvider';
import { useAsyncState } from '@/app/lib/useAsyncState';

export default function AgentsPage() {
  const { data, status, error } = useAsyncState(
    useCallback(() => fetch('/api/agents').then(r => r.json()), [])
  );

  return (
    <GlobalStateProvider
      status={status}
      error={error}
      isEmpty={!data?.length}
      emptyTitle="No agents yet"
      emptyDescription="Create your first agent to issue virtual cards"
      onRetry={() => run()}
    >
      {() => (
        <div>
          {data.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </GlobalStateProvider>
  );
}
```

### Pattern 2: Complex State with Tabs

```typescript
import { TabNav } from '@/app/components/TabNav';
import { GlobalStateProvider } from '@/app/components/GlobalStateProvider';
import { useAsyncState } from '@/app/dashboard/_lib/useAsyncState';

export function OrdersPage() {
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const { execute, data, status, error } = useAsyncState<Order[]>();

  const tabs = [
    { href: '?tab=pending', label: 'Pending', badge: data?.filter(o => o.status === 'pending').length || 0 },
    { href: '?tab=completed', label: 'Completed' },
  ];

  useEffect(() => {
    const url = tab === 'completed' ? '/api/orders/completed' : '/api/orders/pending';
    execute(fetch(url).then(r => r.json()));
  }, [tab]);

  return (
    <>
      <TabNav tabs={tabs} />
      <GlobalStateProvider status={status} error={error} isEmpty={!data?.length}>
        {() => <OrderTable orders={data} />}
      </GlobalStateProvider>
    </>
  );
}
```

### Pattern 3: Manual State Management

For fine-grained control over individual states:

```typescript
export function CustomComponent() {
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setState('success');
      })
      .catch(e => {
        setError(e);
        setState('error');
      });
  }, []);

  if (state === 'loading') return <LoadingState />;
  if (state === 'error') return <ErrorState title={error?.message} />;
  
  return <DataDisplay data={data} />;
}
```

## Best Practices

### ✅ Do's

- Use `GlobalStateProvider` to wrap entire pages with async data
- Use `useCallback` to prevent unnecessary re-renders when passing async functions
- Set `emptyTitle` and `emptyDescription` for context-specific empty states
- Use the `run()` / `execute()` function for manual retry
- Test all three states (loading, empty, error) in Storybook

### ❌ Don'ts

- Don't nest `GlobalStateProvider` too deeply—one per page max
- Don't create new async functions on every render (use `useCallback`)
- Don't forget to handle the empty case—it's different from loading
- Don't show both loading and error states simultaneously
- Don't expose error messages directly to users without sanitizing

## Testing

### Test Loading State

```typescript
export const Loading: StoryObj = {
  render: () => (
    <GlobalStateProvider status="loading">
      {() => <div>Should not render</div>}
    </GlobalStateProvider>
  ),
};
```

### Test Empty State

```typescript
export const Empty: StoryObj = {
  render: () => (
    <GlobalStateProvider
      status="success"
      isEmpty={true}
      emptyTitle="No data"
    >
      {() => <div>Should not render</div>}
    </GlobalStateProvider>
  ),
};
```

### Test Error State

```typescript
export const Error: StoryObj = {
  render: () => (
    <GlobalStateProvider
      status="error"
      error={new Error('Network timeout')}
      onRetry={() => console.log('Retrying…')}
    >
      {() => <div>Should not render</div>}
    </GlobalStateProvider>
  ),
};
```

## Accessibility

All state components include proper ARIA attributes:

- Loading states have `role="status"` for screen reader announcements
- Error states include error message and optional error digest for support
- Empty states are focused when rendered so screen readers announce them
- Retry buttons are clearly labeled with `aria-label`

## Troubleshooting

### Data not updating?

Ensure you're passing a new function reference or wrapping with `useCallback`:

```typescript
// ❌ Wrong: new function on every render
<GlobalStateProvider status={status}>
  {() => fetch('/api/data').then(r => r.json())}
</GlobalStateProvider>

// ✅ Correct: stable function reference
const fetchData = useCallback(() => 
  fetch('/api/data').then(r => r.json()), 
[]
);
const { data, status } = useAsyncState(fetchData);
```

### Showing wrong state?

Check the order of conditions. `isEmpty` is only checked when `status === 'success'`:

```typescript
// ✅ Correct: only checks isEmpty when success
<GlobalStateProvider status={status} isEmpty={!data?.length}>
```

### Error not showing?

Make sure to pass both `status="error"` and the `error` object:

```typescript
<GlobalStateProvider
  status={status}
  error={error}  // Don't forget this!
  onRetry={run}
>
```
