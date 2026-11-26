// Unit tests for backend/src/payments/parse-payment-event.js — memo
// validation & UTF-8 sanitization.
//
// The memo helpers are pure, so we exercise them directly. The goal is that
// order-UUID matching never keys off raw, malformed memo bytes: every memo
// shape (MemoText / MemoId / MemoHash) is normalized to a printable string
// and only then checked against the 36-character hyphenated UUID format.
// Anything unrecognized is logged as a warning and reported as a structured
// failure — never thrown.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parsePaymentEvent, parsePaymentMemo, sanitizeMemoText, isOrderUuid, normalizeMemo } =
  require('../../src/payments/parse-payment-event');

// A canonical lowercase v4 UUID in the shape `orders.id` takes.
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID_UPPER = UUID.toUpperCase();

// Collects warnings so tests can assert on the log without printing noise.
function captureLog() {
  const warnings = [];
  const log = (message) => warnings.push(message);
  return { warnings, log };
}

// ── sanitizeMemoText ───────────────────────────────────────────────────────

describe('sanitizeMemoText', () => {
  it('passes printable strings through unchanged', () => {
    assert.equal(sanitizeMemoText(UUID), UUID);
    assert.equal(sanitizeMemoText('order id 1'), 'order id 1');
  });

  it('strips C0/C1 control characters, DEL and NUL padding', () => {
    assert.equal(sanitizeMemoText('a\x00b\x01c\x7fd\x9fe'), 'abcde');
  });

  it('strips the U+FFFD replacement char produced by invalid UTF-8', () => {
    // Node decodes each invalid byte to U+FFFD; both are removed.
    const decoded = Buffer.from([0x41, 0xff, 0x42, 0xfe, 0x43]).toString('utf-8');
    assert.equal(sanitizeMemoText(decoded), 'ABC');
  });

  it('decodes Buffer and Uint8Array inputs as UTF-8', () => {
    assert.equal(sanitizeMemoText(Buffer.from(UUID, 'utf-8')), UUID);
    assert.equal(sanitizeMemoText(new Uint8Array(Buffer.from('hello', 'utf-8'))), 'hello');
  });

  it('stringifies numbers and bigints (MemoId shorthand)', () => {
    assert.equal(sanitizeMemoText(42), '42');
    assert.equal(sanitizeMemoText(9_007_199_254_740_993n), '9007199254740993');
  });

  it('returns an empty string for unsupported inputs', () => {
    assert.equal(sanitizeMemoText(null), '');
    assert.equal(sanitizeMemoText(undefined), '');
    assert.equal(sanitizeMemoText({}), '');
  });
});

// ── isOrderUuid ────────────────────────────────────────────────────────────

describe('isOrderUuid', () => {
  it('accepts canonical hyphenated UUIDs regardless of case', () => {
    assert.equal(isOrderUuid(UUID), true);
    assert.equal(isOrderUuid(UUID_UPPER), true);
  });

  it('rejects malformed / non-UUID values', () => {
    assert.equal(isOrderUuid('mpp_c_abc'), false);
    assert.equal(isOrderUuid(UUID.slice(0, 35)), false); // too short
    assert.equal(isOrderUuid(`${UUID}0`), false); // too long
    assert.equal(isOrderUuid(UUID.replace('-', '_')), false); // wrong separator
    assert.equal(isOrderUuid(UUID.replace('5', 'g')), false); // non-hex char
    assert.equal(isOrderUuid(''), false);
    assert.equal(isOrderUuid(null), false);
    assert.equal(isOrderUuid(12345), false);
  });
});

// ── normalizeMemo ──────────────────────────────────────────────────────────

describe('normalizeMemo', () => {
  it('treats bare strings, Buffers and Uint8Arrays as MemoText', () => {
    assert.deepEqual(normalizeMemo(UUID), { memoType: 'text', candidate: UUID });
    assert.deepEqual(normalizeMemo(Buffer.from(UUID, 'utf-8')), {
      memoType: 'text',
      candidate: UUID,
    });
    assert.deepEqual(normalizeMemo(new Uint8Array(Buffer.from('hi', 'utf-8'))), {
      memoType: 'text',
      candidate: 'hi',
    });
  });

  it('treats bare numbers and bigints as MemoId', () => {
    assert.deepEqual(normalizeMemo(7), { memoType: 'id', candidate: '7' });
    assert.deepEqual(normalizeMemo(7n), { memoType: 'id', candidate: '7' });
  });

  it('honours explicit types, including Stellar SDK-style names', () => {
    assert.deepEqual(normalizeMemo({ type: 'text', value: UUID }), {
      memoType: 'text',
      candidate: UUID,
    });
    assert.deepEqual(normalizeMemo({ type: 'MemoText', value: UUID }), {
      memoType: 'text',
      candidate: UUID,
    });
    assert.deepEqual(normalizeMemo({ type: 'MEMO_ID', value: 5 }), {
      memoType: 'id',
      candidate: '5',
    });
    assert.deepEqual(normalizeMemo({ type: 'memo_hash', value: Buffer.alloc(32, 0xab) }), {
      memoType: 'hash',
      candidate: 'ab'.repeat(32),
    });
  });

  it('lowercases an already-hex MemoHash string', () => {
    assert.deepEqual(normalizeMemo({ type: 'hash', value: 'AB'.repeat(32) }), {
      memoType: 'hash',
      candidate: 'ab'.repeat(32),
    });
  });

  it('reports none for null / undefined / explicit none', () => {
    assert.deepEqual(normalizeMemo(null), { memoType: 'none', candidate: null });
    assert.deepEqual(normalizeMemo(undefined), { memoType: 'none', candidate: null });
    assert.deepEqual(normalizeMemo({ type: 'none' }), { memoType: 'none', candidate: null });
  });

  it('reports unknown for unrecognized shapes', () => {
    assert.deepEqual(normalizeMemo(true), { memoType: 'unknown', candidate: null });
    assert.deepEqual(normalizeMemo({ type: 'custom', value: 'x' }), {
      memoType: 'unknown',
      candidate: null,
    });
  });
});

// ── parsePaymentMemo — MemoText ────────────────────────────────────────────

describe('parsePaymentMemo — MemoText', () => {
  it('returns the order id for a well-formed UUID string', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo(UUID, log), { ok: true, memoType: 'text', orderId: UUID });
    assert.equal(warnings.length, 0);
  });

  it('normalizes an uppercase UUID to the canonical lowercase form', () => {
    const { log } = captureLog();
    assert.deepEqual(parsePaymentMemo(UUID_UPPER, log), {
      ok: true,
      memoType: 'text',
      orderId: UUID,
    });
  });

  it('recovers a UUID that has a stray control byte embedded', () => {
    const { warnings, log } = captureLog();
    const dirty = `${UUID.slice(0, 10)}\x01${UUID.slice(10)}`;
    assert.deepEqual(parsePaymentMemo(dirty, log), { ok: true, memoType: 'text', orderId: UUID });
    assert.equal(warnings.length, 0);
  });

  it('accepts UTF-8 Buffer payloads and strips NUL padding', () => {
    const { log } = captureLog();
    const padded = Buffer.concat([Buffer.from(UUID, 'utf-8'), Buffer.from([0x00, 0x00])]);
    assert.deepEqual(parsePaymentMemo(padded, log), {
      ok: true,
      memoType: 'text',
      orderId: UUID,
    });
  });

  it('warns and returns invalid_order_id for a non-UUID text memo', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo('mpp_c_order', log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'text',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not a valid order UUID/);
  });

  it('rejects text whose bytes decode to an unusable UUID fragment', () => {
    const { warnings, log } = captureLog();
    const broken = Buffer.from([0x35, 0x35, 0x30, 0xff, 0xfe]);
    assert.deepEqual(parsePaymentMemo(broken, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'text',
    });
    assert.equal(warnings.length, 1);
  });
});

// ── parsePaymentMemo — MemoId ──────────────────────────────────────────────

describe('parsePaymentMemo — MemoId', () => {
  it('handles an integer memo without crashing and rejects it as a UUID', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo({ type: 'id', value: 12345n }, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'id',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\(id\)/);
  });

  it('accepts the bare-integer shorthand as MemoId', () => {
    const { log } = captureLog();
    assert.deepEqual(parsePaymentMemo(42, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'id',
    });
  });

  it('still validates a UUID-shaped MemoId payload', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo({ type: 'id', value: UUID }, log), {
      ok: true,
      memoType: 'id',
      orderId: UUID,
    });
    assert.equal(warnings.length, 0);
  });
});

// ── parsePaymentMemo — MemoHash ────────────────────────────────────────────

describe('parsePaymentMemo — MemoHash', () => {
  it('hex-encodes a 32-byte hash memo and rejects it as a UUID', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo({ type: 'hash', value: Buffer.alloc(32, 0xab) }, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'hash',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\(hash\)/);
  });

  it('handles a hex-string hash memo case-insensitively', () => {
    const { log } = captureLog();
    assert.deepEqual(parsePaymentMemo({ type: 'hash', value: 'AB'.repeat(32) }, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'hash',
    });
  });
});

// ── parsePaymentMemo — absent / unrecognized / hostile input ───────────────

describe('parsePaymentMemo — robustness', () => {
  it('reports none (without warning) when there is no memo', () => {
    const { warnings, log } = captureLog();
    for (const input of [null, undefined, { type: 'none' }]) {
      assert.deepEqual(parsePaymentMemo(input, log), { ok: false, kind: 'none' });
    }
    assert.equal(warnings.length, 0);
  });

  it('warns and reports unrecognized_memo_type for an unknown type', () => {
    const { warnings, log } = captureLog();
    assert.deepEqual(parsePaymentMemo({ type: 'memo_custom', value: 'x' }, log), {
      ok: false,
      kind: 'unrecognized_memo_type',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unrecognized payment memo type/);
  });

  it('does not crash on a memo whose type getter throws', () => {
    const { warnings, log } = captureLog();
    const hostile = {
      get type() {
        throw new Error('boom');
      },
    };
    assert.deepEqual(parsePaymentMemo(hostile, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'unknown',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /failed to parse payment memo/);
  });

  it('does not crash on a memo whose value getter throws', () => {
    const { warnings, log } = captureLog();
    const hostile = {
      type: 'text',
      get value() {
        throw new Error('nope');
      },
    };
    assert.deepEqual(parsePaymentMemo(hostile, log), {
      ok: false,
      kind: 'invalid_order_id',
      memoType: 'unknown',
    });
    assert.equal(warnings.length, 1);
  });

  it('falls back to console.warn when no logger is injected', () => {
    const original = console.warn;
    const seen = [];
    console.warn = (message) => seen.push(message);
    try {
      const result = parsePaymentMemo('not-a-uuid');
      assert.equal(result.ok, false);
      assert.equal(seen.length, 1);
    } finally {
      console.warn = original;
    }
  });
});

// ── Regression: the existing event parser is unchanged ─────────────────────

describe('parsePaymentEvent — unchanged', () => {
  it('still parses a well-formed pay_usdc event', () => {
    const { xdr, nativeToScVal } = require('@stellar/stellar-sdk');
    const event = {
      txHash: 'TX1',
      ledger: 1,
      topic: [
        xdr.ScVal.scvSymbol('pay_usdc'),
        nativeToScVal(Buffer.from('order-abc-1', 'utf-8'), { type: 'bytes' }),
      ],
      value: nativeToScVal(250_000n, { type: 'i128' }),
    };
    // topic[2] (Address) is required; build a valid G-address ScVal.
    const { Address, Keypair } = require('@stellar/stellar-sdk');
    event.topic.push(new Address(Keypair.random().publicKey()).toScVal());

    const result = parsePaymentEvent(event);
    assert.equal(result.ok, true);
    assert.equal(result.payload.paymentAsset, 'usdc_soroban');
    assert.equal(result.payload.amountUsdc, '0.0250000');
    assert.equal(result.payload.orderId, 'order-abc-1');
  });
});
