// Dynamic route-level lazy loading utilities (Part 2)
// Advanced code splitting with preloading, priority hints, and loading fallbacks

"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { LoadingState } from "../components/LoadingState";

interface LazyRouteOptions {
  /** Show loading skeleton while component loads */
  showSkeleton?: boolean;
  /** Number of skeleton lines to show */
  skeletonLines?: number;
  /** Preload strategy */
  preload?: "hover" | "visible" | "idle";
  /** SSR support */
  ssr?: boolean;
}

/**
 * Create a lazy-loaded route component with configurable loading strategy
 */
export function createLazyRoute<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  options: LazyRouteOptions = {},
) {
  const {
    showSkeleton = true,
    skeletonLines = 3,
    preload,
    ssr = false,
  } = options;

  const LazyComponent = dynamic(importFn, {
    ssr,
    loading: () =>
      showSkeleton ? <LoadingState lines={skeletonLines} /> : null,
  });

  // Setup preloading if specified
  if (preload && typeof window !== "undefined") {
    setupPreload(importFn, preload);
  }

  return LazyComponent;
}

/**
 * Setup component preloading based on strategy
 */
function setupPreload<T>(
  importFn: () => Promise<T>,
  strategy: "hover" | "visible" | "idle",
) {
  let preloadPromise: Promise<T> | null = null;

  const preloadFn = () => {
    if (!preloadPromise) {
      preloadPromise = importFn();
    }
    return preloadPromise;
  };

  if (strategy === "idle") {
    // Preload during browser idle time
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => preloadFn(), { timeout: 2000 });
    } else {
      setTimeout(preloadFn, 1000);
    }
  } else if (strategy === "visible") {
    // Preload when viewport is visible (implemented via IntersectionObserver in consumer)
    // Consumer should call preloadFn when element becomes visible
    return preloadFn;
  } else if (strategy === "hover") {
    // Preload on link hover (implemented in consumer with onMouseEnter)
    return preloadFn;
  }
}

/**
 * Create route preloader that can be triggered on demand
 */
export function createRoutePreloader<T>(
  importFn: () => Promise<T>,
): () => Promise<T> {
  let preloadPromise: Promise<T> | null = null;

  return () => {
    if (!preloadPromise) {
      preloadPromise = importFn();
    }
    return preloadPromise;
  };
}

/**
 * Batch multiple route preloads to run in parallel
 */
export function batchPreload(preloaders: Array<() => Promise<any>>) {
  return Promise.all(preloaders.map((fn) => fn()));
}

/**
 * Preload route when link enters viewport
 */
export function useVisiblePreload(
  elementRef: React.RefObject<HTMLElement>,
  preloadFn: () => Promise<any>,
) {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          preloadFn();
          observer.disconnect();
        }
      });
    },
    { rootMargin: "50px" },
  );

  if (elementRef.current) {
    observer.observe(elementRef.current);
  }

  return () => observer.disconnect();
}

/**
 * Priority-based route loading for critical paths
 */
export interface RouteConfig {
  path: string;
  loader: () => Promise<any>;
  priority: "critical" | "high" | "normal" | "low";
}

export class RoutePreloadManager {
  private queue: RouteConfig[] = [];
  private loading = new Set<string>();
  private loaded = new Set<string>();

  add(config: RouteConfig) {
    if (this.loaded.has(config.path)) return;
    this.queue.push(config);
    this.queue.sort((a, b) => {
      const priorities = { critical: 0, high: 1, normal: 2, low: 3 };
      return priorities[a.priority] - priorities[b.priority];
    });
  }

  async loadNext() {
    if (this.queue.length === 0) return;

    const config = this.queue.shift()!;
    if (this.loaded.has(config.path) || this.loading.has(config.path)) {
      return this.loadNext();
    }

    this.loading.add(config.path);

    try {
      await config.loader();
      this.loaded.add(config.path);
    } catch (error) {
      console.error(`Failed to preload route: ${config.path}`, error);
    } finally {
      this.loading.delete(config.path);
    }
  }

  async loadAll() {
    while (this.queue.length > 0) {
      await this.loadNext();
    }
  }

  async loadCritical() {
    const critical = this.queue.filter((c) => c.priority === "critical");
    await Promise.all(
      critical.map((config) => {
        this.queue = this.queue.filter((c) => c !== config);
        return config.loader();
      }),
    );
  }
}

// Global preload manager instance
export const routePreloadManager = new RoutePreloadManager();

/**
 * Preload routes on application startup based on priority
 */
export function preloadCriticalRoutes() {
  if (typeof window !== "undefined") {
    // Wait for initial page load
    if (document.readyState === "complete") {
      routePreloadManager.loadCritical();
    } else {
      window.addEventListener("load", () => {
        routePreloadManager.loadCritical();
      });
    }
  }
}
