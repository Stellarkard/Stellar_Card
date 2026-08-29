// Comprehensive tests for the onboarding configuration and pure helpers
// (Part 2). Runs in the Node test project (no DOM) — storage helpers are
// exercised via injected in-memory storage.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_ONBOARDING_STORAGE_KEY,
  ONBOARDING_COMPLETED_VALUE,
  readOnboardingCompleted,
  markOnboardingCompleted,
  clearOnboardingCompleted,
  getOnboardingProgress,
  isValidStepIndex,
  canGoNext,
  canGoPrevious,
  type OnboardingStorage,
} from "./onboardingConfig";

function createMemoryStorage(initial: Record<string, string> = {}): OnboardingStorage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("onboarding constants", () => {
  it("uses the expected default storage key", () => {
    expect(DEFAULT_ONBOARDING_STORAGE_KEY).toBe("onboarding-completed");
  });

  it("uses a truthy completion marker", () => {
    expect(ONBOARDING_COMPLETED_VALUE).toBe("true");
  });
});

describe("readOnboardingCompleted", () => {
  it("returns false when no storage is available (SSR)", () => {
    expect(readOnboardingCompleted(undefined, null)).toBe(false);
  });

  it("returns false when the key is unset", () => {
    expect(readOnboardingCompleted(undefined, createMemoryStorage())).toBe(false);
  });

  it("returns true when the key is set", () => {
    const storage = createMemoryStorage({ [DEFAULT_ONBOARDING_STORAGE_KEY]: "true" });
    expect(readOnboardingCompleted(undefined, storage)).toBe(true);
  });

  it("respects a custom storage key", () => {
    const storage = createMemoryStorage({ custom: "true" });
    expect(readOnboardingCompleted("custom", storage)).toBe(true);
    expect(readOnboardingCompleted(undefined, storage)).toBe(false);
  });

  it("swallows storage read errors", () => {
    const storage: OnboardingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readOnboardingCompleted(undefined, storage)).toBe(false);
  });
});

describe("markOnboardingCompleted", () => {
  it("writes the completion marker", () => {
    const storage = createMemoryStorage();
    markOnboardingCompleted(undefined, storage);
    expect(storage.getItem(DEFAULT_ONBOARDING_STORAGE_KEY)).toBe(ONBOARDING_COMPLETED_VALUE);
  });

  it("is a no-op when storage is unavailable", () => {
    expect(() => markOnboardingCompleted(undefined, null)).not.toThrow();
  });

  it("is a no-op when storage throws", () => {
    const storage: OnboardingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => markOnboardingCompleted(undefined, storage)).not.toThrow();
  });
});

describe("clearOnboardingCompleted", () => {
  it("removes the completion marker", () => {
    const storage = createMemoryStorage({ [DEFAULT_ONBOARDING_STORAGE_KEY]: "true" });
    clearOnboardingCompleted(undefined, storage);
    expect(storage.getItem(DEFAULT_ONBOARDING_STORAGE_KEY)).toBeNull();
  });

  it("is a no-op when storage is unavailable or throws", () => {
    expect(() => clearOnboardingCompleted(undefined, null)).not.toThrow();
    const throwing: OnboardingStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => clearOnboardingCompleted(undefined, throwing)).not.toThrow();
  });
});

describe("getOnboardingProgress", () => {
  it("computes progress for a 4-step flow", () => {
    expect(getOnboardingProgress(0, 4)).toBe(25);
    expect(getOnboardingProgress(1, 4)).toBe(50);
    expect(getOnboardingProgress(3, 4)).toBe(100);
  });

  it("returns 0 for an empty step list", () => {
    expect(getOnboardingProgress(0, 0)).toBe(0);
    expect(getOnboardingProgress(2, -1)).toBe(0);
  });

  it("clamps negative indices and never exceeds 100", () => {
    expect(getOnboardingProgress(-1, 4)).toBe(25);
    expect(getOnboardingProgress(10, 4)).toBe(100);
  });
});

describe("isValidStepIndex", () => {
  it("accepts indices within bounds", () => {
    expect(isValidStepIndex(0, 4)).toBe(true);
    expect(isValidStepIndex(3, 4)).toBe(true);
  });

  it("rejects out-of-range indices", () => {
    expect(isValidStepIndex(-1, 4)).toBe(false);
    expect(isValidStepIndex(4, 4)).toBe(false);
  });

  it("rejects any index for an empty step list", () => {
    expect(isValidStepIndex(0, 0)).toBe(false);
  });
});

describe("canGoNext", () => {
  it("allows forward navigation before the last step", () => {
    expect(canGoNext(0, 4)).toBe(true);
    expect(canGoNext(2, 4)).toBe(true);
  });

  it("denies forward navigation on the last step", () => {
    expect(canGoNext(3, 4)).toBe(false);
  });

  it("denies forward navigation for an empty list", () => {
    expect(canGoNext(0, 0)).toBe(false);
  });
});

describe("canGoPrevious", () => {
  it("allows backward navigation after the first step", () => {
    expect(canGoPrevious(1)).toBe(true);
    expect(canGoPrevious(3)).toBe(true);
  });

  it("denies backward navigation on the first step", () => {
    expect(canGoPrevious(0)).toBe(false);
    expect(canGoPrevious(-1)).toBe(false);
  });
});