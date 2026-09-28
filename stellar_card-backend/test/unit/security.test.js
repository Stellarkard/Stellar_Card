require('../helpers/env');

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const express = require('express');
const {
  createSecurityHeadersMiddleware,
  securityHeaders,
  assertHelmetOptions,
  DEFAULT_OPTIONS,
} = require('../../src/middleware/security');

/**
 * Mounts a middleware on a throwaway app. The route is registered on both
 * `/test` and `/test-custom` because the pre-existing customization test
 * (kept verbatim below) probes the latter.
 */
function appWith(middleware) {
  const app = express();
  app.use(middleware);
  const handler = (req, res) => res.json({ ok: true });
  app.get('/test', handler);
  app.get('/test-custom', handler);
  return app;
}

describe('Security Headers Middleware (Helmet)', () => {
  it('applies default secure headers to HTTP responses', async () => {
    const app = appWith(securityHeaders);

    const res = await supertest(app).get('/test');

    assert.equal(res.status, 200);
    // HSTS header
    assert.ok(res.headers['strict-transport-security']);
    assert.match(res.headers['strict-transport-security'], /max-age=63072000/);
    assert.match(res.headers['strict-transport-security'], /includeSubDomains/);
    assert.match(res.headers['strict-transport-security'], /preload/);

    // Frameguard (X-Frame-Options)
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');

    // X-Content-Type-Options
    assert.equal(res.headers['x-content-type-options'], 'nosniff');

    // Referrer-Policy
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  it('allows customizing security header options via testing hook factory', async () => {
    const customMiddleware = createSecurityHeadersMiddleware({
      frameguard: { action: 'deny' },
      hsts: { maxAge: 31536000, includeSubDomains: false },
    });

    const app = appWith(customMiddleware);

    const res = await supertest(app).get('/test-custom');

    assert.equal(res.status, 200);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.match(res.headers['strict-transport-security'], /max-age=31536000/);
    assert.doesNotMatch(res.headers['strict-transport-security'], /includeSubDomains/);
  });

  // Part 1 additions: the original two tests above pin a happy path each.
  // Every one of them passes even if the middleware is mounted *after* the
  // routes it is supposed to protect, or throws away half the config, so
  // the rest of this file is about the properties that make the header set
  // trustworthy rather than merely present.
  it('emits the full default header set, not just the four pinned above', async () => {
    const res = await supertest(appWith(securityHeaders)).get('/test');

    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-dns-prefetch-control'], 'off');
    assert.equal(res.headers['x-download-options'], 'noopen');
    assert.equal(res.headers['x-permitted-cross-domain-policies'], 'none');
    assert.equal(res.headers['x-xss-protection'], '0');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(res.headers['origin-agent-cluster'], '?1');
    // object-src 'none' is the directive that actually stops a stored-XSS
    // payload via <object>/<embed>; assert on the CSP rather than trusting
    // that Helmet's default bundle is still the one we reviewed.
    assert.match(res.headers['content-security-policy'], /object-src 'none'/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.match(res.headers['content-security-policy'], /base-uri 'self'/);
  });

  it('keeps headers on error responses, not just 2xx', async () => {
    // The headers are set by middleware that runs before routing, so a
    // handler that throws must still emit them. A config that only
    // attaches headers on success would leak a CSP-less body on 500s,
    // which is exactly the response an attacker is steering toward.
    const app = express();
    app.use(securityHeaders);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.use((err, req, res, _next) => res.status(500).json({ error: 'internal_error' }));

    const res = await supertest(app).get('/boom');

    assert.equal(res.status, 500);
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.ok(res.headers['strict-transport-security']);
    assert.ok(res.headers['content-security-policy']);
  });

  it('keeps headers on 304 Not Modified responses', async () => {
    // Helmet sets headers before the handler runs, but a 304 replaces the
    // body and Express strips entity headers; a cache revalidation that
    // came back without X-Frame-Options would be a real downgrade.
    const app = express();
    app.use(securityHeaders);
    app.get('/cached', (req, res) => {
      res.set('ETag', '"v1"');
      res.json({ a: 1 });
    });

    const first = await supertest(app).get('/cached');
    const second = await supertest(app).get('/cached').set('If-None-Match', first.headers.etag);

    assert.equal(second.status, 304);
    assert.equal(second.headers['x-frame-options'], 'SAMEORIGIN');
    assert.ok(second.headers['strict-transport-security']);
  });

  it('keeps headers on CORS preflight responses', async () => {
    const res = await supertest(appWith(securityHeaders))
      .options('/test')
      .set('Origin', 'https://example.test')
      .set('Access-Control-Request-Method', 'GET');

    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.ok(res.headers['content-security-policy']);
  });

  describe('fail-closed option validation', () => {
    it('accepts the shipped defaults and the documented overrides', () => {
      assert.doesNotThrow(() => assertHelmetOptions(DEFAULT_OPTIONS));
      assert.doesNotThrow(() => assertHelmetOptions({}));
      assert.doesNotThrow(() => assertHelmetOptions({ hsts: false, frameguard: false }));
      assert.doesNotThrow(() =>
        assertHelmetOptions({ frameguard: { action: 'same-site' }, noSniff: false }),
      );
    });

    it('rejects a frameguard action Helmet would silently drop', () => {
      // The reason this exists: Helmet 8 does not validate `action`. This
      // constructs fine, boots fine, and then emits whatever Helmet's
      // internal default is — so the mismatch is invisible until someone
      // reads the header off a live response.
      assert.throws(
        () => createSecurityHeadersMiddleware({ frameguard: { action: 'sameorigin ' } }),
        /frameguard\.action/,
      );
      assert.throws(
        () => createSecurityHeadersMiddleware({ frameguard: { action: 'nope' } }),
        /frameguard\.action/,
      );
    });

    it('rejects malformed scalar options at construction time', () => {
      assert.throws(
        () => createSecurityHeadersMiddleware({ hsts: { maxAge: '63072000' } }),
        /hsts\.maxAge/,
      );
      assert.throws(
        () => createSecurityHeadersMiddleware({ hsts: { maxAge: -1 } }),
        /hsts\.maxAge/,
      );
      assert.throws(
        () => createSecurityHeadersMiddleware({ hsts: { preload: 'yes' } }),
        /hsts\.preload/,
      );
      assert.throws(() => createSecurityHeadersMiddleware({ noSniff: 'true' }), /noSniff/);
      assert.throws(
        () => createSecurityHeadersMiddleware({ referrerPolicy: { policy: 'no-referer' } }),
        /referrerPolicy\.policy/,
      );
    });

    it('rejects a non-object option bag', () => {
      assert.throws(() => createSecurityHeadersMiddleware(null), /plain object/);
      assert.throws(() => createSecurityHeadersMiddleware([]), /plain object/);
      assert.throws(
        () => createSecurityHeadersMiddleware({ hsts: 'on', frameguard: 'deny' }),
        /must be an object/,
      );
    });
  });

  describe('SECURITY_HSTS_MAX_AGE', () => {
    const original = process.env.SECURITY_HSTS_MAX_AGE;

    afterEach(() => {
      if (original === undefined) delete process.env.SECURITY_HSTS_MAX_AGE;
      else process.env.SECURITY_HSTS_MAX_AGE = original;
    });

    it('falls back to the 2-year default when unset or empty', async () => {
      delete process.env.SECURITY_HSTS_MAX_AGE;
      const res = await supertest(appWith(createSecurityHeadersMiddleware())).get('/test');
      assert.match(res.headers['strict-transport-security'], /max-age=63072000/);

      process.env.SECURITY_HSTS_MAX_AGE = '';
      const empty = await supertest(appWith(createSecurityHeadersMiddleware())).get('/test');
      assert.match(empty.headers['strict-transport-security'], /max-age=63072000/);
    });

    it('shortens the lock-in when an operator needs to', async () => {
      process.env.SECURITY_HSTS_MAX_AGE = '300';
      const res = await supertest(appWith(createSecurityHeadersMiddleware())).get('/test');

      assert.match(res.headers['strict-transport-security'], /max-age=300/);
      // Only max-age is operator-tunable: includeSubDomains/preload are the
      // parts that reach sibling hosts, so they stay pinned to the defaults.
      assert.match(res.headers['strict-transport-security'], /includeSubDomains/);
      assert.match(res.headers['strict-transport-security'], /preload/);
    });

    it('can be disabled outright, which is how a plain-HTTP host escapes it', async () => {
      process.env.SECURITY_HSTS_MAX_AGE = '0';
      const res = await supertest(appWith(createSecurityHeadersMiddleware())).get('/test');

      assert.equal(res.headers['strict-transport-security'], undefined);
      // Disabling HSTS must not take the rest of the set with it.
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('refuses a non-integer value rather than silently defaulting', () => {
      // Failing closed here is the whole point: if this fell back to the
      // default, a typo like "1y" would look like it took effect.
      for (const bad of ['1y', 'forever', '-1', '300.5', 'NaN', ' ']) {
        process.env.SECURITY_HSTS_MAX_AGE = bad;
        assert.throws(
          () => createSecurityHeadersMiddleware(),
          /SECURITY_HSTS_MAX_AGE/,
          `expected ${JSON.stringify(bad)} to be rejected`,
        );
      }
    });

    it('is not read when the caller pins hsts itself', () => {
      process.env.SECURITY_HSTS_MAX_AGE = 'not-a-number';
      // A test that disables HSTS explicitly must not have to care about
      // unrelated environment state.
      assert.doesNotThrow(() => createSecurityHeadersMiddleware({ hsts: false }));
    });
  });
});
