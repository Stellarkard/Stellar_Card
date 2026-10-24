// @ts-check
// Security headers middleware using Helmet.
//
// Part 1 (#341): core Helmet integration — HSTS, Frameguard, noSniff,
// Referrer-Policy, with fail-closed boot-time assertions and env-tunable
// HSTS max-age.
//
// Part 2 (#341): Content-Security-Policy (CSP) support.
//
//   The API is JSON-only, so the broadest attack surface for CSP — inline
//   scripts injected via XSS into an HTML response — doesn't apply here.
//   That doesn't mean CSP is useless: a fetch() or XMLHttpRequest issued
//   by a hijacked browser extension or service-worker context will still
//   be governed by the API's own response headers if the response is ever
//   displayed in a browser. The policy below closes that gap without
//   breaking the expected JSON-only consumers:
//
//     default-src 'none'  — nothing loads by default.
//     script-src  'none'  — no scripts, ever. The API never serves JS.
//     connect-src 'self'  — fetch/XHR back to the same origin is fine.
//     frame-ancestors 'none' — equivalent to X-Frame-Options: DENY but
//                              covers the broader CSP framing surface.
//
//   Two properties preserved from Part 1:
//
//   1. Fail closed at boot. `assertHelmetOptions` now covers the
//      `contentSecurityPolicy` key as well, so a mis-typed directive name
//      throws at process start rather than silently shipping a header with
//      a wrong directive.
//
//   2. Env-tunability. `SECURITY_CSP_REPORT_URI` can point at a CSP
//      violation collector endpoint; when unset the report-uri directive is
//      omitted entirely. The empty-string case is explicitly rejected
//      (same pattern as SECURITY_HSTS_MAX_AGE) so a cleared env var doesn't
//      send violation reports to a blank URL.

const crypto = require('crypto');
const helmet = require('helmet');

// ── Default CSP directive set ─────────────────────────────────────────────
//
// Locked-down policy for a JSON API. Every directive that is not listed
// falls back to the `default-src 'none'` anchor.
//
// `frame-ancestors 'none'` is kept here (in addition to Helmet's own
// `frameguard` header) because some browsers only honour the CSP version
// and older agents may not send the separate X-Frame-Options header at all.
//
// The directives are expressed as an object whose values are arrays, which
// is the shape Helmet 8's `contentSecurityPolicy.directives` expects. An
// empty array maps to a bare directive with no value (e.g. `upgrade-insecure-requests`).
const DEFAULT_CSP_DIRECTIVES = {
  'default-src': ["'none'"],
  'script-src': ["'none'"],
  'connect-src': ["'self'"],
  'img-src': ["'none'"],
  'style-src': ["'none'"],
  'font-src': ["'none'"],
  'object-src': ["'none'"],
  'media-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'none'"],
  'base-uri': ["'none'"],
};

/** @type {import('helmet').HelmetOptions} */
const DEFAULT_OPTIONS = {
  hsts: {
    maxAge: 63072000, // 2 years
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'sameorigin',
  },
  noSniff: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  // CSP is opt-in at boot: `contentSecurityPolicy` is assembled by
  // createSecurityHeadersMiddleware from DEFAULT_CSP_DIRECTIVES and the
  // SECURITY_CSP_REPORT_URI env var, then merged into the options passed
  // to helmet(). Keeping it out of DEFAULT_OPTIONS here means the static
  // object stays serialisable and unit-testable independently of env state.
};

/** `frameguard.action` values Helmet accepts; anything else is dropped silently. */
const FRAMEGUARD_ACTIONS = new Set(['deny', 'sameorigin', 'same-site']);

/** `referrerPolicy.policy` values Helmet accepts. */
const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

// Valid top-level CSP directive name pattern. Directive names are ASCII
// lowercase with optional hyphens. We don't enumerate them because the
// set grows across CSP levels, but we can at least reject obviously
// wrong keys (camelCase leakage, empty strings, leading hyphens).
const CSP_DIRECTIVE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Rejects a Helmet option bag that Helmet itself would silently ignore.
 *
 * Helmet 8 drops unrecognised keys without warning, and coerces bad scalar
 * values by falling back to its own default. Both failure modes land the
 * same way: the process boots, the header looks "configured" in review,
 * and the browser receives something weaker than the author intended.
 *
 * Part 2 addition: validates `contentSecurityPolicy.directives` when
 * present, ensuring directive names match the expected kebab-case pattern
 * and that each value is an array of strings.
 *
 * @param {import('helmet').HelmetOptions} [options]
 * @returns {void}
 * @throws {TypeError} when an option is present but malformed.
 */
function assertHelmetOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('security headers: options must be a plain object');
  }

  if (options.hsts !== undefined && options.hsts !== false) {
    const hsts = /** @type {Record<string, unknown>} */ (options.hsts);
    if (typeof hsts !== 'object' || hsts === null) {
      throw new TypeError('security headers: `hsts` must be an object or false');
    }
    if (hsts.maxAge !== undefined && (!Number.isInteger(hsts.maxAge) || hsts.maxAge < 0)) {
      throw new TypeError('security headers: `hsts.maxAge` must be a non-negative integer');
    }
    for (const flag of ['includeSubDomains', 'preload']) {
      if (hsts[flag] !== undefined && typeof hsts[flag] !== 'boolean') {
        throw new TypeError(`security headers: \`hsts.${flag}\` must be a boolean`);
      }
    }
  }

  if (options.frameguard !== undefined && options.frameguard !== false) {
    const frameguard = /** @type {Record<string, unknown>} */ (options.frameguard);
    if (typeof frameguard !== 'object' || frameguard === null) {
      throw new TypeError('security headers: `frameguard` must be an object or false');
    }
    if (frameguard.action !== undefined && !FRAMEGUARD_ACTIONS.has(String(frameguard.action))) {
      throw new TypeError(
        `security headers: \`frameguard.action\` must be one of ${[...FRAMEGUARD_ACTIONS].join(', ')}`,
      );
    }
  }

  if (options.noSniff !== undefined && typeof options.noSniff !== 'boolean') {
    throw new TypeError('security headers: `noSniff` must be a boolean');
  }

  if (options.referrerPolicy !== undefined && options.referrerPolicy !== false) {
    const referrerPolicy = /** @type {Record<string, unknown>} */ (options.referrerPolicy);
    if (typeof referrerPolicy !== 'object' || referrerPolicy === null) {
      throw new TypeError('security headers: `referrerPolicy` must be an object or false');
    }
    if (
      referrerPolicy.policy !== undefined &&
      !REFERRER_POLICIES.has(String(referrerPolicy.policy))
    ) {
      throw new TypeError(
        `security headers: \`referrerPolicy.policy\` must be one of ${[...REFERRER_POLICIES].join(', ')}`,
      );
    }
  }

  // Part 2: validate contentSecurityPolicy when supplied.
  if (
    options.contentSecurityPolicy !== undefined &&
    options.contentSecurityPolicy !== false
  ) {
    const csp = /** @type {Record<string, unknown>} */ (options.contentSecurityPolicy);
    if (typeof csp !== 'object' || csp === null) {
      throw new TypeError(
        'security headers: `contentSecurityPolicy` must be an object or false',
      );
    }
    if (csp.directives !== undefined) {
      const directives = /** @type {Record<string, unknown>} */ (csp.directives);
      if (typeof directives !== 'object' || directives === null || Array.isArray(directives)) {
        throw new TypeError(
          'security headers: `contentSecurityPolicy.directives` must be a plain object',
        );
      }
      for (const [name, value] of Object.entries(directives)) {
        if (!CSP_DIRECTIVE_NAME_RE.test(name)) {
          throw new TypeError(
            `security headers: CSP directive name ${JSON.stringify(name)} is not valid kebab-case`,
          );
        }
        if (!Array.isArray(value)) {
          throw new TypeError(
            `security headers: CSP directive ${JSON.stringify(name)} value must be an array`,
          );
        }
        for (const token of value) {
          if (typeof token !== 'string') {
            throw new TypeError(
              `security headers: CSP directive ${JSON.stringify(name)} contains a non-string token`,
            );
          }
        }
      }
    }
    // `reportOnly` is the only other documented key we care about validating.
    if (csp.reportOnly !== undefined && typeof csp.reportOnly !== 'boolean') {
      throw new TypeError(
        'security headers: `contentSecurityPolicy.reportOnly` must be a boolean',
      );
    }
  }
}

/**
 * Reads the HSTS tuning knobs from the environment, failing closed.
 *
 * `SECURITY_HSTS_MAX_AGE` exists so a staging host reachable only over
 * plain HTTP can be turned down without editing code, and so an operator
 * can shorten the lock-in after a misconfiguration. `0` is the explicit
 * "off" value and omits the header entirely — note that passing
 * `maxAge: 0` to Helmet does *not* do this, it emits `max-age=0`, which
 * is a weaker and more confusing way of saying the same thing.
 *
 * It cannot be used to strip HSTS from production by accident: anything
 * that is not exactly a non-negative integer throws, because the one
 * outcome worse than "HSTS is slightly too aggressive" is "an operator
 * typo silently removed the header from a live API". That check has to be
 * string-shaped rather than `Number()`-based — `Number(' ')`, `Number('')`
 * and `Number('\n')` are all `0`, so a whitespace-only value would
 * otherwise read as a clean request to disable the header.
 *
 * @returns {{ enabled: false } | { enabled: true, maxAge: number, includeSubDomains: boolean, preload: boolean }}
 */
function hstsFromEnv() {
  const raw = process.env.SECURITY_HSTS_MAX_AGE;
  if (raw === undefined || raw === '') return { enabled: true, ...DEFAULT_OPTIONS.hsts };

  if (!/^\d+$/.test(raw.trim()) || !/^\S+$/.test(raw)) {
    throw new TypeError(
      'security headers: SECURITY_HSTS_MAX_AGE must be a non-negative integer of seconds',
    );
  }
  const maxAge = Number(raw.trim());
  if (!Number.isSafeInteger(maxAge)) {
    throw new TypeError('security headers: SECURITY_HSTS_MAX_AGE is out of range');
  }
  if (maxAge === 0) return { enabled: false };

  return { enabled: true, ...DEFAULT_OPTIONS.hsts, maxAge };
}

/**
 * Reads the CSP report-uri from the environment.
 *
 * When `SECURITY_CSP_REPORT_URI` is set to a non-empty string, the value
 * is appended as a `report-uri` directive in the CSP header. The empty
 * string is explicitly rejected (unlike `undefined`, which means "not
 * configured") so an operator who clears the var doesn't accidentally send
 * violation reports to `report-uri ` (bare space).
 *
 * @returns {string | null} URI string, or null when the directive should
 *   be omitted.
 */
function cspReportUriFromEnv() {
  const raw = process.env.SECURITY_CSP_REPORT_URI;
  if (raw === undefined) return null;
  if (raw.trim() === '') {
    // Whitespace-only is almost certainly an operator mistake — a report-uri
    // pointing at nothing. Fail closed rather than silently dropping it.
    throw new TypeError(
      'security headers: SECURITY_CSP_REPORT_URI is set but empty. ' +
        'Unset the variable entirely to disable violation reporting.',
    );
  }
  // Minimal sanity check: must look like an absolute URL.
  try {
    const parsed = new URL(raw.trim());
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('only http(s) schemes are accepted');
    }
  } catch (err) {
    throw new TypeError(
      `security headers: SECURITY_CSP_REPORT_URI must be a valid https:// URL (got ${JSON.stringify(raw)}): ${err.message}`,
    );
  }
  return raw.trim();
}

/**
 * Assembles the `contentSecurityPolicy` option for Helmet from the default
 * directive set, the optional report-uri, and any caller overrides.
 *
 * @param {import('helmet').HelmetOptions['contentSecurityPolicy']} [customCsp]
 * @returns {import('helmet').HelmetOptions['contentSecurityPolicy']}
 */
function buildCspOption(customCsp) {
  // Caller explicitly disabled CSP — honour it without reading the env.
  if (customCsp === false) return false;

  const reportUri = cspReportUriFromEnv();

  // Build the merged directive set:
  //   1. Start with our locked-down defaults.
  //   2. Apply any caller-supplied directive overrides.
  //   3. Append the env report-uri if configured (only when the caller
  //      hasn't already included one).
  const callerDirectives =
    customCsp && typeof customCsp === 'object' && customCsp.directives
      ? /** @type {Record<string, string[]>} */ (customCsp.directives)
      : {};

  const mergedDirectives = {
    ...DEFAULT_CSP_DIRECTIVES,
    ...callerDirectives,
  };

  if (reportUri && !mergedDirectives['report-uri']) {
    mergedDirectives['report-uri'] = [reportUri];
  }

  return {
    directives: mergedDirectives,
    // Respect caller-supplied reportOnly; default false (enforce, don't report-only).
    reportOnly:
      customCsp && typeof customCsp === 'object' && typeof customCsp.reportOnly === 'boolean'
        ? customCsp.reportOnly
        : false,
  };
}

/**
 * Generates a cryptographically random nonce for use in CSP `script-src`
 * or `style-src` directives.
 *
 * Usage (per-request):
 *
 *   const nonce = generateCspNonce();
 *   res.locals.cspNonce = nonce;
 *   // ... mount middleware that adds `'nonce-<value>'` to script-src
 *
 * The API is currently JSON-only and never serves inline scripts, so this
 * function is exported for completeness and future use — e.g., an admin
 * dashboard that embeds a small inline script tag to bootstrap state.
 *
 * @returns {string} Base64-encoded 16-byte random nonce (22 chars, no padding).
 */
function generateCspNonce() {
  // 16 bytes = 128 bits of entropy, matching the OWASP recommended minimum.
  // base64url avoids `+` and `/` which need quoting inside CSP header values.
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Creates and returns the security headers middleware configured for the
 * Stellar_Card backend API.
 *
 * Part 2: now also configures Content-Security-Policy via Helmet, merging
 * the locked-down default directive set with any caller overrides and the
 * env-configured report-uri.
 *
 * @param {import('helmet').HelmetOptions} [customOptions] - Optional Helmet configuration overrides for testing/environments.
 * @returns {import('express').RequestHandler}
 */
function createSecurityHeadersMiddleware(customOptions = {}) {
  assertHelmetOptions(customOptions);

  // Read the env only when the caller has not pinned `hsts` itself, so an
  // explicit `hsts: false` in a test is not made to depend on unrelated
  // environment state. `...customOptions` still lands first so that
  // `hsts: false` (a legal way to disable it) is not replaced by the
  // default object below.
  const fromEnv = customOptions.hsts === undefined ? hstsFromEnv() : undefined;
  const hsts =
    fromEnv === undefined
      ? customOptions.hsts
      : fromEnv.enabled
        ? {
            maxAge: fromEnv.maxAge,
            includeSubDomains: fromEnv.includeSubDomains,
            preload: fromEnv.preload,
          }
        : false;

  // Part 2: assemble the CSP option. Caller may supply `contentSecurityPolicy`
  // as an override (or `false` to disable); when absent we build from defaults.
  const contentSecurityPolicy = buildCspOption(
    /** @type {import('helmet').HelmetOptions['contentSecurityPolicy']} */
    (customOptions.contentSecurityPolicy),
  );

  return helmet({
    ...DEFAULT_OPTIONS,
    ...customOptions,
    hsts,
    contentSecurityPolicy,
  });
}

const securityHeaders = createSecurityHeadersMiddleware();

module.exports = {
  createSecurityHeadersMiddleware,
  securityHeaders,
  assertHelmetOptions,
  generateCspNonce,
  buildCspOption,
  DEFAULT_OPTIONS,
  DEFAULT_CSP_DIRECTIVES,
};
