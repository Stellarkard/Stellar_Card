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

describe('GET /dashboard/audit-log', () => {
  beforeEach(() => resetDb());

  it('returns an empty audit log for a fresh dashboard', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/audit-log').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.entries));
    assert.equal(res.body.entries.length, 0);
  });

  it('includes audit entries after actions', async () => {
    const { auth, dashboardId, userId } = authedSession();
    // Create an api key which should write an audit row.
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'audit-test-agent' });
    assert.equal(createRes.status, 201);

    const res = await request.get('/dashboard/audit-log').set('Authorization', auth);
    assert.ok(res.body.entries.length >= 1);
    assert.equal(res.body.entries[0].action, 'agent.create');
    assert.equal(res.body.entries[0].actor_user_id, userId);
  });
});

describe('/dashboard/approval-requests', () => {
  beforeEach(() => resetDb());

  async function seedPendingApproval({ auth, dashboardId, amountUsdc = '25.00' } = {}) {
    const { v4: uuidv4 } = require('uuid');
    // Create an api key first, then insert an approval_request.
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'approval-agent' });
    const apiKeyId = createRes.body.id;
    const orderId = uuidv4();
    const approvalId = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, api_key_id) VALUES (?, ?, ?, ?)`,
    ).run(orderId, 'awaiting_approval', amountUsdc, apiKeyId);
    db.prepare(
      `INSERT INTO approval_requests (id, api_key_id, order_id, amount_usdc, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(approvalId, apiKeyId, orderId, amountUsdc, expiresAt);
    return { apiKeyId, orderId, approvalId };
  }

  it('returns pending approval requests for the dashboard', async () => {
    const { auth } = authedSession();
    await seedPendingApproval({ auth });
    const res = await request.get('/dashboard/approval-requests').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].status, 'pending');
  });

  it('returns empty list when no approvals exist', async () => {
    const { auth } = authedSession();
    const res = await request.get('/dashboard/approval-requests').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 0);
  });

  it('rejects a pending approval request', async () => {
    const { auth } = authedSession();
    const { approvalId, orderId } = await seedPendingApproval({ auth });
    const rejectRes = await request
      .post(`/dashboard/approval-requests/${approvalId}/reject`)
      .set('Authorization', auth)
      .send({ note: 'Not needed' });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.ok, true);

    const orderRow = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId);
    assert.equal(orderRow.status, 'rejected');

    const approvalRow = db
      .prepare(`SELECT status, decision_note FROM approval_requests WHERE id = ?`)
      .get(approvalId);
    assert.equal(approvalRow.status, 'rejected');
    assert.equal(approvalRow.decision_note, 'Not needed');
  });

  it('returns 404 for an approval request from another dashboard', async () => {
    const { auth } = authedSession();
    const res = await request
      .post(`/dashboard/approval-requests/${uuidv4()}/reject`)
      .set('Authorization', auth)
      .send({ note: 'test' });
    assert.equal(res.status, 404);
  });
});

describe('PATCH /dashboard/api-keys/:id', () => {
  beforeEach(() => resetDb());

  it('updates the label of an api key', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'old-label' });
    const keyId = createRes.body.id;

    const patchRes = await request
      .patch(`/dashboard/api-keys/${keyId}`)
      .set('Authorization', auth)
      .send({ label: 'new-label' });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.ok, true);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    const updated = listRes.body.find((k) => k.id === keyId);
    assert.equal(updated.label, 'new-label');
  });

  it('updates the spend_limit_usdc of an api key', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'limit-agent' });
    const keyId = createRes.body.id;

    const patchRes = await request
      .patch(`/dashboard/api-keys/${keyId}`)
      .set('Authorization', auth)
      .send({ spend_limit_usdc: '200.00' });
    assert.equal(patchRes.status, 200);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    const updated = listRes.body.find((k) => k.id === keyId);
    assert.equal(updated.spend_limit_usdc, '200.00');
  });

  it('returns 404 for a non-existent key', async () => {
    const { auth } = authedSession();
    const res = await request
      .patch(`/dashboard/api-keys/${uuidv4()}`)
      .set('Authorization', auth)
      .send({ label: 'nope' });
    assert.equal(res.status, 404);
  });

  it('returns 400 for an invalid spend_limit', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'bad-limit-agent' });
    const keyId = createRes.body.id;

    const res = await request
      .patch(`/dashboard/api-keys/${keyId}`)
      .set('Authorization', auth)
      .send({ spend_limit_usdc: 'negative' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_spend_limit');
  });
});

describe('POST /dashboard/api-keys/:id/suspend', () => {
  beforeEach(() => resetDb());

  it('suspends an api key', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'to-suspend' });
    const keyId = createRes.body.id;

    const suspendRes = await request
      .post(`/dashboard/api-keys/${keyId}/suspend`)
      .set('Authorization', auth);
    assert.equal(suspendRes.status, 200);
    assert.equal(suspendRes.body.ok, true);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    const updated = listRes.body.find((k) => k.id === keyId);
    assert.equal(updated.suspended, 1);
  });

  it('returns 404 for a non-existent key', async () => {
    const { auth } = authedSession();
    const res = await request
      .post(`/dashboard/api-keys/${uuidv4()}/suspend`)
      .set('Authorization', auth);
    assert.equal(res.status, 404);
  });
});

describe('POST /dashboard/api-keys/:id/unsuspend', () => {
  beforeEach(() => resetDb());

  it('unsuspends a suspended api key', async () => {
    const { auth } = authedSession();
    const createRes = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'to-unsuspend' });
    const keyId = createRes.body.id;

    await request.post(`/dashboard/api-keys/${keyId}/suspend`).set('Authorization', auth);
    const unsuspendRes = await request
      .post(`/dashboard/api-keys/${keyId}/unsuspend`)
      .set('Authorization', auth);
    assert.equal(unsuspendRes.status, 200);

    const listRes = await request.get('/dashboard/api-keys').set('Authorization', auth);
    const updated = listRes.body.find((k) => k.id === keyId);
    assert.equal(updated.suspended, 0);
  });

  it('returns 404 for a non-existent key', async () => {
    const { auth } = authedSession();
    const res = await request
      .post(`/dashboard/api-keys/${uuidv4()}/unsuspend`)
      .set('Authorization', auth);
    assert.equal(res.status, 404);
  });
});
