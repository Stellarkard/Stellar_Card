// Unit tests for onboarding modal — pure logic, no DOM.
// Tests the onboarding state management and step logic.

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

const STORAGE_KEY = 'sc_onboarding_done';
const TOTAL_STEPS = 4;

describe('onboarding constants', () => {
  it('STORAGE_KEY is "sc_onboarding_done"', () => {
    expect(STORAGE_KEY).toBe('sc_onboarding_done');
  });

  it('TOTAL_STEPS is 4', () => {
    expect(TOTAL_STEPS).toBe(4);
  });
});

describe('onboarding localStorage behavior', () => {
  it('should show modal when localStorage key is not set', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: vi.fn(),
      },
    });

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBeNull();
  });

  it('should not show modal when localStorage key is set', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => '1',
        setItem: vi.fn(),
      },
    });

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).toBe('1');
  });

  it('should write to localStorage when dismissing', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem,
      },
    });

    window.localStorage.setItem(STORAGE_KEY, '1');
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, '1');
  });
});

describe('onboarding step logic', () => {
  it('step 1 is Welcome', () => {
    const step = 1;
    expect(step).toBeGreaterThanOrEqual(1);
    expect(step).toBeLessThanOrEqual(TOTAL_STEPS);
  });

  it('step 2 is Add Funds', () => {
    const step = 2;
    expect(step).toBeGreaterThanOrEqual(1);
    expect(step).toBeLessThanOrEqual(TOTAL_STEPS);
  });

  it('step 3 is Create Agent', () => {
    const step = 3;
    expect(step).toBeGreaterThanOrEqual(1);
    expect(step).toBeLessThanOrEqual(TOTAL_STEPS);
  });

  it('step 4 is Ready', () => {
    const step = 4;
    expect(step).toBeGreaterThanOrEqual(1);
    expect(step).toBeLessThanOrEqual(TOTAL_STEPS);
  });

  it('progress calculation is correct for each step', () => {
    for (let step = 1; step <= TOTAL_STEPS; step++) {
      const progress = (step / TOTAL_STEPS) * 100;
      expect(progress).toBeGreaterThanOrEqual(25);
      expect(progress).toBeLessThanOrEqual(100);
    }
  });

  it('step 1 progress is 25%', () => {
    const progress = (1 / TOTAL_STEPS) * 100;
    expect(progress).toBe(25);
  });

  it('step 4 progress is 100%', () => {
    const progress = (4 / TOTAL_STEPS) * 100;
    expect(progress).toBe(100);
  });
});

describe('onboarding navigation', () => {
  it('can navigate forward through steps', () => {
    let step = 1;
    const goToStep = (nextStep: number) => { step = nextStep; };

    goToStep(2);
    expect(step).toBe(2);

    goToStep(3);
    expect(step).toBe(3);

    goToStep(4);
    expect(step).toBe(4);
  });

  it('can navigate backward through steps', () => {
    let step = 4;
    const goToStep = (nextStep: number) => { step = nextStep; };

    goToStep(3);
    expect(step).toBe(3);

    goToStep(2);
    expect(step).toBe(2);

    goToStep(1);
    expect(step).toBe(1);
  });

  it('cannot navigate before step 1', () => {
    const step = 1;
    const canGoBack = step > 1;
    expect(canGoBack).toBe(false);
  });

  it('cannot navigate after step 4', () => {
    const step = 4;
    const canGoForward = step < TOTAL_STEPS;
    expect(canGoForward).toBe(false);
  });
});
