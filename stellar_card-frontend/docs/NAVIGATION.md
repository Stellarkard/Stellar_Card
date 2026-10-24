# Responsive Navigation System

This guide explains the responsive navigation components and patterns used throughout Stellar_Card.

## Architecture

The navigation system is split into two contexts:

1. **Marketing Navigation** — Homepage, docs, company pages, legal
2. **Dashboard Navigation** — Admin dashboard with sidebar

Both use the same responsive design principles but are implemented separately to allow independent evolution.

## Components

### NavLinks

Primary navigation component for the marketing site. Responsive across all viewports.

```typescript
import { NavLinks } from '@/app/components/NavLinks';

export function Header() {
  return (
    <nav className="marketing-nav">
      <Link href="/">
        <Wordmark />
      </Link>
      <NavLinks />
    </nav>
  );
}
```

**Responsive Behavior:**

- **Desktop (> 860px)**
  - Horizontal menu with primary links (Pricing, Docs, Changelog, Company)
  - Dropdown for "More" menu (Compare, Security, Careers, Press, Affiliate)
  - Right-aligned CTA button
  - Top-level nav always visible

- **Tablet (640px - 860px)**
  - Primary links still visible
  - Dropdown triggers with hover/click

- **Mobile (< 640px)**
  - Hamburger menu replaces entire nav
  - Links collapse into fullscreen sheet
  - CTA hidden (focus on mobile experience)

**Features:**

- ESC key closes all menus
- Click outside dropdown closes it
- Route changes close all menus
- Scroll lock while mobile menu open
- Smooth transitions with CSS variables

### MobileDrawer

Reusable slide-over drawer component for mobile navigation.

```typescript
import { MobileDrawer } from '@/app/components/MobileDrawer';
import { useState } from 'react';

export function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Menu</button>
      <MobileDrawer open={open} onClose={() => setOpen(false)}>
        <nav>
          {/* Navigation content */}
        </nav>
      </MobileDrawer>
    </>
  );
}
```

**Features:**

- Fixed positioning drawer
- Overlay backdrop
- ESC key closes
- Click outside closes
- Smooth slide animation
- Scroll lock on body

### Breadcrumbs

Auto-derives breadcrumb trail from current pathname.

```typescript
import { Breadcrumbs } from '@/app/components/Breadcrumbs';

// In dashboard layout
<Breadcrumbs
  overrides={{
    agents: { label: 'All Agents', href: '/dashboard/agents' },
    'agent-123': { label: 'Test Agent' },
  }}
/>
```

**Features:**

- Auto-generates from URL segments
- Customizable labels via overrides
- Compact display (fits headers)
- Responsive truncation on mobile
- Keyboard accessible

### TabNav

Horizontal tab navigation with scroll detection.

```typescript
import { TabNav } from '@/app/components/TabNav';

export function OrdersPage() {
  return (
    <TabNav
      tabs={[
        { href: '/orders?status=pending', label: 'Pending', badge: 5 },
        { href: '/orders?status=completed', label: 'Completed' },
        { href: '/orders?status=failed', label: 'Failed' },
      ]}
    />
  );
}
```

**Features:**

- Horizontal scrolling on narrow screens
- Fade indicators at scroll edges
- Optional badge counts
- Active state styling with green underline
- Keyboard navigation

## Responsive Breakpoints

```css
/* Marketing site */
Desktop:  > 860px    /* Full horizontal layout */
Tablet:   640-860px  /* Compressed, menus stack */
Mobile:   < 640px    /* Hamburger + fullscreen sheet */

/* Dashboard */
Desktop:  > 1024px   /* Sidebar + main */
Tablet:   768-1024px /* Collapsible sidebar */
Mobile:   < 768px    /* Bottom tab bar or drawer */
```

## Patterns

### Pattern 1: Marketing Header

```typescript
import Link from 'next/link';
import { Wordmark } from '@/app/components/Wordmark';
import { NavLinks } from '@/app/components/NavLinks';

export function Header() {
  return (
    <nav
      className="marketing-nav"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 1.35rem',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
          <Wordmark height={22} />
        </Link>
        <NavLinks />
      </div>
    </nav>
  );
}
```

### Pattern 2: Dashboard Header with Breadcrumbs

```typescript
import { Breadcrumbs } from '@/app/components/Breadcrumbs';
import { useState } from 'react';
import { MobileDrawer } from '@/app/components/MobileDrawer';

export function DashboardHeader() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '0 1rem',
          height: 64,
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            display: 'none', // Show on mobile only
            cursor: 'pointer',
          }}
        >
          Menu
        </button>
        <Breadcrumbs />
      </header>

      <MobileDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        {/* Sidebar content */}
      </MobileDrawer>
    </>
  );
}
```

### Pattern 3: Section Navigation with Tabs

```typescript
import { TabNav } from '@/app/components/TabNav';

export function AdminSection() {
  return (
    <>
      <TabNav
        tabs={[
          { href: '/dashboard/settings/profile', label: 'Profile' },
          { href: '/dashboard/settings/security', label: 'Security' },
          { href: '/dashboard/settings/notifications', label: 'Notifications' },
          { href: '/dashboard/settings/team', label: 'Team', badge: 2 },
        ]}
      />
      {/* Page content */}
    </>
  );
}
```

## Mobile-First Design

All navigation components are built mobile-first:

1. **Mobile viewport is the base**
   - Single column, fullscreen menus
   - Touch targets ≥ 44px (WCAG 2.1)

2. **Tablet enhancements**
   - Menus begin to expand
   - Dropdowns appear (no touch interaction needed)

3. **Desktop optimization**
   - Horizontal layout
   - Hover states
   - Maximum content density

```typescript
// ✅ Good: mobile-first media query
@media (min-width: 860px) {
  .nav-menu { display: flex; }
}

// ❌ Avoid: desktop-first
@media (max-width: 860px) {
  .nav-menu { display: none; }
}
```

## Accessibility

### Keyboard Navigation

All navigation components support keyboard navigation:

- **Tab** — Move between items
- **Enter/Space** — Activate buttons
- **Arrow keys** — Navigate dropdowns
- **Escape** — Close menus/modals

```typescript
// Example: ESC closes menu
useEffect(() => {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenuOpen(false);
  };
  window.addEventListener('keydown', handleKey);
  return () => window.removeEventListener('keydown', handleKey);
}, []);
```

### ARIA Attributes

All navigation includes proper ARIA markup:

```typescript
<button
  aria-expanded={menuOpen}
  aria-haspopup="true"
  aria-label="Menu"
>
  Menu
</button>

<div role="navigation" aria-label="Main navigation">
  {/* Nav content */}
</div>
```

### Focus Management

- Focus moves to menu when opened (mobile drawer)
- Focus returns to trigger when closed
- Focus trap prevents focus leaving modal
- Visual focus indicators match design language

### Screen Reader Support

- Navigation structure announced clearly
- Active page indicated with `aria-current="page"`
- Badges and counts announced with `aria-label`
- Skip links present for keyboard users

## Testing

### Test Mobile Menu

```typescript
export const MobileMenu: StoryObj = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => <NavLinks />,
};
```

### Test Breadcrumbs

```typescript
export const DeepPath: StoryObj = {
  render: () => <Breadcrumbs />,
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/agents/agent-123/orders/order-456',
      },
    },
  },
};
```

### Test Tab Navigation

```typescript
export const ManyTabs: StoryObj = {
  render: () => (
    <div style={{ width: '100%', maxWidth: '600px' }}>
      <TabNav tabs={largeTabs} />
    </div>
  ),
};
```

## Performance

### Navigation Bundle Impact

- NavLinks: ~8 KB (with styles)
- MobileDrawer: ~3 KB
- Breadcrumbs: ~2 KB
- TabNav: ~5 KB

These are split into separate chunks and only loaded on navigation pages.

### Optimization Tips

1. **Use dynamic imports for drawer content**
   ```typescript
   const DrawerContent = dynamic(() => import('./DrawerNav'), {
     loading: () => <div>Loading…</div>,
   });
   ```

2. **Memoize navigation items**
   ```typescript
   const MemoNavItem = memo(NavItem);
   ```

3. **Lazy load route-specific navs**
   ```typescript
   const AdminNav = dynamic(() => import('./AdminNav'));
   ```

## Browser Support

Tested and supported on:

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- iOS Safari 14+
- Android Chrome 90+

Uses progressive enhancement:

- CSS Grid/Flexbox (with fallbacks)
- CSS Custom Properties (with defaults)
- Modern JavaScript (with polyfills where needed)

## Troubleshooting

### Menu doesn't close on route change?

Ensure `usePathname()` is used and dependency is correct:

```typescript
useEffect(() => {
  setMenuOpen(false);
}, [pathname]);  // Dependency on pathname change
```

### Mobile menu scrolls body?

Apply overflow: hidden to body/html when drawer is open:

```typescript
useEffect(() => {
  if (!open) return;
  document.documentElement.style.overflow = 'hidden';
  return () => {
    document.documentElement.style.overflow = '';
  };
}, [open]);
```

### Breadcrumbs cut off on mobile?

Breadcrumbs are designed to truncate automatically. Add scroll if needed:

```typescript
<nav style={{ overflow: 'auto', whiteSpace: 'nowrap' }}>
  <Breadcrumbs />
</nav>
```

### Tab navigation not scrolling?

Check if parent container has fixed width and overflow hidden. TabNav needs scrollable parent.
