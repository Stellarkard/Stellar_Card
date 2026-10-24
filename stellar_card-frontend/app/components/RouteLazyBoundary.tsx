'use client';

import { Suspense, type ReactNode } from 'react';
import { PageLoadingSkeleton } from './LoadingState';

interface RouteLazyBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function RouteLazyBoundary({
  children,
  fallback = <PageLoadingSkeleton />,
}: RouteLazyBoundaryProps) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
