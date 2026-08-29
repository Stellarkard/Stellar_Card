// Global loading skeleton primitives. Used as the `loading.tsx` export
// in route segments and as inline loading indicators throughout the app.
// Follows the existing design token palette and respects reduced motion.

import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
}

export function Skeleton({ width, height = 14, borderRadius = 4, style }: SkeletonProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: 'var(--surface-2)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div className="skeleton-shimmer" />
    </div>
  );
}

interface LoadingStateProps {
  lines?: number;
  avatar?: boolean;
  title?: boolean;
  children?: ReactNode;
  className?: string;
}

export function LoadingState({ lines = 3, avatar, title, children, className }: LoadingStateProps) {
  if (children) {
    return (
      <div
        className={className}
        style={{
          padding: '3rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '0.75rem',
        }}
      >
        <div className="loading-spinner" />
        {children}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
      }}
    >
      {avatar && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Skeleton width={40} height={40} borderRadius="50%" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
            <Skeleton width="40%" height={12} />
            <Skeleton width="25%" height={10} />
          </div>
        </div>
      )}
      {title && <Skeleton width="60%" height={18} style={{ marginBottom: '0.25rem' }} />}
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '70%' : '100%'}
          height={12}
        />
      ))}
      <LoadingStyles />
    </div>
  );
}

export function PageLoadingSkeleton() {
  return (
    <div
      style={{
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 1.35rem 6rem',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <div className="loading-spinner" />
        <span
          style={{
            fontSize: '0.82rem',
            color: 'var(--fg-dim)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Loading…
        </span>
      </div>
      <LoadingStyles />
    </div>
  );
}

function LoadingStyles() {
  return (
    <style>{`
      .skeleton-shimmer {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.04) 40%,
          rgba(255, 255, 255, 0.08) 50%,
          rgba(255, 255, 255, 0.04) 60%,
          transparent 100%
        );
        animation: skeleton-shimmer 1.8s ease-in-out infinite;
      }
      html[data-theme='light'] .skeleton-shimmer {
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(0, 0, 0, 0.03) 40%,
          rgba(0, 0, 0, 0.06) 50%,
          rgba(0, 0, 0, 0.03) 60%,
          transparent 100%
        );
      }
      @keyframes skeleton-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }

      .loading-spinner {
        width: 28px;
        height: 28px;
        border: 2px solid var(--border);
        border-top-color: var(--green);
        border-radius: 50%;
        animation: loading-spin 0.8s linear infinite;
      }
      @keyframes loading-spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .skeleton-shimmer { animation: none; }
        .loading-spinner { animation: loading-spin 1.6s linear infinite; }
      }
    `}</style>
  );
}
