# Accessibility (a11y) Guidelines

This document covers accessibility standards and practices for the Stellar Card frontend.

## Core Principles

### 1. Perceivable
Users must be able to perceive information:
- Sufficient color contrast (WCAG AA: 4.5:1 for text, 3:1 for graphics)
- Alternative text for images
- Clear focus indicators
- Readable font sizes (min 16px on mobile)

### 2. Operable
Users must be able to operate all functionality:
- Keyboard navigation for all interactive elements
- Focus visible states
- No keyboard traps
- Touch targets at least 44x44px
- Tab order makes sense

### 3. Understandable
Users must understand the content and interface:
- Clear, simple language
- Consistent navigation patterns
- Labels for form inputs
- Error messages describe problems clearly
- Help and documentation available

### 4. Robust
Content must work with assistive technologies:
- Valid HTML/semantic markup
- Proper ARIA roles and attributes
- Live region updates announced
- Text alternatives for icons

## Component Accessibility

### Buttons

✅ **Do:**
```tsx
// Simple text content - auto-generates aria-label
<Button>Save Changes</Button>

// Explicit aria-label for icon buttons
<Button icon={<Icon />} aria-label="Close" />

// Decorative icons marked as aria-hidden
<Button>
  <Icon aria-hidden="true" />
  Send
</Button>
```

❌ **Don't:**
```tsx
// Unclear icon-only button
<Button>{<Icon />}</Button>

// No aria-label for interactive element
<button>{<TrashIcon />}</button>
```

### Form Inputs

✅ **Do:**
```tsx
<label htmlFor="email">Email</label>
<Input
  id="email"
  type="email"
  aria-label="Email address"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby="email-error"
/>
{hasError && <span id="email-error">Invalid email</span>}
```

❌ **Don't:**
```tsx
// No label association
<Input placeholder="Email" />

// Missing error connection
<Input aria-invalid={true} />
<span>Invalid email</span>
```

### Toggle Switches

✅ **Do:**
```tsx
<Toggle
  checked={isEnabled}
  onChange={setEnabled}
  label="Send notifications"
  role="switch"
  aria-checked={isEnabled}
  aria-label="Enable notifications"
/>
```

❌ **Don't:**
```tsx
// Not marked as switch role
<button onClick={toggle}>{isEnabled ? 'On' : 'Off'}</button>
```

### Links vs Buttons

✅ **Do:**
```tsx
// Navigation
<a href="/dashboard">Dashboard</a>

// Action
<button onClick={save}>Save</button>

// Opens new window
<a href="/docs" target="_blank" rel="noopener noreferrer">
  Docs (opens in new tab)
</a>
```

❌ **Don't:**
```tsx
// Unclear intent
<a href="#" onClick={handleAction}>Click me</a>

// Keyboard inaccessible
<div onClick={handleAction}>Action</div>
```

### Lists & Navigation

✅ **Do:**
```tsx
<nav aria-label="Main navigation">
  <ul>
    <li><a href="/dashboard">Dashboard</a></li>
    <li><a href="/agents">Agents</a></li>
    <li><a href="/settings">Settings</a></li>
  </ul>
</nav>
```

❌ **Don't:**
```tsx
// No semantic structure
<div onClick={navigate}>Dashboard</div>
```

### Error Messages

✅ **Do:**
```tsx
<div role="alert" aria-live="polite" aria-atomic="true">
  Please enter a valid amount between $0 and $1,000
</div>
```

❌ **Don't:**
```tsx
// Too vague
Error: Invalid input

// Not announced to screen readers
<span style={{ color: 'red' }}>Required field</span>
```

### Skip Links

✅ **Do:**
```tsx
<a href="#main" className="skip-link">
  Skip to main content
</a>
{/* ... header ... */}
<main id="main">{/* page content */}</main>
```

## Testing Accessibility

### 1. Keyboard Navigation

- Tab through all interactive elements
- Shift+Tab to go backward
- Enter/Space for buttons
- Arrow keys for lists/tabs
- Escape to close modals

### 2. Screen Reader Testing

Use browser built-in accessibility features:
- Chrome: Enable Screen Reader (Chrome OS) or use ChromeVox
- Firefox: Enable Screen Reader
- Safari: Turn on VoiceOver (Cmd+F5)

Test with:
- Tab to elements
- Arrow through lists
- Read page heading structure (H1 → H2 → H3)
- Verify all images have alt text

### 3. Storybook A11y Testing

Run:
```bash
npm run storybook
```

Open any story and click "Accessibility" panel to see:
- Color contrast issues
- Missing labels
- Semantic HTML problems
- ARIA violations

### 4. Automated Testing

```bash
npm run test
```

Tests use `@testing-library` which validates:
- Proper query methods (getByRole > getByLabel > getByText)
- ARIA attributes
- Focus management

### 5. Browser DevTools

**Chrome Lighthouse:**
1. DevTools → Lighthouse
2. Audit → check Accessibility
3. Review issues and fix

**WAVE Browser Extension:**
- Highlights semantic errors
- Shows alt text
- Identifies contrast issues

## Common WCAG Issues & Fixes

### Issue: Low Contrast

```tsx
// ❌ Bad
<span style={{ color: '#999', background: '#fff' }}>Text</span>

// ✅ Good
<span style={{ color: '#333', background: '#fff' }}>Text</span>
```

### Issue: Missing Focus Indicator

```tsx
// ❌ Bad
<button style={{ outline: 'none' }}>Click</button>

// ✅ Good
// Defined in globals.css
button:focus-visible {
  outline: 2px solid var(--focus-color);
}
```

### Issue: Form Inputs Without Labels

```tsx
// ❌ Bad
<input placeholder="Email" />

// ✅ Good
<label htmlFor="email">Email</label>
<input id="email" type="email" />
```

### Issue: Icon-Only Buttons

```tsx
// ❌ Bad
<button>{<TrashIcon />}</button>

// ✅ Good
<button aria-label="Delete item">{<TrashIcon aria-hidden="true" />}</button>
```

### Issue: Page Heading Structure

```tsx
// ❌ Bad - jumps from H1 to H3
<h1>Dashboard</h1>
<h3>Recent Orders</h3>

// ✅ Good - logical hierarchy
<h1>Dashboard</h1>
<h2>Recent Activity</h2>
<h3>Orders</h3>
```

## ARIA Quick Reference

### Roles
- `role="button"` - clickable element
- `role="switch"` - toggle control
- `role="alert"` - important message
- `role="status"` - status update
- `role="navigation"` - nav section
- `role="main"` - main content

### Attributes
- `aria-label` - accessible name
- `aria-labelledby` - linked label ID
- `aria-describedby` - linked description ID
- `aria-required="true"` - required form field
- `aria-invalid="true"` - invalid input
- `aria-checked="true"` - switch/checkbox state
- `aria-busy="true"` - loading state
- `aria-hidden="true"` - decorative elements
- `aria-live="polite"` - announce updates
- `aria-atomic="true"` - announce whole region

### Live Regions
```tsx
// Polite (waits for pause)
<div aria-live="polite" aria-atomic="true">
  Order saved successfully
</div>

// Assertive (interrupts)
<div aria-live="assertive" aria-atomic="true">
  Critical error detected
</div>
```

## Browser Support

All components tested for:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- iOS Safari 14+
- Chrome Android

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN: Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [WebAIM: Resources](https://webaim.org/resources/)
- [Storybook a11y addon](https://storybook.js.org/docs/react/writing-stories/accessibility-testing)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

## Accessibility Checklist

Use this checklist before each commit:

- [ ] All buttons/links have clear labels
- [ ] Form inputs have associated labels
- [ ] Color contrast passes WCAG AA (4.5:1)
- [ ] Focus indicators visible on all interactive elements
- [ ] Tab order is logical
- [ ] No keyboard traps
- [ ] Images have alt text or aria-hidden="true"
- [ ] Error messages are clear and linked to inputs
- [ ] Loading states announced to screen readers
- [ ] Modal/drawer has proper focus management
- [ ] No flash/animation faster than 3 per second
- [ ] Touch targets at least 44x44px
- [ ] Links distinguish from plain text (underline or style)
- [ ] Tested with keyboard navigation
- [ ] Tested with screen reader (VoiceOver/NVDA)
