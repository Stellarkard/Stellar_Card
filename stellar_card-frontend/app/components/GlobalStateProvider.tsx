// GlobalStateProvider - Unified state wrapper for page-level async content (Part 3)
// Final integration: combines loading, empty, and error states with children render pattern

"use client";

import type { ReactNode } from "react";
import type { AsyncStatus } from "../lib/useAsyncState";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { DEFAULT_STATE_COPY } from "./stateConfig";

interface GlobalStateProviderProps {
  /** Current async status from useAsyncState */
  status: AsyncStatus;
  /** Error from async operation */
  error?: Error | null;
  /** Whether data is empty (no results) */
  isEmpty?: boolean;
  /** Custom empty state title */
  emptyTitle?: string;
  /** Custom empty state description */
  emptyDescription?: ReactNode;
  /** Custom empty state icon */
  emptyIcon?: ReactNode;
  /** Custom empty state action */
  emptyAction?: ReactNode;
  /** Custom error title */
  errorTitle?: string;
  /** Custom error action */
  errorAction?: ReactNode;
  /** Callback to retry failed operation */
  onRetry?: () => void;
  /** Number of skeleton lines to show while loading */
  loadingLines?: number;
  /** Show avatar skeleton while loading */
  loadingAvatar?: boolean;
  /** Show title skeleton while loading */
  loadingTitle?: boolean;
  /** Children render function - only called when status is success and not empty */
  children: () => ReactNode;
}

/**
 * GlobalStateProvider wraps page content and automatically renders
 * appropriate UI based on async status: loading, error, empty, or success.
 *
 * @example
 * ```tsx
 * function Page() {
 *   const { status, data, error, run } = useAsyncState(fetchData);
 *
 *   return (
 *     <GlobalStateProvider
 *       status={status}
 *       error={error}
 *       isEmpty={!data?.length}
 *       onRetry={run}
 *     >
 *       {() => <Content data={data} />}
 *     </GlobalStateProvider>
 *   );
 * }
 * ```
 */
export function GlobalStateProvider({
  status,
  error,
  isEmpty = false,
  emptyTitle = DEFAULT_STATE_COPY.empty.title,
  emptyDescription,
  emptyIcon,
  emptyAction,
  errorTitle = DEFAULT_STATE_COPY.error.pageTitle,
  errorAction,
  onRetry,
  loadingLines = 5,
  loadingAvatar = false,
  loadingTitle = false,
  children,
}: GlobalStateProviderProps) {
  // Loading state
  if (status === "loading" || status === "idle") {
    return (
      <LoadingState
        lines={loadingLines}
        avatar={loadingAvatar}
        title={loadingTitle}
      />
    );
  }

  // Error state
  if (status === "error") {
    return (
      <ErrorState
        title={errorTitle}
        message={error?.message}
        digest={error?.name}
        onRetry={onRetry}
        action={errorAction}
      />
    );
  }

  // Empty state (success but no data)
  if (status === "success" && isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={emptyIcon}
        action={emptyAction}
      />
    );
  }

  // Success state with data
  return <>{children()}</>;
}
