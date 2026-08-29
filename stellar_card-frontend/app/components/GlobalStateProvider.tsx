// GlobalStateProvider — renders the correct loading / empty / error UI
// based on async data state. Accepts children as a render prop so
// consuming pages stay clean:
//
//   <GlobalStateProvider status={status} error={error} isEmpty={!data.length}>
//     {() => <MyContent data={data} />}
//   </GlobalStateProvider>
//
// All three fallback renders delegate to the shared LoadingState,
// EmptyState, and ErrorState primitives so the visual language is
// consistent across every page.

'use client';

import type { ReactNode } from 'react';
import type { AsyncStatus } from '../lib/useAsyncState';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

interface Props {
  status: AsyncStatus;
  error?: Error | null;
  /** Evaluated only when status === 'success'. */
  isEmpty?: boolean;
  /** Shown when isEmpty is true. */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  /** Shown while loading. */
  loadingLines?: number;
  /** Callback passed to ErrorState's retry button. */
  onRetry?: () => void;
  /** Rendered when status === 'success' and isEmpty is false. */
  children: () => ReactNode;
}

export function GlobalStateProvider({
  status,
  error,
  isEmpty = false,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  emptyIcon,
  loadingLines = 3,
  onRetry,
  children,
}: Props) {
  if (status === 'loading' || status === 'idle') {
    return <LoadingState lines={loadingLines} />;
  }

  if (status === 'error') {
    return (
      <ErrorState
        message={error?.message}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return <>{children()}</>;
}
