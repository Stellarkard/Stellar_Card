// Unit tests for shared design tokens — pure logic, no DOM.

import { describe, it, expect } from 'vitest';
import { TONE_VARS, toneVars, typography } from './tokens';
import type { Tone } from './tokens';

describe('TONE_VARS', () => {
  it('green maps to the correct CSS variables', () => {
    expect(TONE_VARS.green).toEqual({
      fg: 'var(--green)',
      bg: 'var(--green-muted)',
      border: 'var(--green-border)',
    });
  });

  it('red maps to the correct CSS variables', () => {
    expect(TONE_VARS.red).toEqual({
      fg: 'var(--red)',
      bg: 'var(--red-muted)',
      border: 'var(--red-border)',
    });
  });

  it('yellow maps to the correct CSS variables', () => {
    expect(TONE_VARS.yellow).toEqual({
      fg: 'var(--yellow)',
      bg: 'var(--yellow-muted)',
      border: 'var(--yellow-border)',
    });
  });

  it('blue maps to the correct CSS variables', () => {
    expect(TONE_VARS.blue).toEqual({
      fg: 'var(--blue)',
      bg: 'var(--blue-muted)',
      border: 'var(--blue-border)',
    });
  });

  it('purple maps to the correct CSS variables', () => {
    expect(TONE_VARS.purple).toEqual({
      fg: 'var(--purple)',
      bg: 'var(--purple-muted)',
      border: 'var(--purple-border)',
    });
  });

  it('neutral maps to muted/surface-2/border variables', () => {
    expect(TONE_VARS.neutral).toEqual({
      fg: 'var(--fg-muted)',
      bg: 'var(--surface-2)',
      border: 'var(--border)',
    });
  });

  it('covers all six tones with no extras', () => {
    const tones: Tone[] = ['green', 'red', 'yellow', 'blue', 'purple', 'neutral'];
    expect(Object.keys(TONE_VARS)).toEqual(tones);
  });
});

describe('toneVars', () => {
  it('returns the same object as TONE_VARS for each tone', () => {
    const tones: Tone[] = ['green', 'red', 'yellow', 'blue', 'purple', 'neutral'];
    for (const tone of tones) {
      expect(toneVars(tone)).toBe(TONE_VARS[tone]);
    }
  });

  it('returned object has fg, bg, and border keys', () => {
    const result = toneVars('green');
    expect(result).toHaveProperty('fg');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('border');
  });
});

describe('typography', () => {
  it('fontMono references the CSS mono font variable', () => {
    expect(typography.fontMono).toBe('var(--font-mono)');
  });

  it('size.xs is 0.66rem', () => {
    expect(typography.size.xs).toBe('0.66rem');
  });

  it('size.sm is 0.68rem', () => {
    expect(typography.size.sm).toBe('0.68rem');
  });

  it('size.base is 0.7rem', () => {
    expect(typography.size.base).toBe('0.7rem');
  });

  it('size.md is 0.78rem', () => {
    expect(typography.size.md).toBe('0.78rem');
  });

  it('size has exactly the expected scale keys', () => {
    expect(Object.keys(typography.size)).toEqual(['xs', 'sm', 'base', 'md']);
  });
});
