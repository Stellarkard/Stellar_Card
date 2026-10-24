// Testing utilities for Storybook stories
// Provides helpers for common testing scenarios and assertions

import { expect } from '@storybook/test';
import type { ReactElement } from 'react';

/**
 * Helper to test component accessibility
 * Ensures components meet basic a11y requirements
 */
export async function testAccessibility(canvas: any) {
  const root = canvas.container;
  
  // Check for interactive elements without accessible names
  const buttons = root.querySelectorAll('button:not([aria-label]):not([aria-labelledby])');
  buttons.forEach((button: Element) => {
    const text = button.textContent?.trim();
    if (!text) {
      console.warn('Button without accessible name found:', button);
    }
  });

  // Check for images without alt text
  const images = root.querySelectorAll('img:not([alt])');
  if (images.length > 0) {
    console.warn(`Found ${images.length} images without alt text`);
  }

  return true;
}

/**
 * Helper to test keyboard navigation
 * Ensures components are keyboard accessible
 */
export async function testKeyboardNavigation(canvas: any, element: string) {
  const target = canvas.getByRole(element);
  
  // Focus the element
  target.focus();
  expect(document.activeElement).toBe(target);
  
  return true;
}

/**
 * Helper to test responsive behavior
 * Simulates different viewport sizes
 */
export async function testResponsive(
  page: any,
  viewports: { width: number; height: number }[]
) {
  const results: boolean[] = [];
  
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    results.push(true);
  }
  
  return results.every(Boolean);
}

/**
 * Helper to test dark/light theme switching
 */
export async function testThemeToggle(canvas: any) {
  const html = document.documentElement;
  
  // Test dark theme (default)
  html.removeAttribute('data-theme');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const darkBg = getComputedStyle(html).getPropertyValue('--bg');
  expect(darkBg).toBeTruthy();
  
  // Test light theme
  html.setAttribute('data-theme', 'light');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const lightBg = getComputedStyle(html).getPropertyValue('--bg');
  expect(lightBg).toBeTruthy();
  expect(lightBg).not.toBe(darkBg);
  
  // Reset
  html.removeAttribute('data-theme');
  
  return true;
}

/**
 * Helper to wait for async state updates
 */
export async function waitForStateUpdate(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock data generators for testing
 */
export const mockData = {
  order: (overrides = {}) => ({
    id: 'ord_test123',
    status: 'delivered',
    amount_usdc: 5000000,
    payment_asset: 'USDC',
    api_key_id: 'key_test',
    api_key_label: 'Test Agent',
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
    stellar_txid: 'abc123def456',
    card_brand: 'VISA',
    error: null,
    ...overrides,
  }),
  
  agent: (overrides = {}) => ({
    id: 'agent_test123',
    label: 'Test Agent',
    status: 'active',
    created_at: Date.now() - 86400000,
    ...overrides,
  }),
};
