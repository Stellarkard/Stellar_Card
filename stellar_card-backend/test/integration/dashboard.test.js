// Integration tests for the per-tenant /dashboard/* API (src/api/dashboard.js).
//
// Before this change there was ZERO integration coverage for this router —
// every other authenticated surface (platform/*, internal/*, orders) had
// dedicated integration tests, but the largest router in the backend
// (dashboard.js: overview, stats, api-keys, alert-rules, webhook-deliveries,
// merchants) had none. This file pins the auth gate (requireAuth +
// requireDashboard) and the happy path for the most-used routes.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { request, db, createTestSession, resetDb } = require('../helpers/app');

function seedDashboard(userId, name = 'Primary') {
  const id = uuidv4();
  db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(id, userId, name);
  return id;
}

function authedSession(email = 'dash-owner@stellar_card.test') {
  const { token, userId } = createTestSession({ email, role: 'owner' });
  const dashboardId = seedDashboard(userId);
  return { auth: `Bearer ${token}`, userId, dashboardId };
}

describe('GET /dashboard — auth gate', () => {
  beforeEach(() => resetDb());

  it('rejects requests with no session token (401)', async () => {
    const res = await request.get('/dashboard');
    assert.equal(res.status, 401);
  });

  it('rejects an unknown/garbage bearer token (401)', async () => {
    const res = await request.get('/dashboard').set('Authorization', 'Bearer not-a-real-token');
    assert.equal(res.status, 401);
  });

  it('404s when the authenticated user has no dashboard row', async () => {
    const { token } = createTestSession({ email: 'no-dashboard@stellar_card.test' });
    const res = await request.get('/dashboard').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no_dashboard');
  });
});

describe('GET /dashboard — overview happy path', () => {
  beforeEach(() => resetDb());

  it('returns the dashboard summary for an authenticated owner', async () => {
    const { auth, dashboardId } = authedSession();
    const res = await request.get('/dashboard').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, dashboardId);
    assert.equal(res.body.frozen, false);
    assert.ok(res.body.stats);
    assert.equal(res.body.stats.total_orders, 0);
    assert.equal(res.body.stats.active_keys, 0);
  });
});

describe('GET /dashboard/stats', () => {
  beforeEach(() => resetDb());

  it('returns zeroed totals for a fresh dashboard', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/stats').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.total_orders, 0);
    assert.equal(res.body.active_keys, 0);
  });
});

describe('/dashboard/api-keys', () => {
  beforeEach(() => resetDb());

  it('lists no keys for a fresh dashboard', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/api-keys').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('creates an agent API key and returns it in the list', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'test-agent', spend_limit_usdc: '50.00' });
    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.id);
    // Raw key material is intentionally never returned in the response —
    // it's handed to the agent via the one-time claim-code flow instead.
    assert.equal(createRes.body.key, undefined);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.length, 1);
    assert.equal(listRes.body[0].label, 'test-agent');
  });

  it('rejects an invalid spend_limit_usdc with 400', async () => {
    const { auth } = authedSession();
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'bad-agent', spend_limit_usdc: 'not-a-number' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_spend_limit');
  });

  it('rejects a non-HTTPS default_webhook_url with 400', async () => {
    const { auth } = authedSession();
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'bad-webhook-agent', default_webhook_url: 'http://insecure.example.com' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_url');
  });

  it('deletes an api key', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'to-delete' });
    const id = createRes.body.id;
    assert.ok(id);

    const delRes = await request.delete(`/dashboard/api-keys/${id}`).set('Authorization', auth);
    assert.equal(delRes.status, 200);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    assert.equal(listRes.body.length, 0);
  });
});

describe('/dashboard/alert-rules', () => {
  beforeEach(() => resetDb());

  it('seeds and lists default alert rules on first read', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/alert-rules').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.rules));
    assert.ok(res.body.rules.length > 0);
  });

  it('creates a custom alert rule and rejects one missing required fields', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/alert-rules')
      .set('Authorization', auth)
      .send({ name: 'High spend', kind: 'spend_over', config: { thresholdUsd: 100 } });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.rule.name, 'High spend');

    const badRes = await request
      .post('/dashboard/alert-rules')
      .set('Authorization', auth)
      .send({ config: {} });
    assert.equal(badRes.status, 400);
    assert.equal(badRes.body.error, 'missing_fields');
  });
});

describe('GET /dashboard/merchants', () => {
  beforeEach(() => resetDb());

  it('returns the enabled merchant catalog', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/merchants').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.merchants));
  });
});

describe('GET /dashboard/webhook-deliveries', () => {
  beforeEach(() => resetDb());

  it('returns an empty deliveries list for a fresh dashboard', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/webhook-deliveries').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.deliveries, []);
  });
});
