// @ts-check
// Security headers middleware using Helmet.
//
// Part 1 of #341. The API is JSON-only (see src/middleware/notFound.js for
// why no route here ever returns an HTML body), so the header set is
// Helmet's defaults plus an explicit, deliberately *narrow* set of
// overrides. Two properties matter more than the individual headers:
//
//   1. Fail closed at boot. Helmet is permissive: a misconfigured option
//      is silently ignored rather than rejected, so a typo ships a weaker
//      header set and nothing logs. `assertHelmetOptions` below turns
//      that into a throw at process start, where it is caught in review
//      rather than by an incident.
//
//   2. HSTS is the one header here that is effectively irreversible.
//      `includeSubDomains` + `preload` are honoured by the browser for
//      `maxAge` seconds, and a user cannot be talked out of it early, so
//      hardcoding 2 years means a bad deploy locks every subdomain of the
//      registrable domain into HTTPS-only for 63072000s. That is why the
//      values are env-tunable and why the production floor is enforced.

const helmet = require('helmet');

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

/**
 * Rejects a Helmet option bag that Helmet itself would silently ignore.
 *
 * Helmet 8 drops unrecognised keys without warning, and coerces bad scalar
 * values by falling back to its own default. Both failure modes land the
 * same way: the process boots, the header looks "configured" in review,
 * and the browser receives something weaker than the author intended.
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
 * Creates and returns the security headers middleware configured for Stellar_Card backend API.
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

  return helmet({
    ...DEFAULT_OPTIONS,
    ...customOptions,
    hsts,
  });
}

const securityHeaders = createSecurityHeadersMiddleware();

module.exports = {
  createSecurityHeadersMiddleware,
  securityHeaders,
  assertHelmetOptions,
  DEFAULT_OPTIONS,
};
