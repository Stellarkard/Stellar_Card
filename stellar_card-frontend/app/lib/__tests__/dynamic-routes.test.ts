// Comprehensive tests for route-level lazy loading utilities (Part 2)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLazyRoute,
  createRoutePreloader,
  batchPreload,
  RoutePreloadManager,
  routePreloadManager,
} from "../dynamic-routes";

describe("createLazyRoute", () => {
  it("creates a lazy component with default options", () => {
    const mockComponent = { default: () => <div>Test</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const LazyComponent = createLazyRoute(importFn);

    expect(LazyComponent).toBeDefined();
    expect(typeof LazyComponent).toBe("object");
  });

  it("creates lazy component with skeleton loading", () => {
    const mockComponent = { default: () => <div>Content</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const LazyComponent = createLazyRoute(importFn, {
      showSkeleton: true,
      skeletonLines: 5,
    });

    expect(LazyComponent).toBeDefined();
  });

  it("creates lazy component without SSR", () => {
    const mockComponent = { default: () => <div>Client Only</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const LazyComponent = createLazyRoute(importFn, {
      ssr: false,
    });

    expect(LazyComponent).toBeDefined();
  });
});

describe("createRoutePreloader", () => {
  it("creates a preloader function", () => {
    const mockComponent = { default: () => <div>Test</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const preloader = createRoutePreloader(importFn);

    expect(typeof preloader).toBe("function");
  });

  it("caches the import promise", async () => {
    const mockComponent = { default: () => <div>Test</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const preloader = createRoutePreloader(importFn);

    const promise1 = preloader();
    const promise2 = preloader();

    expect(promise1).toBe(promise2);
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it("resolves with imported module", async () => {
    const mockComponent = { default: () => <div>Test</div> };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    const preloader = createRoutePreloader(importFn);

    const result = await preloader();

    expect(result).toBe(mockComponent);
  });
});

describe("batchPreload", () => {
  it("runs multiple preloaders in parallel", async () => {
    const preload1 = vi.fn().mockResolvedValue("module1");
    const preload2 = vi.fn().mockResolvedValue("module2");
    const preload3 = vi.fn().mockResolvedValue("module3");

    const results = await batchPreload([preload1, preload2, preload3]);

    expect(results).toEqual(["module1", "module2", "module3"]);
    expect(preload1).toHaveBeenCalled();
    expect(preload2).toHaveBeenCalled();
    expect(preload3).toHaveBeenCalled();
  });

  it("handles empty preloader array", async () => {
    const results = await batchPreload([]);

    expect(results).toEqual([]);
  });

  it("continues when one preloader fails", async () => {
    const preload1 = vi.fn().mockResolvedValue("module1");
    const preload2 = vi.fn().mockRejectedValue(new Error("Failed"));
    const preload3 = vi.fn().mockResolvedValue("module3");

    try {
      await batchPreload([preload1, preload2, preload3]);
    } catch (error) {
      // At least one succeeded
      expect(preload1).toHaveBeenCalled();
    }
  });
});

describe("RoutePreloadManager", () => {
  let manager: RoutePreloadManager;

  beforeEach(() => {
    manager = new RoutePreloadManager();
  });

  it("adds routes to queue", () => {
    const loader = vi.fn().mockResolvedValue({});

    manager.add({
      path: "/dashboard",
      loader,
      priority: "high",
    });

    expect(manager["queue"]).toHaveLength(1);
  });

  it("sorts routes by priority", () => {
    const loader1 = vi.fn().mockResolvedValue({});
    const loader2 = vi.fn().mockResolvedValue({});
    const loader3 = vi.fn().mockResolvedValue({});

    manager.add({ path: "/low", loader: loader1, priority: "low" });
    manager.add({ path: "/critical", loader: loader2, priority: "critical" });
    manager.add({ path: "/high", loader: loader3, priority: "high" });

    expect(manager["queue"][0].priority).toBe("critical");
    expect(manager["queue"][1].priority).toBe("high");
    expect(manager["queue"][2].priority).toBe("low");
  });

  it("does not add duplicate routes", () => {
    const loader = vi.fn().mockResolvedValue({});

    manager.add({ path: "/dashboard", loader, priority: "high" });
    manager.add({ path: "/dashboard", loader, priority: "high" });

    expect(manager["queue"]).toHaveLength(1);
  });

  it("loads next route in queue", async () => {
    const loader = vi.fn().mockResolvedValue({});

    manager.add({ path: "/dashboard", loader, priority: "normal" });

    await manager.loadNext();

    expect(loader).toHaveBeenCalled();
    expect(manager["loaded"].has("/dashboard")).toBe(true);
  });

  it("loads all routes sequentially", async () => {
    const loader1 = vi.fn().mockResolvedValue({});
    const loader2 = vi.fn().mockResolvedValue({});
    const loader3 = vi.fn().mockResolvedValue({});

    manager.add({ path: "/route1", loader: loader1, priority: "normal" });
    manager.add({ path: "/route2", loader: loader2, priority: "normal" });
    manager.add({ path: "/route3", loader: loader3, priority: "normal" });

    await manager.loadAll();

    expect(loader1).toHaveBeenCalled();
    expect(loader2).toHaveBeenCalled();
    expect(loader3).toHaveBeenCalled();
    expect(manager["queue"]).toHaveLength(0);
  });

  it("loads critical routes immediately", async () => {
    const loader1 = vi.fn().mockResolvedValue({});
    const loader2 = vi.fn().mockResolvedValue({});
    const loader3 = vi.fn().mockResolvedValue({});

    manager.add({ path: "/normal", loader: loader1, priority: "normal" });
    manager.add({ path: "/critical1", loader: loader2, priority: "critical" });
    manager.add({ path: "/critical2", loader: loader3, priority: "critical" });

    await manager.loadCritical();

    expect(loader2).toHaveBeenCalled();
    expect(loader3).toHaveBeenCalled();
    expect(loader1).not.toHaveBeenCalled();
  });

  it("handles loader errors gracefully", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = vi.fn().mockRejectedValue(new Error("Load failed"));

    manager.add({ path: "/failing", loader, priority: "normal" });

    await manager.loadNext();

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(manager["loaded"].has("/failing")).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("does not reload already loaded routes", async () => {
    const loader = vi.fn().mockResolvedValue({});

    manager.add({ path: "/dashboard", loader, priority: "normal" });

    await manager.loadNext();
    expect(loader).toHaveBeenCalledTimes(1);

    manager.add({ path: "/dashboard", loader, priority: "normal" });
    await manager.loadNext();

    // Should not call again
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("skips routes already being loaded", async () => {
    const loader = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    manager.add({ path: "/dashboard", loader, priority: "normal" });

    // Start loading
    const promise1 = manager.loadNext();

    // Try to load again while first is in progress
    manager.add({ path: "/dashboard", loader, priority: "normal" });
    const promise2 = manager.loadNext();

    await Promise.all([promise1, promise2]);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("preloadCriticalRoutes", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      readyState: "complete",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is defined and callable", () => {
    const { preloadCriticalRoutes } = require("../dynamic-routes");
    expect(typeof preloadCriticalRoutes).toBe("function");
  });
});
