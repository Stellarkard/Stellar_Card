import { memo } from 'react';
import type { ComponentType, PropsWithChildren } from 'react';

export function createOptimizedComponent<P extends object>(
  Component: ComponentType<P>,
  displayName: string
) {
  const MemoizedComponent = memo(Component);
  MemoizedComponent.displayName = displayName;
  return MemoizedComponent;
}

export function shallowEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (!obj1 || !obj2) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  return keys1.every((key) => obj1[key] === obj2[key]);
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export function memoizeAsync<T>(
  fn: () => Promise<T>,
  ttl: number = 60000
) {
  let cache: T | null = null;
  let lastFetch: number = 0;

  return async () => {
    const now = Date.now();
    if (cache && now - lastFetch < ttl) {
      return cache;
    }

    const result = await fn();
    cache = result;
    lastFetch = now;
    return result;
  };
}
