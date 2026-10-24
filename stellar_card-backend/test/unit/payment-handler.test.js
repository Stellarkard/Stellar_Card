// Unit tests for backend/src/payment-handler.js.
//
// Before the 2026-04-15 adversarial audit there were NO direct unit
// tests for this module — it was only exercised indirectly through
// the e2e-stellar_card-vcc integration test. This file covers the three
// audit findings and the two helpers added alongside them:
//
//   F1-payment-handler: the outer catch handler now uses
//     safeErrorMessage() so a non-Error thrown value (null, string,
//     Error with getter-thrown .message) can't crash the catch block
//     and leave the order wedged in 'ordering' status.
//
//   F2-payment-handler: parseStrictPositiveStroops() validates
//     order.amount_usdc before the comparison. Pre-fix, an empty or
//     corrupt amount_usdc row would be treated as "paid the full
//     quoted amount" because toStroops('') returned 0n and any
//     positive on-chain payment compared as overpayment — a corrupt
//     row became a treasury drain vector. Post-fix, corrupt rows
//     route the incoming event to unmatched_payments and leave the
//     order in pending_payment for ops.
//
//   F3-payment-handler: USDC overpayment now emits a
//     payment.usdc_overpaid bizEvent so a buggy SDK systematically
//     over-paying doesn't silently accumulate excess.
//
// The happy-path + race tests are covered by the existing integration
// suite; this file focuses on the helpers (pure functions) and the
// F2 corrupt-amount path end-to-end via a DB-backed test.

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { db, resetDb, createTestKey } = require('../helpers/app');

const {
  handlePayment,
  _parseStrictPositiveStroops,
  _safeErrorMessage,
  _setVccClient,
  _setFulfillment,
  _resetTestHooks,
} = require('../../src/payment-handler');

// ── F1-payment-handler: safeErrorMessage ────────────────────────────────────

describe('F1-payment-handler: safeErrorMessage', () => {
  it('extracts .message from a plain Error', () => {
    assert.equal(_safeErrorMessage(new Error('boom')), 'boom');
  });

  it('returns a string unchanged', () => {
    assert.equal(_safeErrorMessage('a plain string error'), 'a plain string error');
  });

  it('returns the literal "null" for null', () => {
    assert.equal(_safeErrorMessage(null), 'null');
  });

  it('returns the literal "undefined" for undefined', () => {
    assert.equal(_safeErrorMessage(undefined), 'undefined');
  });

  it('returns String-coerced form for a number', () => {
    assert.equal(_safeErrorMessage(42), '42');
  });

  it('handles an Error whose .message getter throws', () => {
    const err = new Error();
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('nested');
      },
    });
    const out = _safeErrorMessage(err);
    // Must not throw. String(err) is the fallback path.
    assert.ok(typeof out === 'string');
  });

  it('returns <unstringifiable error> for a value whose toString throws', () => {
    const weird = /** @type {any} */ ({
      toString() {
        throw new Error('nope');
      },
    });
    assert.equal(_safeErrorMessage(weird), '<unstringifiable error>');
  });
});

// ── F2-payment-handler: parseStrictPositiveStroops helper ──────────────────

describe('F2-payment-handler: parseStrictPositiveStroops', () => {
  it('accepts a simple positive integer', () => {
    assert.equal(_parseStrictPositiveStroops('1'), 10_000_000n);
  });

  it('accepts a positive decimal', () => {
    assert.equal(_parseStrictPositiveStroops('0.0123456'), 123_456n);
  });

  it('accepts "10.00"', () => {
    assert.equal(_parseStrictPositiveStroops('10.00'), 100_000_000n);
  });

  it('rejects empty string', () => {
    assert.equal(_parseStrictPositiveStroops(''), null);
  });

  it('rejects whitespace-only string', () => {
    assert.equal(_parseStrictPositiveStroops('   '), null);
  });

  it('rejects null and undefined', () => {
    assert.equal(_parseStrictPositiveStroops(null), null);
    assert.equal(_parseStrictPositiveStroops(undefined), null);
  });

  it('rejects non-string types', () => {
    // @ts-expect-error intentional
    assert.equal(_parseStrictPositiveStroops(10), null);
    // @ts-expect-error intentional
    assert.equal(_parseStrictPositiveStroops(true), null);
    // @ts-expect-error intentional
    assert.equal(_parseStrictPositiveStroops({ amount: '10' }), null);
  });

  it('rejects zero', () => {
    // The whole point of the guard — zero is the exact value that
    // pre-fix caused the treasury drain.
    assert.equal(_parseStrictPositiveStroops('0'), null);
    assert.equal(_parseStrictPositiveStroops('0.0000000'), null);
  });

  it('rejects negative', () => {
    assert.equal(_parseStrictPositiveStroops('-1'), null);
    assert.equal(_parseStrictPositiveStroops('-0.5'), null);
  });

  it('rejects garbage strings', () => {
    assert.equal(_parseStrictPositiveStroops('abc'), null);
    assert.equal(_parseStrictPositiveStroops('1.2.3'), null);
    assert.equal(_parseStrictPositiveStroops('1e5'), null);
    assert.equal(_parseStrictPositiveStroops('NaN'), null);
    assert.equal(_parseStrictPositiveStroops('Infinity'), null);
    assert.equal(_parseStrictPositiveStroops('+1'), null);
  });
});

// ── F2-payment-handler: end-to-end corrupt-order protection ─────────────────
//
// Prove that a DB-backed order row with a corrupt amount_usdc value is
// NOT claimed when an on-chain payment arrives. The incoming event is
// routed to unmatched_payments with reason='corrupt_order' and the
// order stays in pending_payment status for ops to investigate.

describe('F2-payment-handler: corrupt order.amount_usdc is fail-closed', () => {
  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'corrupt-test' });
    apiKeyId = key.id;
  });

  function seedOrder({ id = uuidv4(), amountUsdc = '10.00', status = 'pending_payment' } = {}) {
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
       VALUES (?, ?, ?, 'usdc', ?, datetime('now'), datetime('now'))`,
    ).run(id, status, amountUsdc, apiKeyId);
    return id;
  }

  async function payUsdc(orderId, amountUsdc, txid = `TX${uuidv4().slice(0, 8)}`) {
    await handlePayment({
      txid,
      paymentAsset: 'usdc_soroban',
      amountUsdc,
      amountXlm: null,
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    return txid;
  }

  function getOrder(id) {
    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  }

  function findUnmatched(txid) {
    return db.prepare(`SELECT * FROM unmatched_payments WHERE stellar_txid = ?`).get(txid);
  }

  it('routes to corrupt_order when amount_usdc is empty string', async () => {
    const orderId = seedOrder({ amountUsdc: '' });
    const txid = await payUsdc(orderId, '10.00');
    // Order must still be pending_payment — NOT claimed.
    const order = getOrder(orderId);
    assert.equal(order.status, 'pending_payment');
    // Unmatched row recorded with the specific reason.
    const unmatched = findUnmatched(txid);
    assert.ok(unmatched, 'expected unmatched_payments row for corrupt order');
    assert.equal(unmatched.reason, 'corrupt_order');
    assert.equal(unmatched.claimed_order_id, orderId);
  });

  it('routes to corrupt_order when amount_usdc is "0"', async () => {
    // The specific value that caused the pre-fix treasury-drain
    // comparison. toStroops('0') === 0n, and any positive on-chain
    // amount compared as "overpayment" and transitioned the order to
    // 'ordering'. Post-fix: rejected at parseStrictPositiveStroops.
    const orderId = seedOrder({ amountUsdc: '0' });
    const txid = await payUsdc(orderId, '10.00');
    const order = getOrder(orderId);
    assert.equal(order.status, 'pending_payment');
    assert.equal(findUnmatched(txid).reason, 'corrupt_order');
  });

  it('routes to corrupt_order when amount_usdc is "not-a-number"', async () => {
    const orderId = seedOrder({ amountUsdc: 'abc' });
    const txid = await payUsdc(orderId, '10.00');
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched(txid).reason, 'corrupt_order');
  });

  it('routes to corrupt_order when amount_usdc has multiple dots', async () => {
    const orderId = seedOrder({ amountUsdc: '10.0.0' });
    const txid = await payUsdc(orderId, '10.00');
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched(txid).reason, 'corrupt_order');
  });

  it('routes to corrupt_order when amount_usdc is negative', async () => {
    const orderId = seedOrder({ amountUsdc: '-10.00' });
    const txid = await payUsdc(orderId, '10.00');
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched(txid).reason, 'corrupt_order');
  });

  it('still CLAIMS a valid decimal amount (regression guard for the F2 guard itself)', async () => {
    // The F2 guard must not reject valid amounts. We can't cleanly stub
    // vcc-client here (payment-handler.js destructures getInvoice at
    // module load, so runtime reassignment doesn't affect the cached
    // binding), so instead we assert the MINIMUM thing the F2 guard is
    // responsible for: a valid amount_usdc causes the order to exit
    // pending_payment status. Whatever happens downstream (getInvoice
    // failing against the test stub, falling into the catch handler,
    // scheduling a refund) is out of scope for this test and is covered
    // by the e2e integration suite.
    //
    // Silence the expected downstream error logs so the test output is
    // readable.
    const origError = console.error;
    console.error = () => {};
    try {
      const orderId = seedOrder({ amountUsdc: '10.00' });
      await payUsdc(orderId, '10.00');
      const order = getOrder(orderId);
      assert.notEqual(
        order.status,
        'pending_payment',
        'valid amount_usdc should claim the order (F2 guard must not false-positive)',
      );
      // No unmatched_payments row with corrupt_order reason.
      const corruptRow = db
        .prepare(`SELECT * FROM unmatched_payments WHERE claimed_order_id = ? AND reason = ?`)
        .get(orderId, 'corrupt_order');
      assert.equal(corruptRow, undefined, 'valid amount must not land in unmatched_payments');
    } finally {
      console.error = origError;
    }
  });
});

// ── F3-payment-handler: USDC overpayment bizEvent ──────────────────────────
//
// Pre-fix, USDC overpayment was silently accepted — excess_usdc was
// recorded on the order row but no bizEvent fired, so a buggy SDK
// systematically over-paying by 10% would go unnoticed. XLM had the
// symmetric payment.xlm_overpaid signal already; USDC now matches.

describe('F3-payment-handler: usdc_overpaid bizEvent', () => {
  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'overpaid-test' });
    apiKeyId = key.id;
  });

  it('emits payment.usdc_overpaid when the agent pays more than expected', async () => {
    // Capture bizEvent emissions.
    const logger = require('../../src/lib/logger');
    const origEvent = logger.event;
    const events = [];
    logger.event = (name, fields) => events.push({ name, fields });

    // Silence the expected downstream error logs after the (successful)
    // claim — same reason as the prior regression guard.
    const origError = console.error;
    console.error = () => {};

    try {
      const orderId = uuidv4();
      db.prepare(
        `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
         VALUES (?, 'pending_payment', '10.00', 'usdc', ?, datetime('now'), datetime('now'))`,
      ).run(orderId, apiKeyId);

      await handlePayment({
        txid: 'TX_OVERPAID',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '11.50', // $1.50 overpayment
        amountXlm: null,
        senderAddress: 'GOVER',
        orderId,
      });

      const overpaid = events.find((e) => e.name === 'payment.usdc_overpaid');
      assert.ok(overpaid, 'expected payment.usdc_overpaid bizEvent');
      assert.equal(overpaid.fields.order_id, orderId);
      assert.equal(overpaid.fields.expected_usdc, '10.00');
      assert.equal(overpaid.fields.paid_usdc, '11.50');
      // excess_usdc should be '1.5000000' (stroop-precision stringification).
      assert.match(overpaid.fields.excess_usdc, /^1\.5000000$/);
      assert.equal(overpaid.fields.txid, 'TX_OVERPAID');
    } finally {
      logger.event = origEvent;
      console.error = origError;
    }
  });

  it('does NOT emit payment.usdc_overpaid on an exact match', async () => {
    const logger = require('../../src/lib/logger');
    const origEvent = logger.event;
    const events = [];
    logger.event = (name, fields) => events.push({ name, fields });
    const origError = console.error;
    console.error = () => {};

    try {
      const orderId = uuidv4();
      db.prepare(
        `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
         VALUES (?, 'pending_payment', '10.00', 'usdc', ?, datetime('now'), datetime('now'))`,
      ).run(orderId, apiKeyId);

      await handlePayment({
        txid: 'TX_EXACT',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '10.00',
        amountXlm: null,
        senderAddress: 'GEXACT',
        orderId,
      });

      const overpaid = events.filter((e) => e.name === 'payment.usdc_overpaid');
      assert.equal(overpaid.length, 0, 'exact match must not emit overpaid bizEvent');
    } finally {
      logger.event = origEvent;
      console.error = origError;
    }
  });
});

// ── F7-payment-handler: unmatched-payment routing (Part 2) ─────────────────
//
// handlePayment routes every payment it can't safely claim to
// unmatched_payments with a specific `reason` (see the F7 comments in
// src/payment-handler.js) so ops has a queue to refund from. Only the
// F2 corrupt-amount and F3 overpayment reasons had direct unit coverage
// before this — the other five routing branches (unknown order, wrong
// order status, underpayment on both assets, an unquoted XLM order, and
// an unrecognised asset) were only reachable indirectly through the e2e
// integration suite. This fills in direct coverage for each one.

describe('F7-payment-handler: unmatched-payment routing', () => {
  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'f7-test' });
    apiKeyId = key.id;
  });

  function seedOrder({
    id = uuidv4(),
    amountUsdc = '10.00',
    status = 'pending_payment',
    expectedXlmAmount = null,
  } = {}) {
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, expected_xlm_amount, created_at, updated_at)
       VALUES (?, ?, ?, 'usdc', ?, ?, datetime('now'), datetime('now'))`,
    ).run(id, status, amountUsdc, apiKeyId, expectedXlmAmount);
    return id;
  }

  function getOrder(id) {
    return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  }

  function findUnmatched(txid) {
    return db.prepare(`SELECT * FROM unmatched_payments WHERE stellar_txid = ?`).get(txid);
  }

  it('routes to unknown_order when the order_id does not exist', async () => {
    const orderId = uuidv4(); // never inserted
    await handlePayment({
      txid: 'TX_UNKNOWN_ORDER',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    const unmatched = findUnmatched('TX_UNKNOWN_ORDER');
    assert.ok(unmatched, 'expected an unmatched_payments row');
    assert.equal(unmatched.reason, 'unknown_order');
    assert.equal(unmatched.claimed_order_id, orderId);
  });

  it('routes to order_status_<status> when the order is not pending_payment', async () => {
    const orderId = seedOrder({ status: 'ordering' });
    await handlePayment({
      txid: 'TX_WRONG_STATUS',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    // The order's own status must be left untouched — this event just
    // isn't for the current lifecycle state.
    assert.equal(getOrder(orderId).status, 'ordering');
    assert.equal(findUnmatched('TX_WRONG_STATUS').reason, 'order_status_ordering');
  });

  it('routes to underpaid_usdc and leaves the order in pending_payment', async () => {
    const orderId = seedOrder({ amountUsdc: '10.00' });
    await handlePayment({
      txid: 'TX_UNDERPAID_USDC',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '5.00',
      amountXlm: null,
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched('TX_UNDERPAID_USDC').reason, 'underpaid_usdc');
  });

  it('routes to xlm_not_quoted when the order never offered an XLM price', async () => {
    const orderId = seedOrder({ expectedXlmAmount: null });
    await handlePayment({
      txid: 'TX_XLM_NOT_QUOTED',
      paymentAsset: 'xlm_soroban',
      amountUsdc: null,
      amountXlm: '100',
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched('TX_XLM_NOT_QUOTED').reason, 'xlm_not_quoted');
  });

  it('routes to underpaid_xlm and leaves the order in pending_payment', async () => {
    const orderId = seedOrder({ expectedXlmAmount: '100' });
    await handlePayment({
      txid: 'TX_UNDERPAID_XLM',
      paymentAsset: 'xlm_soroban',
      amountUsdc: null,
      amountXlm: '50',
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched('TX_UNDERPAID_XLM').reason, 'underpaid_xlm');
  });

  it('emits payment.xlm_overpaid and still claims the order on XLM overpayment', async () => {
    const logger = require('../../src/lib/logger');
    const origEvent = logger.event;
    const events = [];
    logger.event = (name, fields) => events.push({ name, fields });
    // Downstream getInvoice/xlm-sender calls hit real network stubs that
    // fail in this unit-test environment — same pattern as the F3
    // overpaid test, we only assert on the claim + bizEvent, not the
    // fulfillment pipeline past that point.
    const origError = console.error;
    console.error = () => {};

    try {
      const orderId = seedOrder({ expectedXlmAmount: '100' });
      await handlePayment({
        txid: 'TX_XLM_OVERPAID',
        paymentAsset: 'xlm_soroban',
        amountUsdc: null,
        amountXlm: '150',
        senderAddress: 'GTESTSENDER',
        orderId,
      });

      const overpaid = events.find((e) => e.name === 'payment.xlm_overpaid');
      assert.ok(overpaid, 'expected payment.xlm_overpaid bizEvent');
      assert.equal(overpaid.fields.order_id, orderId);
      assert.match(overpaid.fields.excess_xlm, /^50\.0000000$/);
      assert.equal(overpaid.fields.txid, 'TX_XLM_OVERPAID');
      // The order must have been claimed (left pending_payment) despite
      // the overpayment — overpaying is accepted, not rejected.
      assert.notEqual(getOrder(orderId).status, 'pending_payment');
    } finally {
      logger.event = origEvent;
      console.error = origError;
    }
  });

  it('routes to unknown_asset for an unrecognised payment_asset value', async () => {
    const orderId = seedOrder();
    await handlePayment({
      txid: 'TX_UNKNOWN_ASSET',
      paymentAsset: 'btc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GTESTSENDER',
      orderId,
    });
    assert.equal(getOrder(orderId).status, 'pending_payment');
    assert.equal(findUnmatched('TX_UNKNOWN_ASSET').reason, 'unknown_asset');
  });
});

// ── Part 4: fulfillment-pipeline unit tests ────────────────────────────────
//
// Parts 1–3 covered the pure helpers (F1/F2/F3) and the unmatched-payment
// routing branches (F7) at unit level, leaving the post-claim fulfillment
// pipeline (getInvoice → payCtxOrder → notifyPaid), ambiguous-outcome
// parking, failure → refund routing, and the duplicate-claim race to the
// e2e integration suite with its fake VCC HTTP server. Part 4 closes that
// gap with isolated unit tests: the _setVccClient / _setFulfillment
// injection hooks (src/payment-handler.js, following the
// src/mpp/verify.js::_setRpcServer precedent) stub the VCC boundary, and
// the xlmSender module object is mutated at runtime (the same pattern
// e2e-cards402-vcc.test.js relies on) to stub payCtxOrder. No network,
// no HTTP server — every external call is a stub and every restoration
// happens in afterEach so no state leaks between cases.

const xlmSender = require('../../src/payments/xlm-sender');

const PART4_HASH = 'a'.repeat(64);
const PART4_PAYMENT_URL = `web+stellar:pay?destination=G${'A'.repeat(55)}&amount=10&memo=t`;
// Saved once at load; every Part 4 describe restores it in afterEach.
const _realPayCtxOrder = xlmSender.payCtxOrder;

/** Install success stubs for the whole pipeline; returns call recorders. */
function stubSuccessPipeline({ payHash = PART4_HASH } = {}) {
  const notifyCalls = [];
  _setVccClient({
    getInvoice: async () => ({
      vccJobId: 'job_stub_1',
      paymentUrl: PART4_PAYMENT_URL,
      callbackNonce: 'nonce_stub_1',
    }),
    notifyPaid: async (jobId) => {
      notifyCalls.push(jobId);
      return { ok: true };
    },
  });
  xlmSender.payCtxOrder = async () => payHash;
  return { notifyCalls };
}

/** Install a recording refundOrQuarantine stub; returns the call list. */
function stubRefundCapture() {
  const calls = [];
  _setFulfillment({
    refundOrQuarantine: (orderId, message) => {
      // Record synchronously on invocation — handlePayment does not
      // await this call, so awaiting inside the stub would race the
      // assertions.
      calls.push({ orderId, message });
      return Promise.resolve({ status: 'stubbed' });
    },
  });
  return calls;
}

function captureBizEvents() {
  const logger = require('../../src/lib/logger');
  const origEvent = logger.event;
  const events = [];
  logger.event = (name, fields) => events.push({ name, fields });
  return {
    events,
    restore() {
      logger.event = origEvent;
    },
  };
}

function silenceConsoleError() {
  const origError = console.error;
  console.error = () => {};
  return () => {
    console.error = origError;
  };
}

function seedPart4Order({
  id = uuidv4(),
  amountUsdc = '10.00',
  status = 'pending_payment',
  expectedXlmAmount = null,
  apiKeyId,
} = {}) {
  db.prepare(
    `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, expected_xlm_amount, created_at, updated_at)
     VALUES (?, ?, ?, 'usdc', ?, ?, datetime('now'), datetime('now'))`,
  ).run(id, status, amountUsdc, apiKeyId, expectedXlmAmount);
  return id;
}

// ── Part 4: happy-path fulfillment checkpoints ───────────────────────────

describe('Part 4: happy-path fulfillment checkpoints', () => {
  let apiKeyId;
  let restoreConsole;
  let pipeline;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-happy' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    pipeline = stubSuccessPipeline();
  });

  afterEach(() => {
    restoreConsole();
    xlmSender.payCtxOrder = _realPayCtxOrder;
    _resetTestHooks();
  });

  it('persists every checkpoint on a successful USDC payment', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_HAPPY',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'ordering', 'successful payment claims the order');
    assert.equal(order.vcc_job_id, 'job_stub_1');
    assert.equal(order.callback_nonce, 'nonce_stub_1');
    // CTX invoice XLM amount extracted from the stub payment URL.
    assert.equal(order.ctx_invoice_xlm, '10');
    assert.equal(order.ctx_stellar_txid, PART4_HASH);
    assert.ok(order.xlm_sent_at, 'xlm_sent_at must be set after payCtxOrder');
    assert.ok(order.vcc_notified_at, 'vcc_notified_at must be set after notifyPaid');
    assert.deepEqual(pipeline.notifyCalls, ['job_stub_1']);
    const unmatched = db
      .prepare(`SELECT COUNT(*) AS n FROM unmatched_payments WHERE stellar_txid = ?`)
      .get('TX_PART4_HAPPY');
    assert.equal(unmatched.n, 0, 'happy path must not touch unmatched_payments');
  });

  it('persists excess_usdc on overpayment and still completes fulfillment', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_EXCESS',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '11.50',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'ordering', 'overpayment is accepted, not rejected');
    assert.equal(order.excess_usdc, '1.5000000');
    assert.equal(order.vcc_job_id, 'job_stub_1');
    assert.equal(order.ctx_stellar_txid, PART4_HASH);
    assert.deepEqual(pipeline.notifyCalls, ['job_stub_1']);
  });

  it('claims an exact XLM payment and forwards the xlm branch to payCtxOrder', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', expectedXlmAmount: '100', apiKeyId });
    let payArgs = null;
    xlmSender.payCtxOrder = async (...args) => {
      payArgs = args;
      return PART4_HASH;
    };
    await handlePayment({
      txid: 'TX_PART4_XLM',
      paymentAsset: 'xlm_soroban',
      amountUsdc: null,
      amountXlm: '100',
      senderAddress: 'GSENDER',
      orderId,
    });

    assert.ok(payArgs, 'payCtxOrder must be called on the XLM branch');
    assert.equal(payArgs[1].paymentAsset, 'xlm_soroban');
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'ordering');
    assert.equal(order.ctx_stellar_txid, PART4_HASH);
    assert.deepEqual(pipeline.notifyCalls, ['job_stub_1']);
  });
});

// ── Part 4: corrupt-order bizEvent ───────────────────────────────────────

describe('Part 4: corrupt_order_amount bizEvent', () => {
  let apiKeyId;
  let restoreConsole;
  let biz;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-corrupt-event' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    biz = captureBizEvents();
  });

  afterEach(() => {
    restoreConsole();
    biz.restore();
    _resetTestHooks();
  });

  it("emits payment.corrupt_order_amount with the offending column", async () => {
    const orderId = seedPart4Order({ amountUsdc: '', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_CORRUPT_EVT',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const evt = biz.events.find((e) => e.name === 'payment.corrupt_order_amount');
    assert.ok(evt, 'expected payment.corrupt_order_amount bizEvent');
    assert.equal(evt.fields.order_id, orderId);
    assert.equal(evt.fields.column, 'amount_usdc');
    assert.equal(db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'pending_payment');
  });
});

// ── Part 4: definitive failure schedules a refund ────────────────────────

describe('Part 4: definitive failure schedules a refund', () => {
  let apiKeyId;
  let restoreConsole;
  let refundCalls;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-failure' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    _setVccClient({
      getInvoice: async () => {
        throw new Error('vcc invoice down');
      },
    });
    xlmSender.payCtxOrder = async () => PART4_HASH;
    refundCalls = stubRefundCapture();
  });

  afterEach(() => {
    restoreConsole();
    xlmSender.payCtxOrder = _realPayCtxOrder;
    _resetTestHooks();
  });

  it('marks failed and calls refundOrQuarantine when getInvoice throws', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_FAIL',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'failed');
    assert.ok(typeof order.error === 'string' && order.error.length > 0);
    assert.equal(order.ctx_stellar_txid, null, 'no outbound CTX tx happened');
    assert.equal(refundCalls.length, 1, 'refund must be scheduled exactly once');
    assert.equal(refundCalls[0].orderId, orderId);
    assert.equal(typeof refundCalls[0].message, 'string');
  });

  it('falls through to the refund path when ambiguous markers carry no txHash', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    _setVccClient({
      getInvoice: async () => ({
        vccJobId: 'job_stub_1',
        paymentUrl: PART4_PAYMENT_URL,
        callbackNonce: 'nonce_stub_1',
      }),
      notifyPaid: async () => ({ ok: true }),
    });
    xlmSender.payCtxOrder = async () => {
      // stellarStatus set but no txHash — outcome is definitively
      // failed (nothing may have landed), so auto-refund applies.
      const err = new Error('horizon timeout with no hash');
      err.stellarStatus = 'unknown';
      throw err;
    };
    await handlePayment({
      txid: 'TX_PART4_NOHASH',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'failed');
    assert.equal(order.ctx_stellar_txid, null);
    assert.equal(refundCalls.length, 1, 'hashless failure must auto-refund');
  });

  it('follows the refund path for a plain non-ambiguous payCtxOrder error', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    _setVccClient({
      getInvoice: async () => ({
        vccJobId: 'job_stub_1',
        paymentUrl: PART4_PAYMENT_URL,
        callbackNonce: 'nonce_stub_1',
      }),
      notifyPaid: async () => ({ ok: true }),
    });
    xlmSender.payCtxOrder = async () => {
      throw new Error('opaque horizon error with no markers');
    };
    await handlePayment({
      txid: 'TX_PART4_PLAIN',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'failed');
    assert.equal(refundCalls.length, 1);
  });
});

// ── Part 4: ambiguous CTX payment parks the order (unit level) ───────────

describe('Part 4: ambiguous CTX payment parks the order', () => {
  let apiKeyId;
  let restoreConsole;
  let refundCalls;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-ambiguous' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    _setVccClient({
      getInvoice: async () => ({
        vccJobId: 'job_stub_1',
        paymentUrl: PART4_PAYMENT_URL,
        callbackNonce: 'nonce_stub_1',
      }),
      notifyPaid: async () => ({ ok: true }),
    });
    refundCalls = stubRefundCapture();
  });

  afterEach(() => {
    restoreConsole();
    xlmSender.payCtxOrder = _realPayCtxOrder;
    _resetTestHooks();
  });

  function ambiguousError(stellarStatus, txHash) {
    const err = new Error(`submit network error ${stellarStatus}`);
    err.stellarStatus = stellarStatus;
    err.txHash = txHash;
    return err;
  }

  it("parks on stellarStatus=unknown with NO auto-refund", async () => {
    const hash = 'b'.repeat(64);
    xlmSender.payCtxOrder = async () => {
      throw ambiguousError('unknown', hash);
    };
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_AMB_UNKNOWN',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'failed', 'order must be parked as failed');
    assert.equal(order.ctx_stellar_txid, hash, 'hash must be captured for ops review');
    assert.equal(order.xlm_sent_at, null, 'xlm_sent_at stays null — outcome unsure');
    assert.equal(order.refund_stellar_txid, null, 'must NOT auto-refund on ambiguous outcome');
    assert.match(order.error, /ambiguous on-chain|operator/i);
    assert.doesNotMatch(order.error, /refunded automatically/i);
    assert.equal(refundCalls.length, 0, 'refundOrQuarantine must not fire on this path');
    // getInvoice ran before payCtxOrder, so the invoice checkpoint exists.
    assert.equal(order.vcc_job_id, 'job_stub_1');
  });

  it('parks on stellarStatus=applied_failed with NO auto-refund', async () => {
    const hash = 'c'.repeat(64);
    xlmSender.payCtxOrder = async () => {
      throw ambiguousError('applied_failed', hash);
    };
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await handlePayment({
      txid: 'TX_PART4_AMB_FAILED',
      paymentAsset: 'usdc_soroban',
      amountUsdc: '10.00',
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    assert.equal(order.status, 'failed');
    assert.equal(order.ctx_stellar_txid, hash);
    assert.equal(order.refund_stellar_txid, null);
    assert.equal(refundCalls.length, 0);
  });
});

// ── Part 4: duplicate-claim race branch ──────────────────────────────────
//
// The atomic `UPDATE ... WHERE status = 'pending_payment'` is the guard:
// when two events race, the loser sees changes === 0 and must record
// duplicate_payment instead of re-running fulfillment. The e2e suite
// covers the sequential double-event case (which funnels through the
// order_status_* re-read); this test forces the changes === 0 branch
// itself by wrapping db.prepare for the claim statement only.

describe('Part 4: duplicate-claim race branch', () => {
  let apiKeyId;
  let restoreConsole;
  let invoiceCalls;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-duplicate' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    invoiceCalls = 0;
    _setVccClient({
      getInvoice: async () => {
        invoiceCalls++;
        return {
          vccJobId: 'job_stub_1',
          paymentUrl: PART4_PAYMENT_URL,
          callbackNonce: 'nonce_stub_1',
        };
      },
      notifyPaid: async () => ({ ok: true }),
    });
    xlmSender.payCtxOrder = async () => PART4_HASH;
    stubRefundCapture();
  });

  afterEach(() => {
    restoreConsole();
    xlmSender.payCtxOrder = _realPayCtxOrder;
    _resetTestHooks();
  });

  it('records duplicate_payment and never starts fulfillment when the claim loses the race', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    const realPrepare = db.prepare;
    let blockClaim = true;
    db.prepare = function (sql, ...rest) {
      const stmt = realPrepare.call(db, sql, ...rest);
      if (blockClaim && /UPDATE orders\s+SET status = 'ordering'/.test(sql)) {
        return {
          run: () => {
            blockClaim = false;
            return { changes: 0 };
          },
// ── Post-claim pipeline: getInvoice → payCtxOrder → notifyPaid ─────────────
//
// Everything above this line covers the decision to *claim* an order: the
// amount comparison, the unmatched-payment routing, the atomic claim.
// The branches below run after the claim has already flipped the row to
// 'ordering', which is what makes them the expensive ones to get wrong —
// by then the order is committed to a fulfillment path and a mistake
// either double-spends treasury or wedges the row in 'ordering' with no
// refund scheduled.
//
// They were previously only reachable through the e2e suite, which boots
// a fake HTTP server and stubs the network collaborators at require.cache
// level. Reaching the outer catch that way means engineering a 502 out of
// the fake server, and the F1-jobs ambiguous branch needs an error object
// carrying stellarStatus/txHash, which HTTP cannot produce. The vcc-client
// import is a module object in src/payment-handler.js precisely so these
// can be substituted directly.

const vccClient = require('../../src/vcc-client');
const xlmSender = require('../../src/payments/xlm-sender');
const fulfillment = require('../../src/fulfillment');
const logger = require('../../src/lib/logger');

/** Swap collaborator methods for the duration of `fn`, always restoring. */
async function withStubs(stubs, fn) {
  const originals = new Map();
  for (const [obj, key, impl] of stubs) originals.set(obj, [obj[key], key]);
  const origError = console.error;
  const origEvent = logger.event;
  const events = [];
  logger.event = (name, fields) => events.push({ name, fields });
  console.error = () => {};
  for (const [obj, key, impl] of stubs) obj[key] = impl;
  try {
    return await fn(events);
  } finally {
    for (const [obj, key] of originals) {
      const [value] = originals.get(obj);
      obj[key] = value;
    }
    logger.event = origEvent;
    console.error = origError;
  }
}

describe('payment-handler: post-claim pipeline', () => {
  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'pipeline-test' });
    apiKeyId = key.id;
  });

  function seedOrder({ id = uuidv4(), amountUsdc = '10.00', expectedXlmAmount = null } = {}) {
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, expected_xlm_amount, request_id, created_at, updated_at)
       VALUES (?, 'pending_payment', ?, 'usdc', ?, ?, 'req-1', datetime('now'), datetime('now'))`,
    ).run(id, amountUsdc, apiKeyId, expectedXlmAmount);
    return id;
  }

  const getOrder = (id) => db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

  const okStubs = () => [
    [
      vccClient,
      'getInvoice',
      async () => ({
        vccJobId: 'VCC_JOB_1',
        // A real CTX invoice URI. parseStellarPayUri only recognises the
        // `stellar:pay?` / `web+stellar:pay?` schemes and returns all-nulls
        // for anything else, so an https:// URL here would silently leave
        // ctx_invoice_xlm unset and the assertion below would pass for the
        // wrong reason.
        paymentUrl: 'stellar:pay?destination=GCTX&amount=12.5&memo=inv-1',
        callbackNonce: 'nonce-1',
      }),
    ],
    [vccClient, 'notifyPaid', async () => ({})],
    [xlmSender, 'payCtxOrder', async () => 'CTX_TX_HASH_1'],
    // The settlement rate is snapshotted from a live price oracle. Left
    // unstubbed it turns a unit test into a network call with a multi-
    // second timeout, so pin it — and assert on it, since the dashboard
    // margin page depends on this column being populated.
    [require('../../src/payments/xlm-price'), 'getXlmUsdPrice', async () => 0.12],
  ];

  it('persists every checkpoint so a mid-flight crash is recoverable', async () => {
    const orderId = seedOrder();
    await withStubs(okStubs(), async () => {
      await handlePayment({
        txid: 'TX_HAPPY',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '10.00',
        amountXlm: null,
        senderAddress: 'GSENDER',
        orderId,
      });
    });

    const row = getOrder(orderId);
    assert.equal(row.status, 'ordering');
    assert.equal(row.stellar_txid, 'TX_HAPPY');
    assert.equal(row.sender_address, 'GSENDER');
    assert.equal(row.vcc_job_id, 'VCC_JOB_1');
    assert.equal(row.callback_nonce, 'nonce-1');
    // ctx_invoice_xlm comes from parsing the invoice payment URL, and is
    // what the dashboard margin page uses for cost-of-sale.
    assert.equal(row.ctx_invoice_xlm, '12.5');
    // Snapshot of the XLM/USD rate at settlement, so margin can be
    // computed later without re-querying a rate that has since moved.
    assert.equal(row.settlement_xlm_usd_rate, '0.12');
    // Set on success so the reconciler and ops can attribute the spend.
    assert.equal(row.ctx_stellar_txid, 'CTX_TX_HASH_1');
    assert.ok(row.xlm_sent_at, 'xlm_sent_at should be stamped');
    assert.ok(row.vcc_notified_at, 'vcc_notified_at should be stamped');
  });

  it('persists excess_usdc on the row, not only in the bizEvent', async () => {
    // refund bookkeeping reads the column; emitting the event alone would
    // leave the operator with no way to know how much to send back.
    const orderId = seedOrder();
    await withStubs(okStubs(), async () => {
      await handlePayment({
        txid: 'TX_EXCESS',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '12.25',
        amountXlm: null,
        senderAddress: 'GSENDER',
        orderId,
      });
    });
    const row = getOrder(orderId);
    assert.match(row.excess_usdc, /^2\.2500000$/);
  });

  it('leaves excess_usdc untouched on an exact payment', async () => {
    const orderId = seedOrder();
    await withStubs(okStubs(), async () => {
      await handlePayment({
        txid: 'TX_EXACT2',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '10.00',
        amountXlm: null,
        senderAddress: 'GSENDER',
        orderId,
      });
    });
    assert.equal(getOrder(orderId).excess_usdc, null);
  });

  it('still claims the order when the optional telemetry lookups fail', async () => {
    // The xlm-price oracle and the URI parser are explicitly non-critical.
    // A failure in either must not abort a paid order.
    const orderId = seedOrder();
    const pricePath = require.resolve('../../src/payments/xlm-price');
    const senderPath = require.resolve('../../src/payments/xlm-sender');
    const savedPrice = require.cache[pricePath];
    const savedSender = require.cache[senderPath];
    require.cache[pricePath] = {
      exports: {
        getXlmUsdPrice: async () => {
          throw new Error('oracle down');
        },
      },
    };
    require.cache[senderPath] = { exports: { payCtxOrder: async () => 'CTX_TX_HASH_2' } };
    try {
      await withStubs(
        [
          [
            vccClient,
            'getInvoice',
            async () => ({ vccJobId: 'J', paymentUrl: 'not-a-uri', callbackNonce: 'n' }),
          ],
          [vccClient, 'notifyPaid', async () => ({})],
        ],
        async () => {
          await handlePayment({
            txid: 'TX_TELEMETRY',
            paymentAsset: 'usdc_soroban',
            amountUsdc: '10.00',
            amountXlm: null,
            senderAddress: 'GSENDER',
            orderId,
          });
        },
      );
    } finally {
      if (savedPrice) require.cache[pricePath] = savedPrice;
      else delete require.cache[pricePath];
      if (savedSender) require.cache[senderPath] = savedSender;
      else delete require.cache[senderPath];
    }
    const row = getOrder(orderId);
    assert.equal(row.status, 'ordering');
    assert.equal(row.settlement_xlm_usd_rate, null, 'oracle failure leaves the rate unset');
  });
});

describe('F1-jobs: ambiguous CTX payment is parked, never auto-refunded', () => {
  // The double-spend guard. payCtxOrder can throw after the tx has
  // already landed on-chain (lost response). If that case were treated as
  // a definite failure and refunded, treasury pays CTX once for the
  // gift card and refunds the agent once for the same order.
  // src/payment-handler.js parks the row instead and leaves it for ops.

  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'ambiguous-test' });
    apiKeyId = key.id;
  });

  function seedOrder(id = uuidv4()) {
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
       VALUES (?, 'pending_payment', '10.00', 'usdc', ?, datetime('now'), datetime('now'))`,
    ).run(id, apiKeyId);
    return id;
  }

  const getOrder = (id) => db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

  function ambiguousError(stellarStatus) {
    const err = new Error('submit response lost');
    err.stellarStatus = stellarStatus;
    err.txHash = 'CTX_AMBIGUOUS_HASH';
    return err;
  }

  const baseStubs = (payImpl) => [
    [
      vccClient,
      'getInvoice',
      async () => ({
        vccJobId: 'J_AMB',
        paymentUrl: 'https://pay.stellar.test/xlm?amount=12.5',
        callbackNonce: 'n-amb',
      }),
    ],
    [
      vccClient,
      'notifyPaid',
      async () => {
        throw new Error('notifyPaid must not run for an ambiguous CTX payment');
      },
    ],
    [xlmSender, 'payCtxOrder', payImpl],
  ];

  for (const stellarStatus of ['unknown', 'applied_failed']) {
    it(`parks the order and refunds nothing when stellarStatus='${stellarStatus}'`, async () => {
      const orderId = seedOrder();
      let refundCalls = 0;
      await withStubs(
        [
          ...baseStubs(async () => {
            throw ambiguousError(stellarStatus);
          }),
          [
            fulfillment,
            'refundOrQuarantine',
            async () => {
              refundCalls++;
            },
          ],
        ],
        async (events) => {
          await handlePayment({
            txid: `TX_AMB_${stellarStatus}`,
            paymentAsset: 'usdc_soroban',
            amountUsdc: '10.00',
            amountXlm: null,
            senderAddress: 'GSENDER',
            orderId,
          });

          const row = getOrder(orderId);
          assert.equal(row.status, 'failed');
          // The hash is what lets ops check the chain and decide.
          assert.equal(row.ctx_stellar_txid, 'CTX_AMBIGUOUS_HASH');
          // This is the assertion the whole branch exists for.
          assert.equal(refundCalls, 0, 'an ambiguous payment must never trigger a refund');
          const evt = events.find((e) => e.name === 'ctx.payment_ambiguous');
          assert.ok(evt, 'expected ctx.payment_ambiguous bizEvent');
          assert.equal(evt.fields.stellar_status, stellarStatus);
          assert.equal(evt.fields.tx_hash, 'CTX_AMBIGUOUS_HASH');
        },
      );
    });
  }

  it('does NOT park when the error carries a status but no tx hash', async () => {
    // Without a hash there is nothing for ops to verify on-chain, so the
    // outcome is a definite failure: refund normally.
    const orderId = seedOrder();
    const err = new Error('rejected before submit');
    err.stellarStatus = 'unknown';
    // deliberately no txHash

    let refundCalls = 0;
    await withStubs(
      [
        ...baseStubs(async () => {
          throw err;
        }),
        [
          fulfillment,
          'refundOrQuarantine',
          async () => {
            refundCalls++;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_AMB_NO_HASH',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    assert.equal(getOrder(orderId).status, 'failed');
    assert.equal(getOrder(orderId).ctx_stellar_txid, null);
    assert.equal(refundCalls, 1, 'a hashless failure is a definite failure and must refund');
  });

  it('does NOT park for an unrelated error status', async () => {
    const orderId = seedOrder();
    const err = new Error('insufficient balance');
    err.stellarStatus = 'rejected';
    err.txHash = 'SOME_HASH';

    let refundCalls = 0;
    await withStubs(
      [
        ...baseStubs(async () => {
          throw err;
        }),
        [
          fulfillment,
          'refundOrQuarantine',
          async () => {
            refundCalls++;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_REJECTED',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    assert.equal(refundCalls, 1);
  });
});

describe('payment-handler: outer catch after the claim', () => {
  // The claim has already committed the row to 'ordering' by this point,
  // so the catch is the only thing standing between a paid order and a
  // row that is stuck in 'ordering' forever with no refund.

  let apiKeyId;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'catch-test' });
    apiKeyId = key.id;
  });

  function seedOrder(id = uuidv4()) {
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
       VALUES (?, 'pending_payment', '10.00', 'usdc', ?, datetime('now'), datetime('now'))`,
    ).run(id, apiKeyId);
    return id;
  }

  const getOrder = (id) => db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);

  it('marks the order failed and schedules a refund when getInvoice throws', async () => {
    const orderId = seedOrder();
    let refundArgs = null;
    await withStubs(
      [
        [
          vccClient,
          'getInvoice',
          async () => {
            throw new Error('vcc 502');
          },
        ],
        [
          fulfillment,
          'refundOrQuarantine',
          async (...a) => {
            refundArgs = a;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_INVOICE_FAIL',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    const row = getOrder(orderId);
    assert.equal(row.status, 'failed');
    // The raw upstream string is sanitised before it lands in the column:
    // agents read this via GET /v1/orders/:id.
    assert.ok(row.error);
    assert.doesNotMatch(row.error, /502/);
    assert.equal(refundArgs[0], orderId);
  });

  it('handles a thrown null without the catch block itself crashing', async () => {
    // F1-payment-handler: `err.message` on null throws inside the catch,
    // which would leave the row wedged in 'ordering' with no refund.
    const orderId = seedOrder();
    let refundCalls = 0;
    await withStubs(
      [
        [
          vccClient,
          'getInvoice',
          async () => {
            throw null;
          },
        ],
        [
          fulfillment,
          'refundOrQuarantine',
          async () => {
            refundCalls++;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_THROW_NULL',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    assert.equal(getOrder(orderId).status, 'failed');
    assert.equal(refundCalls, 1);
  });

  it('handles a thrown string without the catch block itself crashing', async () => {
    const orderId = seedOrder();
    let refundCalls = 0;
    await withStubs(
      [
        [
          vccClient,
          'getInvoice',
          async () => {
            throw 'plain string failure';
          },
        ],
        [
          fulfillment,
          'refundOrQuarantine',
          async () => {
            refundCalls++;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_THROW_STRING',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    assert.equal(getOrder(orderId).status, 'failed');
    assert.equal(refundCalls, 1);
  });

  it('hands the CTX-paid row to refundOrQuarantine with ctx_stellar_txid intact', async () => {
    // ctx_stellar_txid is set on the success path before notifyPaid runs.
    // refundOrQuarantine reads that column to decide refund-vs-quarantine,
    // so the property worth asserting here is that the marker survived the
    // failure — a handler that cleared it would turn a "verify on-chain"
    // case into a silent treasury loss.
    const orderId = seedOrder();
    let seenCtxTxid = 'not-called';
    await withStubs(
      [
        [
          vccClient,
          'getInvoice',
          async () => ({
            vccJobId: 'J',
            paymentUrl: 'stellar:pay?destination=GCTX&amount=1',
            callbackNonce: 'n',
          }),
        ],
        [
          vccClient,
          'notifyPaid',
          async () => {
            throw new Error('notify failed after CTX paid');
          },
        ],
        [xlmSender, 'payCtxOrder', async () => 'CTX_TX_OK'],
        [
          fulfillment,
          'refundOrQuarantine',
          async (id) => {
            seenCtxTxid = db
              .prepare(`SELECT ctx_stellar_txid FROM orders WHERE id = ?`)
              .get(id).ctx_stellar_txid;
          },
        ],
      ],
      async () => {
        await handlePayment({
          txid: 'TX_LATE_FAIL',
          paymentAsset: 'usdc_soroban',
          amountUsdc: '10.00',
          amountXlm: null,
          senderAddress: 'GSENDER',
          orderId,
        });
      },
    );
    const row = getOrder(orderId);
    assert.equal(row.status, 'failed');
    assert.equal(seenCtxTxid, 'CTX_TX_OK', 'the CTX payment marker must reach the router');
  });
});

describe('payment-handler: lost claim race', () => {
  // The status check and the UPDATE are two statements, so a second
  // payment event for the same order can pass the check and then find
  // the row already claimed. That loser must be recorded for refund
  // rather than proceeding to pay the supplier twice.

  it('records duplicate_payment when the claim UPDATE matches no rows', async () => {
    resetDb();
    const key = await createTestKey({ label: 'race-test' });
    const orderId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, created_at, updated_at)
       VALUES (?, 'pending_payment', '10.00', 'usdc', ?, datetime('now'), datetime('now'))`,
    ).run(orderId, key.id);

    // Simulate the race by flipping the row to 'ordering' immediately
    // after handlePayment's SELECT reads it, so its UPDATE — which
    // requires status = 'pending_payment' — matches nothing.
    const realPrepare = db.prepare.bind(db);
    let flipped = false;
    db.prepare = (sql) => {
      const stmt = realPrepare(sql);
      if (!flipped && /SELECT \* FROM orders WHERE id/.test(sql)) {
        flipped = true;
        const origGet = stmt.get.bind(stmt);
        stmt.get = (...args) => {
          const row = origGet(...args);
          realPrepare(`UPDATE orders SET status = 'ordering' WHERE id = ?`).run(...args);
          return row;
        };
      }
      return stmt;
    };

    try {
      await handlePayment({
        txid: 'TX_RACE_LOSER',
        paymentAsset: 'usdc_soroban',
        amountUsdc: '10.00',
        amountXlm: null,
        senderAddress: 'GSENDER',
        orderId,
      });
    } finally {
      db.prepare = realPrepare;
    }

    assert.equal(
      db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'pending_payment',
      'losing the claim race must leave the order untouched',
    );
    const unmatched = db
      .prepare(`SELECT * FROM unmatched_payments WHERE stellar_txid = ?`)
      .get('TX_PART4_DUPE_RACE');
    assert.ok(unmatched, 'expected an unmatched_payments row');
    assert.equal(unmatched.reason, 'duplicate_payment');
    assert.equal(invoiceCalls, 0, 'fulfillment must not start after a lost claim');
  });
});

// ── Part 4: stroop-precision amount boundaries ───────────────────────────
//
// compareDecimal / toStroops are exercised behaviorally through
// handlePayment: exact 7-decimal equivalence claims, a single stroop
// over/under settles the over/underpaid routing, and sub-stroop dust
// (8th decimal) truncates rather than tipping the comparison.

describe('Part 4: stroop-precision amount boundaries', () => {
  let apiKeyId;
  let restoreConsole;
  let biz;

  beforeEach(async () => {
    resetDb();
    const key = await createTestKey({ label: 'part4-precision' });
    apiKeyId = key.id;
    restoreConsole = silenceConsoleError();
    biz = captureBizEvents();
    stubSuccessPipeline();
    stubRefundCapture();
  });

  afterEach(() => {
    restoreConsole();
    biz.restore();
    xlmSender.payCtxOrder = _realPayCtxOrder;
    _resetTestHooks();
  });

  async function payExactBoundary(orderId, amountUsdc, txid) {
    await handlePayment({
      txid,
      paymentAsset: 'usdc_soroban',
      amountUsdc,
      amountXlm: null,
      senderAddress: 'GSENDER',
      orderId,
    });
  }

  it("claims on trailing-zero 7-decimal equivalence without an overpaid event", async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await payExactBoundary(orderId, '10.0000000', 'TX_PART4_PREC_EXACT');

    assert.equal(
      db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'ordering',
    );
    assert.equal(
      biz.events.filter((e) => e.name === 'payment.usdc_overpaid').length,
      0,
      'exact 7dp match must not emit overpaid',
    );
  });

  it('treats one stroop over as overpayment with exact excess', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await payExactBoundary(orderId, '10.0000001', 'TX_PART4_PREC_OVER');

    assert.equal(
      db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'ordering',
    );
    const overpaid = biz.events.find((e) => e.name === 'payment.usdc_overpaid');
    assert.ok(overpaid, 'expected payment.usdc_overpaid bizEvent');
    assert.equal(overpaid.fields.excess_usdc, '0.0000001');
    assert.equal(
      db.prepare(`SELECT excess_usdc FROM orders WHERE id = ?`).get(orderId).excess_usdc,
      '0.0000001',
    );
  });

  it('treats one stroop under as underpayment', async () => {
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await payExactBoundary(orderId, '9.9999999', 'TX_PART4_PREC_UNDER');

    assert.equal(
      db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'pending_payment',
    );
    assert.equal(
      db.prepare(`SELECT reason FROM unmatched_payments WHERE stellar_txid = ?`).get(
        'TX_PART4_PREC_UNDER',
      ).reason,
      'underpaid_usdc',
    );
  });

  it('truncates sub-stroop dust instead of tipping the comparison', async () => {
    // 8th-decimal dust is below Stellar stroop precision and is cut by
    // toStroops — this stays an exact match, not an overpayment.
    const orderId = seedPart4Order({ amountUsdc: '10.00', apiKeyId });
    await payExactBoundary(orderId, '10.00000009', 'TX_PART4_PREC_DUST');

    assert.equal(
      db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId).status,
      'ordering',
    );
    assert.equal(
      biz.events.filter((e) => e.name === 'payment.usdc_overpaid').length,
      0,
      'sub-stroop dust must not emit overpaid',
    );
    const unmatched = db
      .prepare(`SELECT * FROM unmatched_payments WHERE stellar_txid = 'TX_RACE_LOSER'`)
      .get();
    assert.ok(unmatched, 'the losing event must be recorded for refund');
    assert.equal(unmatched.reason, 'duplicate_payment');
  });
});
