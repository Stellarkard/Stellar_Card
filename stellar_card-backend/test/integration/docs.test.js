require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('../helpers/app');

describe('OpenAPI documentation', () => {
  it('GET /docs.json returns a valid OpenAPI 3 document', async () => {
    const res = await request.get('/docs.json');
    assert.equal(res.status, 200);
    assert.equal(res.body.openapi, '3.0.3');
    assert.equal(res.body.info.title, 'stellar_card API');
    assert.ok(res.body.paths['/v1/orders'], 'expected /v1/orders to be documented');
    assert.ok(res.body.paths['/v1/orders/{id}'], 'expected /v1/orders/{id} to be documented');
    assert.ok(res.body.paths['/auth/verify'], 'expected /auth/verify to be documented');
    assert.ok(
      res.body.components.securitySchemes.ApiKeyAuth,
      'expected ApiKeyAuth security scheme',
    );
  });

  it('GET /v1/orders is documented with a POST and GET operation', async () => {
    const res = await request.get('/docs.json');
    const ordersPath = res.body.paths['/v1/orders'];
    assert.ok(ordersPath.get, 'expected GET /v1/orders');
    assert.ok(ordersPath.post, 'expected POST /v1/orders');
    assert.equal(ordersPath.post.security[0].ApiKeyAuth !== undefined, true);
  });

  it('GET /docs serves the Swagger UI page', async () => {
    const res = await request.get('/docs/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /html/);
    assert.match(res.text, /swagger-ui/);
  });

  it('GET /docs applies a relaxed CSP scoped to the docs page', async () => {
    const res = await request.get('/docs/');
    assert.ok(res.headers['content-security-policy'], 'expected a CSP header on /docs');
    assert.match(res.headers['content-security-policy'], /'unsafe-inline'/);
  });

  it('documents the routes whose @openapi blocks moved out of app.js', async () => {
    // The annotations for these paths lived in app.js next to the inline
    // handler copies, and swagger-jsdoc scanned app.js to find them. The
    // extraction moved each block into the route module that owns the
    // handler; if one were dropped on the way, the path would silently
    // vanish from the published document.
    const res = await request.get('/docs.json');
    for (const path of [
      '/api/version',
      '/status',
      '/v1/agent/claim',
      '/v1/agent/status',
      '/v1/usage',
      '/v1/policy/check',
    ]) {
      assert.ok(res.body.paths[path], `expected ${path} to be documented`);
    }
  });

  it('renders its own document, not the one belonging to /api/docs', async () => {
    // swagger-ui-express keeps the generated swagger-ui-init.js body in a
    // module-level variable that setup() writes and the shared `serve`
    // middleware reads back. With two Swagger UI mounts in one app,
    // whichever setup() ran last won for BOTH, so one of the two pages
    // rendered the other's spec. Both mounts use serveFiles(), which
    // closes over its own bootstrap; these two assertions are what fails
    // if either regresses to serve/setup.
    const ours = await request.get('/docs/swagger-ui-init.js');
    assert.equal(ours.status, 200);
    assert.match(ours.text, /"url":\s*"\/docs\.json"/);

    const theirs = await request.get('/api/docs/swagger-ui-init.js');
    assert.equal(theirs.status, 200);
    assert.match(theirs.text, /"url":\s*"\/api\/openapi\.json"/);
  });
});
