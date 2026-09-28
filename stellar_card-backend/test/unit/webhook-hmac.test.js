// Unit tests for inbound partner webhook signature verification (issue #591):
// lib/hmac.js generic helpers and middleware/verifyWebhookSignature.js.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { signWebhookBody, parseSignatureHeader, verifyWebhookBody } = require('../../src/lib/hmac');
const {
  verifyWebhookSignature,
  isSignatureBypassEnabled,
} = require('../../src/middleware/verifyWebhookSignature');

const SECRET = 'partner-webhook-secret-at-least-32-chars!';
const BODY = JSON.stringify({ event: 'card.updated', id: 'evt_1' });
const sig = (body = BODY, secret = SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

function run(middleware, { headers = {}, rawBody = BODY } = {}) {
  const req = { headers, rawBody, originalUrl: '/partner-webhook' };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

describe('lib/hmac generic webhook helpers', () => {
  it('signs deterministically as 64-char hex', () => {
    const a = signWebhookBody({ secret: SECRET, rawBody: BODY });
    assert.equal(a, signWebhookBody({ secret: SECRET, rawBody: BODY }));
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('parses sha256= and bare hex, rejects malformed', () => {
    const hex = 'a'.repeat(64);
    assert.equal(parseSignatureHeader(`sha256=${hex}`), hex);
    assert.equal(parseSignatureHeader(hex.toUpperCase()), hex);
    for (const bad of [undefined, '', 'sha256=', 'sha256=abc', 'z'.repeat(64), `md5=${hex}`]) {
      assert.equal(parseSignatureHeader(bad), null);
    }
  });

  it('accepts a valid signature', () => {
    assert.deepEqual(verifyWebhookBody({ secret: SECRET, rawBody: BODY, signatureHeader: sig() }), {
      ok: true,
    });
  });

  it('rejects an invalid signature (wrong secret)', () => {
    const v = verifyWebhookBody({
      secret: SECRET,
      rawBody: BODY,
      signatureHeader: sig(BODY, 'x'.repeat(40)),
    });
    assert.deepEqual(v, { ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered body', () => {
    const tampered = BODY.replace('evt_1', 'evt_2');
    const v = verifyWebhookBody({ secret: SECRET, rawBody: tampered, signatureHeader: sig() });
    assert.deepEqual(v, { ok: false, reason: 'bad_signature' });
  });

  it('fails closed on missing secret, body or header', () => {
    assert.equal(
      verifyWebhookBody({ secret: undefined, rawBody: BODY, signatureHeader: sig() }).ok,
      false,
    );
    assert.equal(
      verifyWebhookBody({ secret: SECRET, rawBody: undefined, signatureHeader: sig() }).ok,
      false,
    );
    assert.equal(
      verifyWebhookBody({ secret: SECRET, rawBody: BODY, signatureHeader: undefined }).ok,
      false,
    );
  });
});

describe('verifyWebhookSignature middleware (full mode)', () => {
  const env = { NODE_ENV: 'test' };
  const mw = verifyWebhookSignature({ getSecret: () => SECRET, env });

  it('calls next() and marks the request for a valid X-Webhook-Signature', () => {
    const { req, res, nextCalled } = run(mw, { headers: { 'x-webhook-signature': sig() } });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(req.webhookSignatureVerified, true);
  });

  it('accepts the X-Signature alias', () => {
    assert.equal(run(mw, { headers: { 'x-signature': sig() } }).nextCalled, true);
  });

  it('returns 401 missing_signature for unsigned requests', () => {
    const { res, nextCalled } = run(mw, { headers: {} });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'missing_signature' });
  });

  it('returns 401 invalid_signature for malformed, wrong or tampered signatures', () => {
    for (const { headers, rawBody } of [
      { headers: { 'x-signature': 'sha256=deadbeef' } },
      { headers: { 'x-signature': sig(BODY, 'y'.repeat(40)) } },
      { headers: { 'x-signature': sig() }, rawBody: BODY + ' ' },
    ]) {
      const { res, nextCalled } = run(mw, { headers, rawBody });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: 'invalid_signature' });
    }
  });

  it('fails closed with 401 when no secret is configured', () => {
    const noSecret = verifyWebhookSignature({ getSecret: () => undefined, env });
    const { res, nextCalled } = run(noSecret, { headers: { 'x-signature': sig() } });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

describe('verifyWebhookSignature middleware (precheckOnly mode)', () => {
  const mw = verifyWebhookSignature({
    precheckOnly: true,
    canonicalHeader: 'x-vcc-signature',
    env: { NODE_ENV: 'test' },
  });

  it('copies an alias onto the canonical header without verifying it', () => {
    const { req, nextCalled } = run(mw, { headers: { 'x-webhook-signature': 'sha256=abc' } });
    assert.equal(nextCalled, true);
    assert.equal(req.headers['x-vcc-signature'], 'sha256=abc');
    assert.equal(req.webhookSignatureVerified, undefined);
  });

  it('does not overwrite an existing canonical header', () => {
    const { req } = run(mw, {
      headers: { 'x-vcc-signature': 'sha256=vcc', 'x-signature': 'sha256=other' },
    });
    assert.equal(req.headers['x-vcc-signature'], 'sha256=vcc');
  });

  it('rejects requests with no signature header at all', () => {
    const { res, nextCalled } = run(mw, { headers: {} });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

describe('development bypass', () => {
  it('is enabled only with NODE_ENV=development AND WEBHOOK_SIGNATURE_BYPASS=true', () => {
    assert.equal(
      isSignatureBypassEnabled({ NODE_ENV: 'development', WEBHOOK_SIGNATURE_BYPASS: 'true' }),
      true,
    );
    assert.equal(isSignatureBypassEnabled({ NODE_ENV: 'development' }), false);
    assert.equal(
      isSignatureBypassEnabled({ NODE_ENV: 'production', WEBHOOK_SIGNATURE_BYPASS: 'true' }),
      false,
    );
    assert.equal(
      isSignatureBypassEnabled({ NODE_ENV: 'test', WEBHOOK_SIGNATURE_BYPASS: 'true' }),
      false,
    );
  });

  it('lets unsigned requests through and marks them when enabled', () => {
    const mw = verifyWebhookSignature({
      getSecret: () => SECRET,
      env: { NODE_ENV: 'development', WEBHOOK_SIGNATURE_BYPASS: 'true' },
    });
    const { req, nextCalled } = run(mw, { headers: {} });
    assert.equal(nextCalled, true);
    assert.equal(req.webhookSignatureBypassed, true);
  });

  it('still rejects unsigned requests in production even with the flag set', () => {
    const mw = verifyWebhookSignature({
      getSecret: () => SECRET,
      env: { NODE_ENV: 'production', WEBHOOK_SIGNATURE_BYPASS: 'true' },
    });
    const { res, nextCalled } = run(mw, { headers: {} });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});
