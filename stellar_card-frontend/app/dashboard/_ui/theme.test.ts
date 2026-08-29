// Unit tests for theme helpers — pure Node, no DOM or jsdom needed.
// Browser globals (window, document, localStorage, matchMedia) are faked
// with vi.stubGlobal so the functions' SSR guards and conditional branches
// can all be exercised in isolation.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadTheme, saveTheme, applyTheme } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── loadTheme ─────────────────────────────────────────────────────────────────

describe('loadTheme — SSR guard', () => {
  it('returns "dark" when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(loadTheme()).toBe('dark');
  });
});

describe('loadTheme — stored values', () => {
  it('returns "dark" when "dark" is stored', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'dark' } });
    expect(loadTheme()).toBe('dark');
  });

  it('returns "light" when "light" is stored', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'light' } });
    expect(loadTheme()).toBe('light');
  });

  it('returns "system" when "system" is stored', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'system' } });
    expect(loadTheme()).toBe('system');
  });

  it('falls back to "dark" when nothing is stored', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    expect(loadTheme()).toBe('dark');
  });

  it('falls back to "dark" when stored value is unrecognised', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'bogus' } });
    expect(loadTheme()).toBe('dark');
  });
});

// ── saveTheme ─────────────────────────────────────────────────────────────────

describe('saveTheme', () => {
  it('writes the theme string to localStorage under the correct key', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem } });
    saveTheme('light');
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith('stellar_card.theme', 'light');
  });

  it('writes "system" correctly', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem } });
    saveTheme('system');
    expect(setItem).toHaveBeenCalledWith('stellar_card.theme', 'system');
  });

  it('is a no-op and does not throw when window is undefined (SSR guard)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => saveTheme('dark')).not.toThrow();
  });
});

// ── applyTheme ────────────────────────────────────────────────────────────────

describe('applyTheme — SSR guard', () => {
  it('does not throw when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(() => applyTheme('dark')).not.toThrow();
  });
});

describe('applyTheme — explicit themes', () => {
  it('sets data-theme="dark" for explicit "dark"', () => {
    const setAttribute = vi.fn();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    applyTheme('dark');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('sets data-theme="light" for explicit "light"', () => {
    const setAttribute = vi.fn();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    applyTheme('light');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });
});

describe('applyTheme — system resolution', () => {
  it('resolves "system" to "light" when prefers-color-scheme: light matches', () => {
    const setAttribute = vi.fn();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    applyTheme('system');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('resolves "system" to "dark" when prefers-color-scheme: light does not match', () => {
    const setAttribute = vi.fn();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    applyTheme('system');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });
});
