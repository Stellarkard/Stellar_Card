'use client';

import type { ReactNode } from 'react';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

interface Props {
  isLoading?: boolean;
  isEmpty?: boolean;
  isError?: boolean;
  error?: Error | string;
  message?: string;
  onRetry?: () => void;
  children?: ReactNode;
  loadingTitle?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  errorTitle?: string;
  errorMessage?: string;
}

export function StateDisplay({
  isLoading,
  isEmpty,
  isError,
  error,
  message,
  onRetry,
  children,
  loadingTitle = 'Loading…',
  emptyTitle = 'No data available',
  emptyDescription = 'There is nothing to display at the moment.',
  errorTitle = 'Error',
  errorMessage,
}: Props) {
  if (isLoading) {
    return <LoadingState>{loadingTitle}</LoadingState>;
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription || message}
      />
    );
  }

  if (isError) {
    const errorText = typeof error === 'string' ? error : error?.message;
    return (
      <ErrorState
        title={errorTitle}
        message={errorMessage || message || errorText || 'Something went wrong'}
        onRetry={onRetry}
      />
    );
  }

  return <>{children}</>;
}
