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
});
