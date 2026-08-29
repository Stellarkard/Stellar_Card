import type { NextConfig } from 'next';
import path from 'path';
import withBundleAnalyzer from '@next/bundle-analyzer';

// Security headers. We set these via next.config rather than a proxy/
// edge function so they're present on static assets, ISR responses,
// and dynamic SSR pages without a second middleware roundtrip.
//
// Content-Security-Policy notes: we deliberately stop short of a full
// `script-src` lockdown. Next.js 16 injects inline `__NEXT_DATA__`
// bootstrapping scripts, so a strict script-src would require nonce
// wiring in middleware — worth doing eventually, but risky to bundle
// with a header-hardening pass. Until then we cover the attack
// vectors that DON'T need to know about scripts:
//   - frame-ancestors 'none'  blocks clickjacking and replaces the
//                             X-Frame-Options line below for modern
//                             browsers (kept for IE-compat legacy).
//   - base-uri 'self'         stops a dangling XSS from relocating
//                             the document base URL to an attacker
//                             host and hijacking relative fetches.
//   - form-action 'self'      forms can't POST to attacker origins
//                             even if an attacker injects one.
//   - object-src 'none'       Flash / plugin vector off.
const CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// HSTS: two years + includeSubDomains + preload. Preload requires
// a minimum 1-year max-age and the exact preload directive; once
// the domain is accepted onto the Chrome preload list, browsers
// refuse plaintext HTTP even on first visit.
const HSTS = 'max-age=63072000; includeSubDomains; preload';

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  // Bundle optimization: split vendor code into separate chunks so the
  // browser can cache framework code across deploys while app code changes.
  // optimizePackageImports rewrites named imports from large packages into
  // per-module requires so unused exports are tree-shaken at the module
  // boundary rather than requiring explicit paths everywhere in app code.
  // See docs/PERFORMANCE.md for detailed optimization strategies.
  experimental: {
    optimizePackageImports: ['geist', 'next/font/google'],
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      // Split dashboard shell into its own chunk so marketing pages
      // don't pay for the dashboard bundle on first load.
      config.optimization ??= {};
      config.optimization.splitChunks = {
        ...(config.optimization.splitChunks as object),
        cacheGroups: {
          // React + ReactDOM — changes rarely, should be independently cacheable.
          framework: {
            name: 'framework',
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            priority: 40,
            chunks: 'all',
            enforce: true,
          },
          // Large shared libraries (next, geist fonts).
          lib: {
            name(module: { context: string }) {
              const match = module.context?.match(
                /[\\/]node_modules[\\/](next|geist)([\\/]|$)/
              );
              return match ? `lib.${match[1]}` : 'lib';
            },
            test: /[\\/]node_modules[\\/](next|geist)[\\/]/,
            priority: 30,
            minChunks: 1,
            chunks: 'all',
          },
          // Everything else from node_modules goes into a common vendors chunk.
          vendors: {
            name: 'vendors',
            test: /[\\/]node_modules[\\/]/,
            priority: 20,
            minChunks: 2,
            chunks: 'all',
          },
        },
      };
    }
    return config;
  },
  // Image optimization hints (#133).
  // remote patterns allow the dashboard to render user avatars / agent
  // icons hosted on Cloudflare R2 without disabling the built-in
  // image optimizer. Quality 85 is a good trade-off for dashboard UIs —
  // crisp enough for data-dense tables, meaningfully smaller than 100.
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: HSTS },
          // CSP blocks eval(), which Turbopack needs for HMR in dev.
          // Only enforce in production.
          ...(isDev ? [] : [{ key: 'Content-Security-Policy', value: CSP }]),
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

// Bundle analyzer: enabled when ANALYZE=true (run: npm run build:analyze).
// Opens a browser report showing which modules make up each chunk so we
// can spot large dependencies and validate that dynamic imports are working.
const analyze = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });
export default analyze(nextConfig);
