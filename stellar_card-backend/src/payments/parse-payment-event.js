// @ts-check
// Pure parser for Stellar_Card receiver contract events.
//
// Extracted from payments/stellar.js so the same logic can parse events from
// two different sources: (a) the async Soroban event watcher (startWatcher)
// and (b) the synchronous MPP payment verifier. Having one parser ensures
// the two paths never diverge on what counts as a valid payment event.
//
// This module is pure — no DB, no logger, no network. Callers translate the
// result into whatever side effects they need (dead-letter row, log line,
// HTTP response).

const { scValToNative, Address } = require('@stellar/stellar-sdk');

// Convert a non-negative 7-decimal-place i128 (USDC micro-units or XLM
// stroops) to a decimal string. Throws on negative input — the formatter's
// modulus math produces nonsense strings on negative BigInts.
function stroopsToDecimal(i128) {
  if (typeof i128 !== 'bigint') throw new Error('stroopsToDecimal: expected bigint');
  if (i128 < 0n) throw new Error('stroopsToDecimal: negative amount');
  const whole = i128 / 10_000_000n;
  const frac = String(i128 % 10_000_000n).padStart(7, '0');
  return `${whole}.${frac}`;
}

/**
 * Parse a Soroban event from the receiver contract into a dispatch payload
 * the rest of the system understands.
 *
 * Event shape expected from the receiver contract:
 *   topic[0] = Symbol("pay_usdc") or Symbol("pay_xlm")
 *   topic[1] = Bytes(order_id utf-8)
 *   topic[2] = Address(from)
 *   value    = i128 amount (micro-USDC or stroops)
 *
 * Returns one of:
 *   { ok: true, payload }                 — dispatch this
 *   { ok: false, kind: 'skip' }           — silently skip (topic too short)
 *   { ok: false, kind: 'unknown_symbol', symbol } — log, no dead-letter
 *   { ok: false, kind: 'parse_error', error }     — dead-letter it
 *
 * @param {any} event
 */
function parsePaymentEvent(event) {
  // Topic too short — not one of our events, skip silently.
  if (!event?.topic || event.topic.length < 3) {
    return { ok: false, kind: 'skip' };
  }

  let eventSymbol, orderId, senderAddress, amountDecimal;
  try {
    eventSymbol = scValToNative(event.topic[0]); // 'pay_usdc' or 'pay_xlm'

    // Cap orderId bytes before Buffer allocation. A malformed/hostile event
    // with a 10KB orderId would otherwise bloat logs + downstream params.
    // UUIDs are 36 chars; our short-ids are well under 64.
    const orderIdBytes = scValToNative(event.topic[1]);
    if (!orderIdBytes || orderIdBytes.length === 0 || orderIdBytes.length > 64) {
      throw new Error(`orderId bytes length out of range: ${orderIdBytes?.length}`);
    }
    orderId = Buffer.from(orderIdBytes).toString('utf-8');
    // Reject non-printable / control bytes in the decoded order id.
    if (!/^[\x20-\x7e]+$/.test(orderId)) {
      throw new Error('orderId contains non-printable bytes');
    }

    senderAddress = Address.fromScVal(event.topic[2]).toString();

    // Enforce non-negative, non-zero amount at parse time. Zero is a no-op,
    // negative is either a bug or an attack. Either way it belongs in the
    // dead-letter table, not dispatched.
    const amountI128 = BigInt(scValToNative(event.value));
    if (amountI128 <= 0n) {
      throw new Error(`non-positive amount i128: ${amountI128}`);
    }
    amountDecimal = stroopsToDecimal(amountI128);
  } catch (err) {
    return {
      ok: false,
      kind: 'parse_error',
      error: /** @type {Error} */ (err).message,
    };
  }

  if (eventSymbol === 'pay_usdc') {
    return {
      ok: true,
      payload: {
        txid: event.txHash,
        paymentAsset: 'usdc_soroban',
        amountUsdc: amountDecimal,
        amountXlm: null,
        senderAddress,
        orderId,
        eventSymbol,
      },
    };
  }
  if (eventSymbol === 'pay_xlm') {
    return {
      ok: true,
      payload: {
        txid: event.txHash,
        paymentAsset: 'xlm_soroban',
        amountUsdc: null,
        amountXlm: amountDecimal,
        senderAddress,
        orderId,
        eventSymbol,
      },
    };
  }

  return { ok: false, kind: 'unknown_symbol', symbol: String(eventSymbol) };
}

// ── Payment memo validation & sanitization ────────────────────────────────
//
// A Stellar transaction can carry a memo naming the order a payment is for.
// Three memo shapes exist on-chain — MemoText (UTF-8, ≤28 bytes), MemoId
// (unsigned 64-bit integer) and MemoHash (32 raw bytes) — and the bytes can
// be malformed: truncated multi-byte UTF-8 sequences, embedded control
// characters, or NUL padding from a fixed-width buffer. Matching an order
// UUID against that raw input directly is fragile, so every shape is first
// normalized to a printable candidate string and only then checked against
// the UUID format.
//
// These helpers stay pure — no DB, no network — apart from an injectable
// warning logger, mirroring how parsePaymentEvent hands structured failures
// back to its caller instead of deciding side effects itself.

// Canonical 36-character hyphenated UUID — the shape `orders.id` takes when
// the row was created via uuid v4.
const ORDER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// C0 controls (0x00–0x1F), DEL (0x7F), C1 controls (0x80–0x9F) and the
// U+FFFD replacement character. Stripping U+FFFD matters: Node substitutes
// it for every invalid UTF-8 byte, so a single corrupt byte inside an
// otherwise valid UUID would survive the decode as a printable glyph and
// slip past the format check below.
const NON_PRINTABLE_RE = /[\u0000-\u001F\u007F-\u009F\uFFFD]/g;

/**
 * Decode a memo value to a printable UTF-8 string. Accepts raw bytes
 * (Buffer / Uint8Array), strings and integers; anything else yields ''.
 * Control characters and the UTF-8 replacement char are stripped so the
 * result is safe to log and to compare.
 * @param {unknown} input
 * @returns {string}
 */
function sanitizeMemoText(input) {
  let text;
  if (typeof input === 'string') {
    text = input;
  } else if (Buffer.isBuffer(input)) {
    text = input.toString('utf-8');
  } else if (input instanceof Uint8Array) {
    text = Buffer.from(input).toString('utf-8');
  } else if (typeof input === 'number' || typeof input === 'bigint') {
    text = String(input);
  } else {
    return '';
  }
  return text.replace(NON_PRINTABLE_RE, '');
}

/**
 * Map a caller-supplied memo type onto the canonical set
 * ('text' | 'id' | 'hash' | 'none'). Tolerates Stellar SDK-style names
 * ('MemoText', 'MEMO_ID', 'memo_hash'); unknown values return ''.
 * @param {unknown} type
 * @returns {string}
 */
function canonicalMemoType(type) {
  if (typeof type !== 'string') return '';
  const s = type.toLowerCase().replace(/^memo[\s_-]?/, '').replace(/[\s_-]?type$/, '');
  return s === 'text' || s === 'id' || s === 'hash' || s === 'none' ? s : '';
}

/**
 * Normalize a MemoHash value to a lowercase hex string. Buffers are
 * hex-encoded directly; an already-hex string is lowercased and any other
 * string goes through sanitization first.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeMemoHash(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  const s = sanitizeMemoText(value);
  return /^[0-9a-f]{64}$/i.test(s) ? s.toLowerCase() : s;
}

/**
 * True when `value` is a canonical 36-character hyphenated UUID.
 * @param {unknown} value
 * @returns {boolean}
 */
function isOrderUuid(value) {
  return typeof value === 'string' && ORDER_UUID_RE.test(value);
}

/**
 * Reduce any supported memo representation to a canonical
 * { memoType, candidate } pair. `candidate` is the printable string we test
 * against the UUID format; it is null when there is nothing to test. Never
 * throws.
 * @param {unknown} memo
 * @returns {{ memoType: 'text'|'id'|'hash'|'none'|'unknown', candidate: string|null }}
 */
function normalizeMemo(memo) {
  if (memo === null || memo === undefined) return { memoType: 'none', candidate: null };

  // Shorthand forms: a bare string / byte blob is MemoText, a bare integer
  // is MemoId. Keeps call sites terse without an explicit wrapper.
  if (typeof memo === 'string' || Buffer.isBuffer(memo) || memo instanceof Uint8Array) {
    return { memoType: 'text', candidate: sanitizeMemoText(memo) };
  }
  if (typeof memo === 'number' || typeof memo === 'bigint') {
    return { memoType: 'id', candidate: sanitizeMemoText(memo) };
  }
  if (typeof memo !== 'object') return { memoType: 'unknown', candidate: null };

  switch (canonicalMemoType(memo.type)) {
    case 'text':
      return { memoType: 'text', candidate: sanitizeMemoText(memo.value) };
    case 'id':
      return { memoType: 'id', candidate: sanitizeMemoText(memo.value) };
    case 'hash':
      return { memoType: 'hash', candidate: sanitizeMemoHash(memo.value) };
    case 'none':
      return { memoType: 'none', candidate: null };
    default:
      return { memoType: 'unknown', candidate: null };
  }
}

/** Default warning sink. Callers may inject their own logger. @param {string} message */
function defaultMemoWarn(message) {
  console.warn(message);
}

/**
 * Validate and sanitize a payment memo, returning the order id it carries
 * when — and only when — it is a well-formed 36-character hyphenated UUID.
 *
 * Returns one of:
 *   { ok: true,  memoType, orderId }                  — usable order id
 *   { ok: false, kind: 'none' }                       — no memo present
 *   { ok: false, kind: 'unrecognized_memo_type' }     — type we don't handle
 *   { ok: false, kind: 'invalid_order_id', memoType } — not a UUID
 *
 * Unrecognized / malformed memos are logged as a warning and reported as a
 * structured failure — the parser never throws on hostile input.
 *
 * @param {unknown} memo
 * @param {(message: string) => void} [log]
 * @returns {{ ok: true, memoType: string, orderId: string }
 *   | { ok: false, kind: string, memoType?: string }}
 */
function parsePaymentMemo(memo, log = defaultMemoWarn) {
  try {
    const { memoType, candidate } = normalizeMemo(memo);
    if (memoType === 'none') return { ok: false, kind: 'none' };
    if (memoType === 'unknown') {
      log('[stellar] unrecognized payment memo type — ignoring');
      return { ok: false, kind: 'unrecognized_memo_type' };
    }
    if (!isOrderUuid(candidate)) {
      log(`[stellar] payment memo (${memoType}) is not a valid order UUID — ignoring`);
      return { ok: false, kind: 'invalid_order_id', memoType };
    }
    // Canonical db form is lowercase (uuid v4), so normalize case here to
    // keep equality matching against `orders.id` robust.
    return { ok: true, memoType, orderId: candidate.toLowerCase() };
  } catch (err) {
    // Belt and braces: a memo value with a hostile toString / getter must
    // not take the parser down. Surface it as a warning and carry on.
    let detail;
    try {
      detail = err instanceof Error ? err.message : String(err);
    } catch {
      detail = '<unstringifiable memo error>';
    }
    log(`[stellar] failed to parse payment memo: ${detail}`);
    return { ok: false, kind: 'invalid_order_id', memoType: 'unknown' };
  }
}

module.exports = {
  parsePaymentEvent,
  stroopsToDecimal,
  parsePaymentMemo,
  sanitizeMemoText,
  isOrderUuid,
  normalizeMemo,
};
