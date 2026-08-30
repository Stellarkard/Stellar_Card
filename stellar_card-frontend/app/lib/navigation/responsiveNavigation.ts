/**
 * Responsive navigation layout utilities
 * Part 1: Mobile and desktop navigation state management
 * Provides hooks and utilities for adaptive navigation layouts
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface NavBreakpoints {
  mobile: number;
  tablet: number;
  desktop: number;
}

export interface NavState {
  isMobileMenuOpen: boolean;
  isDesktopSidebarCollapsed: boolean;
  currentBreakpoint: 'mobile' | 'tablet' | 'desktop';
  viewportWidth: number;
}

const DEFAULT_BREAKPOINTS: NavBreakpoints = {
  mobile: 768,
  tablet: 1024,
  desktop: 1280,
};

/**
 * useViewportSize hook - tracks viewport dimensions
 * Debounced to prevent excessive re-renders during resize
 */
export function useViewportSize(debounceMs = 150) {
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      }, debounceMs);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [debounceMs]);

  return size;
}

/**
 * useBreakpoint hook - determines current breakpoint
 * Returns mobile, tablet, or desktop based on viewport width
 */
export function useBreakpoint(
  breakpoints: NavBreakpoints = DEFAULT_BREAKPOINTS
): 'mobile' | 'tablet' | 'desktop' {
  const { width } = useViewportSize();

  if (width < breakpoints.mobile) return 'mobile';
  if (width < breakpoints.desktop) return 'tablet';
  return 'desktop';
}

/**
 * useMediaQuery hook - custom media query matching
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

/**
 * useResponsiveNavigation hook - main navigation state management
 * Handles mobile menu, sidebar collapse, and responsive behavior
 */
export function useResponsiveNavigation(
  breakpoints: NavBreakpoints = DEFAULT_BREAKPOINTS
) {
  const currentBreakpoint = useBreakpoint(breakpoints);
  const { width } = useViewportSize();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);

  // Close mobile menu when transitioning to desktop
  useEffect(() => {
    if (currentBreakpoint === 'desktop' && isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  }, [currentBreakpoint, isMobileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (isMobileMenuOpen) {
      const originalOverflow = document.body.style.overflow;
      const originalPosition = document.body.style.position;
      
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'relative';

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.position = originalPosition;
      };
    }

    return undefined;
  }, [isMobileMenuOpen]);

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  const openMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(true);
  }, []);

  const toggleDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarCollapsed((prev) => !prev);
  }, []);

  const collapseDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarCollapsed(true);
  }, []);

  const expandDesktopSidebar = useCallback(() => {
    setIsDesktopSidebarCollapsed(false);
  }, []);

  const isMobile = currentBreakpoint === 'mobile';
  const isTablet = currentBreakpoint === 'tablet';
  const isDesktop = currentBreakpoint === 'desktop';

  return {
    // State
    isMobileMenuOpen,
    isDesktopSidebarCollapsed,
    currentBreakpoint,
    viewportWidth: width,

    // Breakpoint checks
    isMobile,
    isTablet,
    isDesktop,

    // Mobile menu actions
    toggleMobileMenu,
    closeMobileMenu,
    openMobileMenu,

    // Desktop sidebar actions
    toggleDesktopSidebar,
    collapseDesktopSidebar,
    expandDesktopSidebar,
  };
}

/**
 * useFocusTrap hook - traps focus within navigation menu
 * Essential for accessibility in mobile menus
 */
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return undefined;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement?.focus();
          e.preventDefault();
        }
      } else if (document.activeElement === lastElement) {
        firstElement?.focus();
        e.preventDefault();
      }
    };

    container.addEventListener('keydown', handleTabKey);
    firstElement?.focus();

    return () => {
      container.removeEventListener('keydown', handleTabKey);
    };
  }, [isActive]);

  return containerRef;
}

/**
 * useScrollLock hook - prevents background scrolling
 * Used when mobile menu or modals are open
 */
export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (isLocked) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${scrollbarWidth}px`;

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }

    return undefined;
  }, [isLocked]);
}

/**
 * useSwipeGesture hook - detects swipe gestures for mobile menu
 * Allows swipe-to-open/close navigation
 */
export function useSwipeGesture(
  onSwipeLeft?: () => void,
  onSwipeRight?: () => void,
  threshold = 50
) {
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const distance = touchEndX.current - touchStartX.current;

    if (Math.abs(distance) > threshold) {
      if (distance > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }
    }
  }, [onSwipeLeft, onSwipeRight, threshold]);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  };
}

/**
 * Navigation persistence utilities
 * Saves/loads navigation preferences (e.g., sidebar collapsed state)
 */
const NAV_PREFERENCES_KEY = 'stellar_card.nav.preferences';

export interface NavPreferences {
  sidebarCollapsed: boolean;
  preferredBreakpoint?: 'mobile' | 'tablet' | 'desktop';
}

export function getNavPreferences(): NavPreferences {
  if (typeof window === 'undefined') {
    return { sidebarCollapsed: false };
  }

  try {
    const stored = window.localStorage.getItem(NAV_PREFERENCES_KEY);
    if (!stored) return { sidebarCollapsed: false };

    return JSON.parse(stored) as NavPreferences;
  } catch {
    return { sidebarCollapsed: false };
  }
}

export function saveNavPreferences(prefs: Partial<NavPreferences>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = getNavPreferences();
    const updated = { ...current, ...prefs };
    window.localStorage.setItem(NAV_PREFERENCES_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save nav preferences:', error);
  }
}

/**
 * usePersistedNavigation hook - navigation with localStorage persistence
 */
export function usePersistedNavigation(
  breakpoints: NavBreakpoints = DEFAULT_BREAKPOINTS
) {
  const nav = useResponsiveNavigation(breakpoints);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    if (!isHydrated) {
      const prefs = getNavPreferences();
      if (prefs.sidebarCollapsed && nav.isDesktop) {
        nav.collapseDesktopSidebar();
      }
      setIsHydrated(true);
    }
  }, [isHydrated, nav]);

  // Save preferences when sidebar state changes
  useEffect(() => {
    if (isHydrated && nav.isDesktop) {
      saveNavPreferences({ sidebarCollapsed: nav.isDesktopSidebarCollapsed });
    }
  }, [nav.isDesktopSidebarCollapsed, nav.isDesktop, isHydrated]);

  return nav;
}
