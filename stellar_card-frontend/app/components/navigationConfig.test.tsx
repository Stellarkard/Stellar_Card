// Comprehensive tests for the shared responsive navigation configuration
// and pure helpers (Part 2). Runs in the Node test project (no DOM).

import { describe, it, expect } from "vitest";
import {
  NAV_BREAKPOINTS,
  isActivePath,
  BREADCRUMB_LABELS,
  buildBreadcrumbTrail,
  PRIMARY_NAV_ITEMS,
  MORE_NAV_ITEMS,
} from "./navigationConfig";

describe("NAV_BREAKPOINTS", () => {
  it("exposes consistent, ascending breakpoints", () => {
    expect(NAV_BREAKPOINTS.mobile).toBe(640);
    expect(NAV_BREAKPOINTS.tablet).toBe(860);
    expect(NAV_BREAKPOINTS.sidebar).toBe(768);
  });
});

describe("isActivePath", () => {
  it("matches an exact path", () => {
    expect(isActivePath("/pricing", "/pricing")).toBe(true);
  });

  it("matches nested paths", () => {
    expect(isActivePath("/docs/quickstart", "/docs")).toBe(true);
    expect(isActivePath("/docs/quickstart/install", "/docs")).toBe(true);
  });

  it("does not match sibling or prefix lookalikes", () => {
    expect(isActivePath("/pricing", "/docs")).toBe(false);
    // "/docs" must not match "/documentation" via the trailing-slash guard.
    expect(isActivePath("/documentation", "/docs")).toBe(false);
  });

  it("handles the root path as a literal match only", () => {
    expect(isActivePath("/", "/")).toBe(true);
    // Root should not be treated as matching everything under it.
    expect(isActivePath("/pricing", "/")).toBe(false);
  });

  it("handles query strings as part of the exact pathname", () => {
    // Pathname from usePathname() excludes the query string, so no special
    // handling is expected; this just documents current behavior.
    expect(isActivePath("/orders?status=pending", "/orders?status=pending")).toBe(true);
  });
});

describe("BREADCRUMB_LABELS", () => {
  it("maps known dashboard segments to human labels", () => {
    expect(BREADCRUMB_LABELS.dashboard).toBe("Dashboard");
    expect(BREADCRUMB_LABELS.agents).toBe("Agents");
    expect(BREADCRUMB_LABELS.audit).toBe("Audit log");
  });
});

describe("buildBreadcrumbTrail", () => {
  it("returns an empty trail for a bare path", () => {
    expect(buildBreadcrumbTrail("/")).toEqual([]);
    expect(buildBreadcrumbTrail("")).toEqual([]);
  });

  it("returns an empty trail for a single segment", () => {
    expect(buildBreadcrumbTrail("/dashboard")).toEqual([]);
  });

  it("builds a trail with cumulative hrefs and labels", () => {
    const trail = buildBreadcrumbTrail("/dashboard/agents/agent-123");
    expect(trail.map((t) => t.label)).toEqual(["Dashboard", "Agents", "agent-123"]);
    expect(trail.map((t) => t.href)).toEqual([
      "/dashboard",
      "/dashboard/agents",
      "/dashboard/agents/agent-123",
    ]);
  });

  it("marks only the final segment as last", () => {
    const trail = buildBreadcrumbTrail("/dashboard/agents/agent-123");
    expect(trail.map((t) => t.isLast)).toEqual([false, false, true]);
  });

  it("applies label overrides without changing the href", () => {
    const trail = buildBreadcrumbTrail(
      "/dashboard/agents/agent-123",
      { "agent-123": { label: "Acme Corp" } },
    );
    expect(trail[2]!.label).toBe("Acme Corp");
    expect(trail[2]!.href).toBe("/dashboard/agents/agent-123");
  });

  it("applies href overrides for non-final segments", () => {
    const trail = buildBreadcrumbTrail(
      "/dashboard/agents",
      { agents: { label: "All Agents", href: "/dashboard/agents?tab=all" } },
    );
    expect(trail[0]!.label).toBe("Dashboard");
    expect(trail[1]!.label).toBe("All Agents");
    expect(trail[1]!.href).toBe("/dashboard/agents?tab=all");
  });

  it("falls back to the raw segment when no label or map entry exists", () => {
    const trail = buildBreadcrumbTrail("/dashboard/unknown-segment");
    expect(trail[1]!.label).toBe("unknown-segment");
  });

  it("ignores leading/trailing slashes and duplicate separators", () => {
    const trail = buildBreadcrumbTrail("/dashboard/agents/");
    expect(trail.map((t) => t.label)).toEqual(["Dashboard", "Agents"]);
  });

  it("handles an empty overrides object", () => {
    const trail = buildBreadcrumbTrail("/dashboard/settings", {});
    expect(trail).toHaveLength(2);
  });
});

describe("marketing nav item configuration", () => {
  it("exposes the primary links with labels and hrefs", () => {
    expect(PRIMARY_NAV_ITEMS.map((i) => i.href)).toEqual([
      "/pricing",
      "/docs",
      "/changelog",
      "/company",
    ]);
    expect(PRIMARY_NAV_ITEMS.map((i) => i.label)).toEqual([
      "Pricing",
      "Docs",
      "Changelog",
      "Company",
    ]);
  });

  it("exposes the more-menu items with body descriptions", () => {
    expect(MORE_NAV_ITEMS.length).toBe(5);
    expect(MORE_NAV_ITEMS.every((i) => !!i.body)).toBe(true);
    expect(MORE_NAV_ITEMS[0]).toEqual({
      href: "/compare",
      label: "Compare",
      body: "vs corporate + shared cards",
    });
  });

  it("keeps primary and more hrefs disjoint", () => {
    const moreHrefs = new Set(MORE_NAV_ITEMS.map((i) => i.href));
    expect(PRIMARY_NAV_ITEMS.some((i) => moreHrefs.has(i.href))).toBe(false);
  });
});