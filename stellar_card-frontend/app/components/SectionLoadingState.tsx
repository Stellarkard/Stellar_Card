// SectionLoadingState - Handles async state for page sections (Part 3)
// Compact variant for inline use within pages

"use client";

import type { ReactNode } from "react";
import type { AsyncStatus } from "../lib/useAsyncState";
import { LoadingState, Skeleton } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { DEFAULT_LOADING_LINES, DEFAULT_STATE_COPY } from "./stateConfig";

interface SectionLoadingStateProps {
  /** Current async status */
  status: AsyncStatus;
  /** Error from async operation */
  error?: Error | null;
  /** Whether data is empty */
  isEmpty?: boolean;
  /** Compact variant for inline sections */
  variant?: "default" | "compact";
  /** Custom empty state title */
  emptyTitle?: string;
  /** Custom empty state description */
  emptyDescription?: ReactNode;
  /** Custom empty state action */
  emptyAction?: ReactNode;
  /** Callback to retry */
  onRetry?: () => void;
  /** Number of skeleton lines */
  loadingLines?: number;
  /** Children render function */
  children: () => ReactNode;
}

/**
 * SectionLoadingState handles state for individual sections within a page.
 * Use compact variant for inline sections that don't need full-page treatment.
 *
 * @example
 * ```tsx
 * function DashboardSection() {
 *   const { status, data, error, run } = useAsyncState(fetchData);
 *
 *   return (
 *     <SectionLoadingState
 *       status={status}
 *       error={error}
 *       isEmpty={!data?.length}
 *       variant="compact"
 *       onRetry={run}
 *     >
 *       {() => <ItemList items={data} />}
 *     </SectionLoadingState>
 *   );
 * }
 * ```
 */
export function SectionLoadingState({
  status,
  error,
  isEmpty = false,
  variant = "default",
  emptyTitle = DEFAULT_STATE_COPY.empty.sectionTitle,
  emptyDescription,
  emptyAction,
  onRetry,
  loadingLines = DEFAULT_LOADING_LINES,
  children,
}: SectionLoadingStateProps) {
  const isCompact = variant === "compact";

  // Loading state
  if (status === "loading" || status === "idle") {
    if (isCompact) {
      return (
        <div
          style={{
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          }}
        >
          {Array.from({ length: loadingLines }).map((_, i) => (
            <Skeleton
              key={i}
              width={i === loadingLines - 1 ? "60%" : "100%"}
              height={10}
            />
          ))}
        </div>
      );
    }
    return <LoadingState lines={loadingLines} />;
  }

  // Error state
  if (status === "error") {
    return (
      <ErrorState
        title={isCompact ? DEFAULT_STATE_COPY.error.compactTitle : DEFAULT_STATE_COPY.error.pageTitle}
        message={error?.message || DEFAULT_STATE_COPY.error.message}
        onRetry={onRetry}
      />
    );
  }

  // Empty state
  if (status === "success" && isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        compact={isCompact}
      />
    );
  }

  // Success with data
  return <>{children()}</>;
}
