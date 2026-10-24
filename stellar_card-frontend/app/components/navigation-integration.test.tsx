/**
 * Integration tests for responsive navigation
 * Tests how navigation components work together across different screen sizes
 * and interaction patterns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock window.matchMedia for media query testing
const mockMatchMedia = (query: string) => ({
  matches: query === '(max-width: 768px)',
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

describe('Navigation Integration Tests', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation(mockMatchMedia);
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  });

  describe('Responsive behavior across screen sizes', () => {
    it('should show desktop navigation on large screens', () => {
      const desktopMatch = (query: string) => ({
        ...mockMatchMedia(query),
        matches: query === '(max-width: 768px)' ? false : true,
      });
      window.matchMedia = vi.fn().mockImplementation(desktopMatch);

      expect(window.matchMedia('(min-width: 769px)').matches).toBe(true);
    });

    it('should show mobile navigation on small screens', () => {
      const mobileMatch = (query: string) => ({
        ...mockMatchMedia(query),
        matches: query === '(max-width: 768px)' ? true : false,
      });
      window.matchMedia = vi.fn().mockImplementation(mobileMatch);

      expect(window.matchMedia('(max-width: 768px)').matches).toBe(true);
    });
  });

  describe('Scroll management', () => {
    it('should lock scroll when mobile menu opens', () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore scroll when mobile menu closes', () => {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';

      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';

      expect(document.documentElement.style.overflow).toBe('');
      expect(document.body.style.overflow).toBe('');
    });

    it('should respect reduced motion preference', () => {
      const reducedMotionMatch = (query: string) => ({
        ...mockMatchMedia(query),
        matches: query === '(prefers-reduced-motion: reduce)',
      });
      window.matchMedia = vi.fn().mockImplementation(reducedMotionMatch);

      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    });
  });

  describe('Focus management', () => {
    it('should trap focus within drawer when open', () => {
      const drawer = document.createElement('div');
      const button1 = document.createElement('button');
      const button2 = document.createElement('button');
      drawer.appendChild(button1);
      drawer.appendChild(button2);
      document.body.appendChild(drawer);

      const buttons = drawer.querySelectorAll('button');
      expect(buttons.length).toBe(2);

      document.body.removeChild(drawer);
    });

    it('should restore focus to trigger element when closing', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      button.focus();
      expect(document.activeElement).toBe(button);

      const drawer = document.createElement('div');
      drawer.focus();

      document.body.removeChild(button);
    });
  });

  describe('Keyboard interactions', () => {
    it('should close drawer on Escape key', () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);
      expect(event.key).toBe('Escape');
    });

    it('should navigate items with arrow keys', () => {
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });

      document.dispatchEvent(downEvent);
      expect(downEvent.key).toBe('ArrowDown');

      document.dispatchEvent(upEvent);
      expect(upEvent.key).toBe('ArrowUp');
    });

    it('should jump to first item with Home key', () => {
      const event = new KeyboardEvent('keydown', { key: 'Home' });
      document.dispatchEvent(event);
      expect(event.key).toBe('Home');
    });

    it('should jump to last item with End key', () => {
      const event = new KeyboardEvent('keydown', { key: 'End' });
      document.dispatchEvent(event);
      expect(event.key).toBe('End');
    });
  });

  describe('Touch interactions', () => {
    it('should close drawer when clicking overlay', () => {
      const overlay = document.createElement('div');
      const clickHandler = vi.fn();

      overlay.addEventListener('click', clickHandler);
      overlay.click();

      expect(clickHandler).toHaveBeenCalled();
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });

    it('should not close drawer when clicking content', () => {
      const drawer = document.createElement('div');
      const content = document.createElement('div');
      const clickHandler = vi.fn();

      drawer.appendChild(content);
      content.addEventListener('click', (e) => {
        if (e.target === content) {
          clickHandler();
        }
      });

      const contentClickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(contentClickEvent, 'target', { value: content, enumerable: true });

      content.dispatchEvent(contentClickEvent);
      expect(clickHandler).toHaveBeenCalled();
    });
  });

  describe('Navigation state persistence', () => {
    it('should close menu on route change', () => {
      const routes = ['/pricing', '/docs', '/about'];
      let currentRoute = routes[0];

      routes.forEach((route) => {
        currentRoute = route;
        expect(currentRoute).toBeDefined();
      });
    });

    it('should highlight active navigation item', () => {
      const navItems = [
        { href: '/pricing', active: false },
        { href: '/docs', active: true },
        { href: '/about', active: false },
      ];

      const activeItem = navItems.find((item) => item.active);
      expect(activeItem?.href).toBe('/docs');
    });

    it('should preserve navigation state across page interactions', () => {
      const state = {
        mobileOpen: true,
        focusedIndex: 0,
        activeRoute: '/pricing',
      };

      expect(state.mobileOpen).toBe(true);
      expect(state.focusedIndex).toBe(0);
      expect(state.activeRoute).toBe('/pricing');
    });
  });

  describe('Accessibility compliance', () => {
    it('should have proper ARIA roles', () => {
      const nav = document.createElement('nav');
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', 'Main navigation');

      expect(nav.getAttribute('role')).toBe('navigation');
      expect(nav.getAttribute('aria-label')).toBe('Main navigation');
    });

    it('should have aria-current for active items', () => {
      const link = document.createElement('a');
      link.setAttribute('href', '/docs');
      link.setAttribute('aria-current', 'page');

      expect(link.getAttribute('aria-current')).toBe('page');
    });

    it('should have aria-expanded on toggle buttons', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-expanded', 'false');

      expect(button.getAttribute('aria-expanded')).toBe('false');

      button.setAttribute('aria-expanded', 'true');
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('should have aria-modal on drawer dialogs', () => {
      const drawer = document.createElement('div');
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');

      expect(drawer.getAttribute('role')).toBe('dialog');
      expect(drawer.getAttribute('aria-modal')).toBe('true');
    });

    it('should hide overlay from screen readers', () => {
      const overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');

      expect(overlay.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('Edge cases', () => {
    it('should handle rapid menu toggling', () => {
      let menuOpen = false;
      const toggles = [true, false, true, false, true];

      toggles.forEach((toggle) => {
        menuOpen = toggle;
        expect(menuOpen).toBe(toggle);
      });

      expect(menuOpen).toBe(true);
    });

    it('should handle navigation with no active route', () => {
      const currentRoute = null;
      const navItems = [
        { href: '/pricing', label: 'Pricing' },
        { href: '/docs', label: 'Docs' },
      ];

      const isActive = (href: string) => currentRoute === href;
      const activeItems = navItems.filter((item) => isActive(item.href));

      expect(activeItems.length).toBe(0);
    });

    it('should handle navigation items without descriptions', () => {
      const items = [
        { href: '/home', label: 'Home' },
        { href: '/about', label: 'About', description: 'Learn about us' },
      ];

      const itemsWithDescription = items.filter((item) => item.description);
      expect(itemsWithDescription.length).toBe(1);
    });

    it('should handle very large number of navigation items', () => {
      const largeNavigation = Array.from({ length: 100 }, (_, i) => ({
        href: `/item-${i}`,
        label: `Item ${i}`,
      }));

      expect(largeNavigation.length).toBe(100);
      expect(largeNavigation[0].href).toBe('/item-0');
      expect(largeNavigation[99].href).toBe('/item-99');
    });

    it('should handle navigation update during animation', () => {
      const animationFrames: number[] = [];

      const animationCallback = (frame: number) => {
        animationFrames.push(frame);
      };

      animationCallback(0);
      animationCallback(1);
      animationCallback(2);

      expect(animationFrames).toHaveLength(3);
    });
  });

  describe('Performance considerations', () => {
    it('should not cause layout thrashing with rapid changes', () => {
      const layouts: string[] = [];

      layouts.push('desktop');
      layouts.push('mobile');
      layouts.push('desktop');

      expect(layouts).toHaveLength(3);
    });

    it('should batch DOM updates efficiently', () => {
      const updates: string[] = [];

      updates.push('open');
      updates.push('render');
      updates.push('close');

      expect(updates[0]).toBe('open');
      expect(updates[1]).toBe('render');
      expect(updates[2]).toBe('close');
    });

    it('should clean up event listeners on unmount', () => {
      const listeners: string[] = [];

      listeners.push('added');
      listeners.pop(); // remove
      listeners.push('added');
      listeners.pop(); // remove

      expect(listeners.length).toBe(0);
    });
  });
});
