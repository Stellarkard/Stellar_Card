# stellar_card — Web frontend

Next.js 16 app for [stellar_card.com](https://stellar_card.com). Marketing site, API docs, and admin dashboard.

## Development

```bash
# Start local dev server on :3000
npm run dev

# Production build
npm run build

# TypeScript typecheck
npm run typecheck

# ESLint check
npm run lint

# Start Storybook component environment (:6006)
npm run storybook
```

## Testing & Cross-Browser QA

```bash
# Run unit & component tests (Vitest)
npm test

# Run Playwright E2E cross-browser tests (Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari)
npm run test:e2e

# Run Playwright accessibility audit
npm run test:a11y
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Production only | Backend API base URL, e.g. `https://api.stellar_card.com` |

In development the dashboard defaults to `http://localhost:4000` for its API base.

## Docker Container

```bash
# Run frontend via Docker Compose from repository root
docker compose up frontend

# Development with hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up frontend
```

For comprehensive Docker Compose documentation, see the project's [DOCKER_GUIDE.md](../DOCKER_GUIDE.md).

## Structure

```
app/
  page.tsx             Marketing landing page
  docs/                HTTP API reference + quickstart
  dashboard/           Operator dashboard (email OTP auth, redirects to /overview)
  pricing/ company/    Marketing pages (careers, press, security, etc.)
  blog/ changelog/     Editorial surface + RSS feed
  legal/ privacy/ terms/  Legal pages
  components/          Shared UI components
  globals.css          Global styles + brand CSS variables
  layout.tsx           Root layout: fonts, metadata template, JSON-LD
  sitemap.ts robots.ts manifest.ts opengraph-image.tsx
e2e/                   Playwright E2E & cross-browser test suite
.storybook/            Storybook setup & accessibility addons
public/
  skill.md             Agent-facing setup guide
  llms.txt             Machine-readable service index
  logo-light.svg       Brand logo (dark-bg variant)
```

## Notes

- Uses `next/font/google` for Fraunces (display), IBM Plex Sans (body), and IBM Plex Mono (data). The build downloads font files from Google Fonts at build time — ensure outbound HTTPS access is available in your build environment.
- The dashboard authenticates via email OTP (6-digit code), session cookie is `sameSite: strict`. The marketing surface is fully public.
- Next.js 16 file conventions are in force: middleware lives in `proxy.ts` at the web root (the old `middleware.ts` name is deprecated and logs a migration notice in the dev server).
- Includes comprehensive cross-browser test coverage across Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari.
- Theme tokens and wallet connection states are documented in `STATE_SYSTEM_GUIDE.md` and accessible via Storybook.
