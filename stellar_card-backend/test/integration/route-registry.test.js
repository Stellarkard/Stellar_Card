// Integration tests for the route registry (src/routes/index.js).
//
// Extracting the routes out of app.js moved ~400 lines of handler bodies
// and, critically, the mount ORDER — which is behaviour, not layout.
// Express matches middleware in registration order, so three mounts are
// load-bearing:
//
//   1. POST /v1/agent/claim must sit BEFORE the auth chain. It is how an
//      agent turns a dashboard-minted code into an api key, so requiring
//      one would be circular.
//   2. The MPP routes must sit before the auth chain for the same
//      structural reason — unauthenticated payment discovery is the
//      point of the protocol.
//   3. Everything else under /v1 must sit AFTER it.
//
// Getting rule 1 or 2 wrong breaks onboarding and MPP. Getting rule 3
// wrong silently exposes an authenticated endpoint. These tests assert
// the boundary behaviourally — by making real unauthenticated requests
// and checking which ones reach a handler — rather than by inspecting
// Express's internal layer stack, which would pin an implementation
// detail instead of the invariant.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, createTestKey, resetDb } = require('../helpers/app');

describe('route registry — unauthenticated surface', () => {
  beforeEach(() => resetDb());

  it('serves GET /api/version without an api key', async () => {
    const res = await request.get('/api/version');
    assert.equal(res.status, 200);
    assert.equal(res.body.service, 'stellar_card');
    assert.equal(res.body.hmac_protocol, 'v3');
  });

  it('serves GET /status without an api key', async () => {
    const res = await request.get('/status');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.ok, 'boolean');
    assert.ok(res.body.orders, 'status payload should carry order counters');
    assert.ok(res.body.stellar_watcher, 'status payload should carry watcher freshness');
    assert.ok(res.body.process, 'status payload should carry process uptime');
  });

  it('reaches the claim handler without an api key', async () => {
    // The tell is WHICH 4xx comes back. `missing_code` means the request
    // got past the auth chain into the handler; `missing_api_key` would
    // mean the claim endpoint had been mounted behind auth, which breaks
    // onboarding entirely.
    const res = await request.post('/v1/agent/claim').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_code');
  });

  it('rejects an unknown claim code with a generic 401, still without an api key', async () => {
    const res = await request.post('/v1/agent/claim').send({ code: 'not-a-real-code' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_claim');
  });

  it('serves the MPP discovery document without an api key', async () => {
    // MPP_ENABLED is 'true' in the test env, so the router is mounted.
    const res = await request.get('/v1/.well-known/mpp');
    assert.notEqual(res.status, 401, 'MPP discovery must not sit behind the auth chain');
  });
});

describe('route registry — the /v1 auth boundary', () => {
  beforeEach(() => resetDb());

  for (const [method, path] of [
    ['get', '/v1/orders'],
    ['post', '/v1/orders'],
    ['get', '/v1/usage'],
    ['get', '/v1/policy/check?amount=1'],
    ['post', '/v1/agent/status'],
  ]) {
    it(`requires an api key for ${method.toUpperCase()} ${path}`, async () => {
      const res = await request[method](path).send({});
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.body.error, 'missing_api_key', `${method} ${path}`);
    });
  }

  it('rejects a malformed api key rather than falling through', async () => {
    const res = await request.get('/v1/usage').set('X-Api-Key', 'not-a-real-key');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_api_key');
  });
});

describe('route registry — authenticated agent surface', () => {
  /** @type {any} */ let key;

  beforeEach(async () => {
    resetDb();
    key = await createTestKey({ label: 'registry' });
  });

  it('serves GET /v1/usage with a valid key', async () => {
    const res = await request.get('/v1/usage').set('X-Api-Key', key.key);
    assert.equal(res.status, 200);
    assert.equal(res.body.api_key_id, key.id);
    assert.ok(res.body.orders, 'usage payload should carry order counters');
    assert.ok(res.body.budget, 'usage payload should carry the budget summary');
  });

  it('serves GET /v1/policy/check with a valid key', async () => {
    const res = await request.get('/v1/policy/check?amount=5').set('X-Api-Key', key.key);
    assert.equal(res.status, 200);
    assert.ok('decision' in res.body);
  });

  it('validates the amount on GET /v1/policy/check', async () => {
    const res = await request.get('/v1/policy/check?amount=abc').set('X-Api-Key', key.key);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('serves POST /v1/agent/status with a valid key', async () => {
    const res = await request
      .post('/v1/agent/status')
      .set('X-Api-Key', key.key)
      .send({ state: 'initializing' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('rejects an unknown agent state', async () => {
    const res = await request
      .post('/v1/agent/status')
      .set('X-Api-Key', key.key)
      .send({ state: 'bogus' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_state');
  });

  it('serves GET /v1/orders with a valid key', async () => {
    const res = await request.get('/v1/orders').set('X-Api-Key', key.key);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe('route registry — app.js owns no routes', () => {
  // The extraction is only durable if app.js staying handler-free is
  // checked rather than remembered. Both halves of this suite failed
  // before the extraction was finished: app.js still carried a second
  // copy of four handlers alongside the registerRoutes() call that had
  // replaced them, so every one of those paths was mounted twice.

  it('mounts each path exactly once', async () => {
    // A double mount is invisible from the outside — the first handler
    // answers and the second is dead weight — until the two drift and a
    // fix lands in the copy that never runs.
    const app = require('../../src/app');

    /** @type {Map<string, number>} */
    const mounts = new Map();
    const walk = (stack, prefix) => {
      for (const layer of stack) {
        if (layer.route) {
          for (const method of Object.keys(layer.route.methods)) {
            const key = `${method.toUpperCase()} ${`${prefix}/${layer.route.path}`.replace(/\/+/g, '/')}`;
            mounts.set(key, (mounts.get(key) || 0) + 1);
          }
        } else if (layer.name === 'router' && layer.handle?.stack) {
          const source = layer.regexp?.source || '';
          const match = source.match(/^\^\\\/((?:[\w\-.]|\\\/)*)/);
          walk(layer.handle.stack, prefix + (match ? `/${match[1].replace(/\\\//g, '/')}` : ''));
        }
      }
    };
    walk(app._router ? app._router.stack : app.router.stack, '');

    const duplicated = [...mounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    assert.deepEqual(duplicated, [], `these paths are mounted more than once: ${duplicated}`);
  });

  it('installs the /v1 auth middleware exactly once', () => {
    // The nastier half of a double mount, and the one the path-counting
    // check above cannot see: app.use() layers carry no `route`, so a
    // second `app.use('/v1', auth)` is invisible to it. The cost is not
    // cosmetic — auth runs a bcrypt compare, so mounting it twice doubles
    // the per-request CPU on the entire agent surface and halves the
    // effective budget of the failed-auth limiter mounted alongside it.
    const app = require('../../src/app');
    const auth = require('../../src/middleware/auth');

    const stack = app._router ? app._router.stack : app.router.stack;
    const mounted = stack.filter((layer) => layer.handle === auth).length;
    assert.equal(mounted, 1, `the auth middleware is mounted ${mounted} times`);
  });

  it('declares no route handlers in app.js itself', () => {
    // The source-level counterpart: app.js may install middleware with
    // app.use(), but an app.get/post/patch/delete belongs in a module
    // under api/ that routes/index.js mounts.
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app.js'), 'utf8');

    const handlers = [...source.matchAll(/^\s*app\.(get|post|put|patch|delete)\(/gm)].map((m) =>
      m[0].trim(),
    );
    assert.deepEqual(handlers, [], `app.js declares route handlers: ${handlers.join(', ')}`);
  });
});

describe('route registry — operator surface prefixes', () => {
  beforeEach(() => resetDb());

  it('routes /dashboard/platform/* to the platform router, not the tenant one', async () => {
    // The platform router mounts on the longer prefix first. If that
    // ordering flipped, /dashboard would swallow the path and return a
    // tenant-scoped 404 instead of the platform router's own 401/403.
    const res = await request.get('/dashboard/platform/overview');
    assert.notEqual(res.status, 404, 'the platform prefix should still resolve to a handler');
  });

  it('requires a session for /dashboard', async () => {
    const res = await request.get('/dashboard/orders');
    assert.equal(res.status, 401);
  });

  it('requires a session for /internal', async () => {
    const res = await request.get('/internal/stats');
    assert.equal(res.status, 401);
  });

  it('mounts the vcc callback without a session', async () => {
    // HMAC-authenticated, so an unsigned POST must fail on the signature
    // rather than on a missing session.
    const res = await request.post('/vcc-callback').send({});
    assert.notEqual(res.status, 404, 'the callback route should be mounted');
    assert.notEqual(res.status, 200, 'an unsigned callback must not succeed');
  });
});
