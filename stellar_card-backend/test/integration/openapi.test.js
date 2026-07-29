// Integration tests for the published OpenAPI document and the docs UI.
//
// A spec that is merely well-formed is not worth much. The tests that
// earn their keep are the ones that fail when the document and the server
// disagree, because that is the state a client cannot detect and will
// trust anyway.
//
// Three kinds of check live here:
//
//   1. The document is served, self-consistent, and every $ref resolves.
//   2. Every documented path reaches a real handler, and every
//      documented `security: []` operation really is reachable without a
//      credential. A path removed from the router but left in the spec,
//      or an endpoint that quietly grew an auth requirement, fails here.
//   3. Every route the server exposes is either documented or on the
//      explicit exclusion list — so a new public endpoint cannot ship
//      undocumented by accident.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, resetDb } = require('../helpers/app');
const { buildOpenApiDocument, UNDOCUMENTED_PREFIXES } = require('../../src/api/openapi');

const doc = buildOpenApiDocument({ baseUrl: 'http://localhost:4000' });

/** Walk every `$ref` in the document and resolve it against the root. */
function collectRefs(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

function resolveRef(ref) {
  assert.ok(ref.startsWith('#/'), `only local refs are supported, got ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, segment) => (node === undefined ? undefined : node[segment]), doc);
}

/** Every (method, path) operation in the document. */
function operations() {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      out.push({ path, method, operation });
    }
  }
  return out;
}

/** Substitute a concrete value for each `{param}` so the path is callable. */
function concretePath(path) {
  return path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
}

describe('GET /api/openapi.json', () => {
  beforeEach(() => resetDb());

  it('serves the document without a credential', async () => {
    const res = await request.get('/api/openapi.json');
    assert.equal(res.status, 200);
    assert.match(res.type, /application\/json/);
    assert.equal(res.body.openapi, '3.0.3');
  });

  it('advertises the requesting deployment as the server', async () => {
    // A spec that hard-codes the vendor's production host sends every
    // self-hosted reader's "Try it out" call to the wrong place.
    const res = await request.get('/api/openapi.json');
    assert.equal(res.body.servers.length, 1);
    assert.ok(res.body.servers[0].url, 'a server URL must be present');
  });

  it('reports the same version GET /api/version does', async () => {
    // Two independently-maintained version strings drift, and tooling
    // picks a client based on the one in the spec.
    const [spec, version] = await Promise.all([
      request.get('/api/openapi.json'),
      request.get('/api/version'),
    ]);
    assert.equal(spec.body.info.version, version.body.version);
  });

  it('is rate limited like the other public metadata endpoints', async () => {
    const res = await request.get('/api/openapi.json');
    assert.ok(res.headers.ratelimit, 'RateLimit header should be present');
  });
});

describe('the OpenAPI document — internal consistency', () => {
  it('resolves every $ref against its own components', () => {
    const refs = [...new Set(collectRefs(doc))];
    assert.ok(refs.length > 0, 'precondition: the document uses refs');
    for (const ref of refs) {
      assert.notEqual(resolveRef(ref), undefined, `dangling $ref: ${ref}`);
    }
  });

  it('gives every operation a unique operationId', () => {
    // Codegen names client methods after these; a collision silently
    // drops one of the two.
    const ids = operations().map(({ operation }) => operation.operationId);
    assert.ok(ids.every(Boolean), 'every operation needs an operationId for client generation');
    assert.equal(new Set(ids).size, ids.length, `duplicate operationId in ${ids.join(', ')}`);
  });

  it('documents a summary and at least one response for every operation', () => {
    for (const { path, method, operation } of operations()) {
      assert.ok(operation.summary, `${method.toUpperCase()} ${path} has no summary`);
      assert.ok(
        Object.keys(operation.responses || {}).length > 0,
        `${method.toUpperCase()} ${path} documents no responses`,
      );
    }
  });

  it('declares a 2xx response for every operation', () => {
    for (const { path, method, operation } of operations()) {
      const success = Object.keys(operation.responses).filter((code) => code.startsWith('2'));
      assert.ok(success.length > 0, `${method.toUpperCase()} ${path} documents no success case`);
    }
  });

  it('references only security schemes it defines', () => {
    const defined = new Set(Object.keys(doc.components.securitySchemes));
    const used = [doc.security, ...operations().map(({ operation }) => operation.security)]
      .filter(Boolean)
      .flat()
      .flatMap((entry) => Object.keys(entry));
    for (const scheme of used) {
      assert.ok(defined.has(scheme), `undefined security scheme: ${scheme}`);
    }
  });

  it('tags every operation with a declared tag', () => {
    const declared = new Set(doc.tags.map((t) => t.name));
    for (const { path, method, operation } of operations()) {
      for (const tag of operation.tags || []) {
        assert.ok(declared.has(tag), `${method.toUpperCase()} ${path} uses undeclared tag ${tag}`);
      }
    }
  });

  it('derives the order status enum from the validator, not a copy of it', () => {
    // If someone adds a status to ORDER_STATUSES the spec must gain it in
    // the same commit. This asserts the two are the same list, which is
    // only true because openapi.js imports it.
    const { ORDER_STATUSES } = require('../../src/api/orders');
    assert.deepEqual(doc.components.schemas.OrderSummary.properties.status.enum, [
      ...ORDER_STATUSES,
    ]);
    const filter = doc.paths['/v1/orders'].get.parameters.find((p) => p.name === 'status');
    assert.deepEqual(filter.schema.enum, [...ORDER_STATUSES]);
  });
});

describe('the OpenAPI document — agreement with the router', () => {
  beforeEach(() => resetDb());

  it('routes every documented path to a real handler', async () => {
    // A 404 from the app's fallback means the spec describes a path the
    // router does not mount — the single most misleading thing a spec
    // can do.
    for (const { path, method } of operations()) {
      const res = await request[method](concretePath(path)).send({});
      assert.notEqual(
        res.status,
        404,
        `${method.toUpperCase()} ${path} is documented but not mounted`,
      );
    }
  });

  it('leaves every operation marked `security: []` reachable without a credential', async () => {
    // The tell is that the response is NOT the auth chain's rejection: a
    // 400 or 401 from the handler itself is fine, `missing_api_key` is
    // not, because it means a documented-as-public endpoint moved behind
    // the auth chain.
    const open = operations().filter(
      ({ operation }) => Array.isArray(operation.security) && operation.security.length === 0,
    );
    assert.ok(open.length > 0, 'precondition: some operations are documented as public');

    for (const { path, method } of open) {
      const res = await request[method](concretePath(path)).send({});
      assert.notEqual(
        res.body?.error,
        'missing_api_key',
        `${method.toUpperCase()} ${path} is documented as public but requires an api key`,
      );
    }
  });

  it('keeps every operation without `security: []` behind a credential', async () => {
    // The inverse, and the one that matters for disclosure: an endpoint
    // documented as authenticated must actually reject an anonymous
    // caller. /auth/me and /auth/logout use the session scheme and are
    // checked separately below.
    const guarded = operations().filter(
      ({ path, operation }) => operation.security === undefined && path.startsWith('/v1'),
    );
    assert.ok(guarded.length > 0, 'precondition: some operations inherit the api key requirement');

    for (const { path, method } of guarded) {
      const res = await request[method](concretePath(path)).send({});
      assert.equal(
        res.status,
        401,
        `${method.toUpperCase()} ${path} is documented as authenticated but answered ${res.status}`,
      );
      assert.equal(res.body.error, 'missing_api_key');
    }
  });

  it('rejects an anonymous call to the session-scoped operations', async () => {
    for (const path of ['/auth/me']) {
      const res = await request.get(path);
      assert.equal(res.status, 401, `${path} must require a session`);
    }
  });

  it('documents every public route that is not on the exclusion list', () => {
    // Walks Express's mounted layer stack and asserts each externally
    // reachable path is either in the spec or explicitly excluded. This
    // is the check that stops a new public endpoint from shipping
    // undocumented — the failure mode a hand-maintained spec always has.
    const app = require('../../src/app');

    // Path-parameter NAMES are arbitrary in OpenAPI — the router's
    // `/v1/orders/:id` and the spec's `/v1/orders/{orderId}` describe the
    // same endpoint. Compare on shape by collapsing every parameter to a
    // single placeholder, and normalise away the duplicate and trailing
    // slashes that mount-prefix concatenation produces.
    const canonical = (p) =>
      `/${p}`
        .replace(/[:{][^/}]+\}?/g, '{}')
        .replace(/\/+/g, '/')
        .replace(/(.)\/$/, '$1');

    const documented = new Set(Object.keys(doc.paths).map(canonical));

    /** @type {string[]} */
    const mounted = [];
    const walk = (stack, prefix) => {
      for (const layer of stack) {
        if (layer.route) {
          mounted.push(`${prefix}/${layer.route.path}`);
        } else if (layer.name === 'router' && layer.handle?.stack) {
          // Recover the mount prefix from the layer's regexp source.
          const source = layer.regexp?.source || '';
          const match = source.match(/^\^\\\/((?:[\w\-.]|\\\/)*)/);
          const segment = match ? `/${match[1].replace(/\\\//g, '/')}` : '';
          walk(layer.handle.stack, prefix + segment);
        }
      }
    };
    walk(app._router ? app._router.stack : app.router.stack, '');

    const undocumented = [...new Set(mounted.map(canonical))]
      .filter((path) => !documented.has(path))
      .filter(
        (path) =>
          !UNDOCUMENTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      )
      .sort();

    assert.deepEqual(
      undocumented,
      [],
      `these routes are neither documented nor on UNDOCUMENTED_PREFIXES: ${undocumented.join(', ')}`,
    );
  });
});

describe('GET /api/docs', () => {
  beforeEach(() => resetDb());

  it('serves the Swagger UI shell without a credential', async () => {
    const res = await request.get('/api/docs/');
    assert.equal(res.status, 200);
    assert.match(res.type, /text\/html/);
  });

  it('points the UI at the JSON endpoint rather than embedding a snapshot', async () => {
    // One source of truth: the bootstrap fetches /api/openapi.json at
    // load time, so the page cannot render a stale copy baked into the
    // HTML when the process started.
    const res = await request.get('/api/docs/swagger-ui-init.js');
    assert.equal(res.status, 200);
    assert.match(res.text, /"url":\s*"\/api\/openapi\.json"/);
  });

  it('serves the UI assets from this origin, not a CDN', async () => {
    const shell = await request.get('/api/docs/');
    const remote = [...shell.text.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((url) => /^https?:\/\//.test(url));
    assert.deepEqual(remote, [], `the docs page must not load from ${remote.join(', ')}`);

    const css = await request.get('/api/docs/swagger-ui.css');
    assert.equal(css.status, 200, 'the bundled stylesheet must be served locally');
  });

  it('relaxes CSP for the docs subtree only', async () => {
    // Swagger UI needs inline script and style. The relaxation must not
    // leak onto the API responses, which is the whole reason it is
    // applied per-route instead of globally.
    const docs = await request.get('/api/docs/');
    const api = await request.get('/api/version');

    assert.match(
      docs.headers['content-security-policy'] || '',
      /script-src[^;]*'unsafe-inline'/,
      'the docs page needs inline script to boot',
    );
    assert.doesNotMatch(
      api.headers['content-security-policy'] || '',
      /script-src[^;]*'unsafe-inline'/,
      'the API surface must keep the strict policy',
    );
  });

  it('permits no external origin, so the page works offline', async () => {
    const res = await request.get('/api/docs/');
    const csp = res.headers['content-security-policy'] || '';
    assert.doesNotMatch(csp, /https?:\/\//, `no remote host may be allowed: ${csp}`);
  });
});
