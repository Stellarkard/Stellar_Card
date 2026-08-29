'use client';

import type { ReactNode } from 'react';
import type { AsyncStatus } from '../lib/useAsyncState';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

interface Props {
  status: AsyncStatus;
  error?: Error | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  loadingLines?: number;
  onRetry?: () => void;
  children: () => ReactNode;
  variant?: 'full' | 'compact' | 'inline';
}

export function SectionLoadingState({
  status,
  error,
  isEmpty = false,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  emptyIcon,
  loadingLines = 2,
  onRetry,
  children,
  variant = 'full',
}: Props) {
  const isCompact = variant === 'compact';

  if (status === 'loading' || status === 'idle') {
    return (
      <LoadingState
        lines={loadingLines}
        className={isCompact ? 'section-loading-compact' : ''}
      />
    );
  }

  if (status === 'error') {
    return (
      <ErrorState
        title={isCompact ? 'Error' : 'Something went wrong'}
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
        compact={isCompact}
      />
    );
  }

  return <>{children()}</>;
}
