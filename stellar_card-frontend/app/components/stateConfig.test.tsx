// Comprehensive tests for the shared state system configuration (Part 2)
//
// Verifies the centralized defaults and pure helpers that the loading,
// empty, and error state components rely on. These run in the Node test
// project (no DOM required).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_RETRY_CONFIG,
  PERSIST_KEY_PREFIX,
  DEFAULT_LOADING_LINES,
  DEFAULT_STATE_COPY,
  buildPersistKey,
  retryDelayForAttempt,
  isWithinRetryLimit,
} from "./stateConfig";

describe("stateConfig defaults", () => {
  it("exposes the default retry policy", () => {
    expect(DEFAULT_RETRY_CONFIG.attempts).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
  });

  it("exposes a stable persistence key prefix", () => {
    expect(PERSIST_KEY_PREFIX).toBe("state_");
  });

  it("exposes a sensible default loading line count", () => {
    expect(DEFAULT_LOADING_LINES).toBe(3);
  });

  it("exposes default state copy for every state", () => {
    expect(DEFAULT_STATE_COPY.loading.label).toBe("Loading…");
    expect(DEFAULT_STATE_COPY.empty.title).toBe("No data found");
    expect(DEFAULT_STATE_COPY.empty.sectionTitle).toBe("No data");
    expect(DEFAULT_STATE_COPY.empty.description).toBeTruthy();
    expect(DEFAULT_STATE_COPY.error.title).toBe("Something went wrong");
    expect(DEFAULT_STATE_COPY.error.message).toBeTruthy();
    expect(DEFAULT_STATE_COPY.error.pageTitle).toBe("Failed to load");
    expect(DEFAULT_STATE_COPY.error.compactTitle).toBe("Error");
  });
});

describe("buildPersistKey", () => {
  it("prefixes a named state slot", () => {
    expect(buildPersistKey("orders")).toBe("state_orders");
  });

  it("handles keys that already contain the prefix", () => {
    // No special handling: it is a plain prefix builder.
    expect(buildPersistKey("state_orders")).toBe("state_state_orders");
  });

  it("handles the empty string", () => {
    expect(buildPersistKey("")).toBe("state_");
  });

  it("handles keys with special characters", () => {
    expect(buildPersistKey("user:123/scope")).toBe("state_user:123/scope");
  });
});

describe("retryDelayForAttempt", () => {
  it("returns the base delay for the first attempt", () => {
    expect(retryDelayForAttempt(0)).toBe(1000);
  });

  it("applies exponential backoff", () => {
    expect(retryDelayForAttempt(1)).toBe(2000);
    expect(retryDelayForAttempt(2)).toBe(4000);
    expect(retryDelayForAttempt(5)).toBe(32000);
  });

  it("supports a custom base delay", () => {
    expect(retryDelayForAttempt(3, 500)).toBe(4000);
  });

  it("clamps negative attempts to the base delay", () => {
    expect(retryDelayForAttempt(-1)).toBe(1000);
    expect(retryDelayForAttempt(-50, 250)).toBe(250);
  });

  it("never overflows to Infinity for absurd attempt counts", () => {
    const delay = retryDelayForAttempt(1000);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThan(0);
  });
});

describe("isWithinRetryLimit", () => {
  it("allows retries while under the default attempt limit", () => {
    expect(isWithinRetryLimit(0)).toBe(true);
    expect(isWithinRetryLimit(1)).toBe(true);
    expect(isWithinRetryLimit(2)).toBe(true);
  });

  it("denies retries once the default limit is reached", () => {
    expect(isWithinRetryLimit(3)).toBe(false);
    expect(isWithinRetryLimit(4)).toBe(false);
  });

  it("supports a custom attempt limit", () => {
    expect(isWithinRetryLimit(2, 5)).toBe(true);
    expect(isWithinRetryLimit(5, 5)).toBe(false);
  });

  it("denies any retry when the limit is zero", () => {
    expect(isWithinRetryLimit(0, 0)).toBe(false);
  });
});
