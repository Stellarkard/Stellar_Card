# Automated accessibility audits

`accessibility.spec.ts` loads the home and dashboard routes in Chromium and
runs axe-core against the rendered document. CI blocks new critical or serious
violations and uploads the Playwright report when an audit fails.

Add important public routes to `auditedPages`. Lower-impact findings remain
visible to local exploratory audits without making CI excessively noisy.
