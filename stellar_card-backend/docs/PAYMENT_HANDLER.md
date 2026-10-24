# `payment-handler.js` — Flow Documentation

> **File**: [payment-handler.js](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/payment-handler.js)
> **Last reviewed**: 2026-07-28
> **Audit baseline**: 2026-04-15 adversarial audit (findings F0–F3)

---

## Purpose

[payment-handler.js](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/payment-handler.js) is the core orchestration module that processes confirmed on-chain payments from agents. It was factored out of `index.js` specifically so that integration tests can exercise the full pipeline (`getInvoice → payCtxOrder → notifyPaid`) without needing to boot the Express server or the Stellar event watcher.

The module is invoked by [stellar.js](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/payments/stellar.js) every time a `pay_usdc` or `pay_xlm` event is seen on the receiver contract. Its job is to:

1. **Validate** the incoming payment against the stored order.
2. **Claim** the order atomically to guard against duplicate events.
3. **Fulfill** the virtual credit card (VCC) via three sequenced external calls.
4. **Persist checkpoints** after each step so the `jobs.js` reconciler can recover from mid-flight crashes without double-paying.
5. **Route failures** to either `unmatched_payments` (pre-claim) or `refundOrQuarantine` (post-claim).

---

## Module Graph

```
stellar.js (event watcher)
    │
    └─► handlePayment()              ← payment-handler.js
            │
            ├─► db                   ← ./db (better-sqlite3)
            ├─► getInvoice()         ← ./vcc-client
            ├─► xlmSender.payCtxOrder() ← ./payments/xlm-sender  (module object — see §Imports)
            ├─► notifyPaid()         ← ./vcc-client
            ├─► refundOrQuarantine() ← ./fulfillment
            ├─► logger.event()       ← ./lib/logger               (module object — see §Imports)
            └─► publicMessage()      ← ./lib/sanitize-error
```

---

## Imports and Monkey-Patch Pattern

Two dependencies are imported as module objects rather than via destructuring:

```js
const xlmSender = require('./payments/xlm-sender');
const logger    = require('./lib/logger');
```

**Why**: Destructuring (`const { payCtxOrder } = require(...)`) captures the function reference at load time. Tests need to replace `xlmSender.payCtxOrder` at runtime. If the module captures a local copy of the function at load time, the test's replacement has no effect. Importing the full module object means every call site goes through the object, so runtime reassignment works. The same pattern is used in `jobs.js` and `middleware/requireCardReveal.js`.

---

## Helper Functions

### `toStroops(s)`

Converts a decimal string to a `BigInt` in Stellar's stroop precision (7 decimal places = 10,000,000 stroops per unit).

| Input | Output |
|-------|--------|
| `'10.00'` | `100_000_000n` |
| `'0.0000001'` | `1n` |
| `null` / `undefined` / `''` | `0n` |
| `'-5'` | `-50_000_000n` |

**Precision guarantee**: By working in `BigInt` this function never passes amounts through JavaScript `Number` floats, eliminating the `0.1 + 0.2 ≠ 0.3` class of rounding errors that would be catastrophic for financial comparisons.

**Implementation note**: `frac` is padded to exactly 7 characters using `(frac + '0000000').slice(0, 7)` — any fractional part longer than 7 digits is truncated (Stellar does not support sub-stroop precision).

---

### `compareDecimal(a, b)`

A classic three-way comparator (returns `1`, `-1`, or `0`) operating on decimal strings. Delegates to `toStroops` for precision. Treats `null`/`undefined` as `0`.

Used by `handlePayment` to compare the **on-chain amount** against the **order's quoted amount** without floating-point loss.

---

### `parseStrictPositiveStroops(s)` — Audit Finding F2

Returns the `BigInt` stroop value of `s` if and only if `s` is a non-empty string, passes `/^\d+(\.\d+)?$/` (no sign, no scientific notation, no garbage), and converts to a value strictly greater than zero. Returns `null` for everything else.

**Why this guard exists**: Before this function was added (2026-04-15 audit), `toStroops('')` returned `0n`. Any positive on-chain amount compared against `0n` was treated as an "overpayment of zero" — meaning a `$0.01` payment against a `$100` order would claim the order and trigger $100 of treasury spend. Any order row with a corrupt, empty, or manually-mangled `amount_usdc` column was a silent treasury drain vector.

**Fail-closed design**: A `null` return from this function causes `handlePayment` to route the incoming payment to `unmatched_payments` with `reason: 'corrupt_order'` and return immediately, leaving the order in `pending_payment` so ops can investigate. The order is **never** claimed.

Edge cases explicitly rejected:

| Value | Reason |
|-------|--------|
| `''` | Empty |
| `'   '` | Whitespace-only |
| `null` / `undefined` | Null check |
| `10` (number) | Not a string |
| `'0'` / `'0.0000000'` | Zero — the exact pre-fix exploit value |
| `'-1'` | Negative |
| `'1e5'` | Scientific notation |
| `'NaN'` / `'Infinity'` | Non-numeric |
| `'+1'` | Explicit sign |
| `'1.2.3'` | Multiple dots |

---

### `stroopsToDecimal(stroops)`

Inverse of `toStroops`. Converts a `BigInt` stroop value back to a 7-decimal-place string representation (e.g., `15_000_000n → '1.5000000'`). Used to compute `excessUsdc` / `excessXlm` for logging and database persistence.

---

### `safeErrorMessage(err)` — Audit Finding F1

Safe extraction of a human-readable string from any thrown value, including `null`, `undefined`, plain strings, numbers, and `Error` instances whose `.message` getter itself throws.

**Why this guard exists**: The outer fulfillment `catch` block used to read `err.message` directly. A non-Error thrown value (e.g., `throw null`) would cause `null.message` to throw inside the catch handler itself — leaving the order wedged in `ordering` status with no refund scheduled and no error persisted, until the `jobs.js` reconciler picked it up minutes later.

The same helper exists independently in `lib/retry.js::safeErrorMessage`.

---

### `recordUnmatchedPayment(row)`

Writes a row to the `unmatched_payments` table and emits a `payment.unmatched` business event. Every row represents **real funds** sitting in the receiver contract that ops must eventually refund or quarantine.

The function is wrapped in its own `try/catch` so a database failure here does not swallow the original caller's return path. On failure it logs to `console.error` — the watcher's txid deduplication in `index.js` guards against double-processing on the happy path.

**Schema columns written**:

| Column | Source |
|--------|--------|
| `id` | `uuidv4()` |
| `stellar_txid` | `txid` parameter |
| `sender_address` | `senderAddress` parameter |
| `payment_asset` | `paymentAsset` parameter |
| `amount_usdc` | `amountUsdc` parameter |
| `amount_xlm` | `amountXlm` parameter |
| `claimed_order_id` | `orderId` parameter |
| `reason` | one of the reason codes below |

---

## `handlePayment` — Main Flow

```
handlePayment({ txid, paymentAsset, amountUsdc, amountXlm, senderAddress, orderId })
```

### Phase 1 — Order Validation

#### 1a. Order Lookup (F7)

```js
const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
```

If `order` is `null` (unknown `order_id`):
→ `recordUnmatchedPayment({ reason: 'unknown_order' })` and `return`.

If `order.status !== 'pending_payment'`:
→ `recordUnmatchedPayment({ reason: 'order_status_<status>' })` and `return`.

This catches orders that have already transitioned (duplicate events, concurrent `pay_usdc` + `pay_xlm`, expired orders where the chain caught up late, etc.).

**Possible order statuses at this check**:

| Status | Meaning |
|--------|---------|
| `pending_payment` | ✅ Ready for payment |
| `ordering` | Already claimed by a prior event |
| `fulfilled` | VCC delivered |
| `failed` | Previously failed and refund scheduled |
| `expired` | Order timeout elapsed before payment |

#### 1b. Amount Validation (F0 — Treasury Loss Prevention)

This is the most security-critical check. Without it a `$0.01` on-chain payment against a `$100` order would pass through and cause the backend to spend `$100` of treasury.

**USDC branch** (`paymentAsset === 'usdc_soroban'`):

1. Read `order.amount_usdc`.
2. Call `parseStrictPositiveStroops(order.amount_usdc)` — if `null`:
   - Emit `payment.corrupt_order_amount` event.
   - `recordUnmatchedPayment({ reason: 'corrupt_order' })` and `return`.
3. `compareDecimal(amountUsdc, order.amount_usdc)`:
   - `< 0` (underpayment): `recordUnmatchedPayment({ reason: 'underpaid_usdc' })` and `return`.
   - `> 0` (overpayment): compute `excessUsdc = stroopsToDecimal(paid - expected)`, emit `payment.usdc_overpaid` (F3). **Order proceeds.**
   - `=== 0` (exact match): proceed normally.

**XLM branch** (`paymentAsset === 'xlm_soroban'`):

1. Read `order.expected_xlm_amount`.
2. If falsy (XLM was not quoted — price oracle was unavailable when the order was created):
   - `recordUnmatchedPayment({ reason: 'xlm_not_quoted' })` and `return`.
3. `compareDecimal(amountXlm, order.expected_xlm_amount)`:
   - `< 0`: `recordUnmatchedPayment({ reason: 'underpaid_xlm' })` and `return`.
   - `> 0`: compute `excessXlm`, emit `payment.xlm_overpaid`. **Order proceeds.**
   - `=== 0`: proceed normally.

**Unknown asset** (neither `usdc_soroban` nor `xlm_soroban`):
→ `recordUnmatchedPayment({ reason: 'unknown_asset' })` and `return`.

> **Note on XLM excess tracking**: `excessXlm` is logged to the business event stream but **not** persisted to `orders.excess_xlm` (that column does not exist yet in the schema). XLM refund bookkeeping is out of scope for F0. `excessUsdc` is persisted via `COALESCE(?, excess_usdc)` in the atomic claim UPDATE.

---

### Phase 2 — Atomic Order Claim

```sql
UPDATE orders
SET status = 'ordering', payment_asset = ?, stellar_txid = ?,
    sender_address = ?, payment_xlm_amount = ?,
    excess_usdc = COALESCE(?, excess_usdc),
    updated_at = ?
WHERE id = ? AND status = 'pending_payment'
```

The `WHERE … AND status = 'pending_payment'` predicate is the race guard. If two `pay_usdc` events arrive simultaneously for the same order, only the first UPDATE will match the row (SQLite serialises writes). The second will find `claimed.changes === 0`:

```js
if (claimed.changes === 0) {
  recordUnmatchedPayment({ reason: 'duplicate_payment' });
  return;
}
```

At this point the order row carries:
- `status = 'ordering'`
- `payment_asset`, `stellar_txid`, `sender_address`, `payment_xlm_amount`
- `excess_usdc` (if overpaid)

---

### Phase 3 — VCC Fulfillment

All three sub-steps are wrapped in a single `try/catch`. Each successful step is immediately checkpointed to the database so the `jobs.js` reconciler can recover from mid-flight crashes without double-paying.

#### 3a. `getInvoice(orderId, order.amount_usdc, order.request_id)`

Returns `{ vccJobId, paymentUrl, callbackNonce }`.

Additionally, two non-critical telemetry items are extracted after this step:

- **`ctxInvoiceXlm`**: Parses the XLM amount out of `paymentUrl` using `xlmSender.parseStellarPayUri`. Used by the margin tracking dashboard to show cost-of-sale.
- **`settlementRate`**: Fetches the current XLM/USD spot price via `payments/xlm-price.getXlmUsdPrice()`. Used so the dashboard can compute cost-of-sale in USD without a retrospective oracle call.

Both are non-critical — if parsing or the price oracle fails, the order still proceeds and the dashboard shows "no data" for that row.

**Checkpoint written**:
```sql
UPDATE orders SET vcc_job_id = ?, callback_nonce = ?,
  ctx_invoice_xlm = ?, settlement_xlm_usd_rate = ?, updated_at = ?
WHERE id = ?
```

#### 3b. `xlmSender.payCtxOrder(paymentUrl, { paymentAsset, maxUsdc })` — Audit Finding F1 (jobs)

Sends the CTX payment on-chain via Stellar. The payment type branches on what the agent paid:

| Agent payment | CTX payment mechanism |
|---------------|----------------------|
| XLM | Single-op plain Payment from treasury |
| USDC | Two-op atomic tx: PathPaymentStrictSend (USDC → XLM into treasury) + plain Payment (XLM to CTX). The split was forced by the 2026-04-14 bug where CTX's payment watcher ignores `path_payment_*` ops. |

**Ambiguous outcome handling** (the key adversarial finding):

If `payCtxOrder` throws, the thrown error may carry `.stellarStatus` and `.txHash` annotations set by `xlm-sender` before the submission:

```js
catch (payErr) {
  const status  = payErr?.stellarStatus;  // 'unknown' | 'applied_failed' | ...
  const txHash  = payErr?.txHash;         // pre-computed before response was lost

  if ((status === 'unknown' || status === 'applied_failed') && txHash) {
    // PARK — do NOT auto-refund. CTX payment MAY have landed.
    db.prepare(`UPDATE orders SET status = 'failed', error = ?,
                ctx_stellar_txid = ?, updated_at = ? WHERE id = ?`)
      .run(publicMessage('ctx_payment_ambiguous'), txHash, now, orderId);
    logger.event('ctx.payment_ambiguous', { stellar_status, tx_hash, ... });
    return;  // ← no refundOrQuarantine call
  }
  throw payErr;  // non-ambiguous: fall through to outer catch
}
```

**Why**: If CTX payment was submitted and the response was lost in transit, the tx may have landed. Auto-refunding would spend treasury twice — once to CTX (maybe) and once back to the agent (definitely). The order is parked with `status = 'failed'` and the pre-computed `ctx_stellar_txid` for operators to verify on-chain. Operators either un-park for retry (if not landed) or manually refund (if landed).

**Checkpoint written** (on success):
```sql
UPDATE orders SET xlm_sent_at = ?, ctx_stellar_txid = ?, updated_at = ? WHERE id = ?
```

#### 3c. `notifyPaid(vccJobId)`

Tells the VCC service to deliver the card credentials to the agent's webhook. This is a fire-and-confirm call — if it throws, the outer `catch` handles it.

**Checkpoint written** (on success):
```sql
UPDATE orders SET vcc_notified_at = ?, updated_at = ? WHERE id = ?
```

---

### Phase 4 — Error Handling (Outer `catch`)

```js
catch (err) {
  const rawMessage    = safeErrorMessage(err);         // F1: never crashes
  const safePublicMsg = publicMessage(rawMessage);     // sanitize for agent-visibility

  db.prepare(`UPDATE orders SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
    .run(safePublicMsg, now, orderId);

  refundOrQuarantine(orderId, safePublicMsg).catch(...);
}
```

**`refundOrQuarantine` routing**: This function (in `fulfillment.js`) checks whether `orders.ctx_stellar_txid` is set on the row before issuing a refund. If `ctx_stellar_txid` is non-null (meaning checkpoint 3b succeeded but 3c threw), the CTX payment has already landed, so a refund would orphan the gift card. In that case it quarantines the order for operator review instead.

---

## Unmatched Payment Reason Codes

| Reason | Trigger | Notes |
|--------|---------|-------|
| `unknown_order` | `orderId` not in `orders` table | Chain event for an order never created |
| `order_status_<status>` | Order exists but `status ≠ 'pending_payment'` | Duplicate event or expired order |
| `corrupt_order` | `order.amount_usdc` fails strict parse | Data integrity issue; order left in `pending_payment` |
| `underpaid_usdc` | USDC on-chain amount < `order.amount_usdc` | Adversarial or agent SDK bug |
| `underpaid_xlm` | XLM on-chain amount < `order.expected_xlm_amount` | Adversarial or agent SDK bug |
| `xlm_not_quoted` | `order.expected_xlm_amount` is falsy | XLM oracle was down at order creation |
| `unknown_asset` | `paymentAsset` is neither `usdc_soroban` nor `xlm_soroban` | Contract emit error |
| `duplicate_payment` | Atomic UPDATE matched 0 rows | Lost the claim race; second event for same order |

---

## Business Events Emitted

| Event name | When emitted |
|------------|-------------|
| `payment.unmatched` | Any path through `recordUnmatchedPayment` |
| `payment.corrupt_order_amount` | `order.amount_usdc` fails strict parse |
| `payment.usdc_overpaid` | Agent paid more USDC than quoted (F3) |
| `payment.xlm_overpaid` | Agent paid more XLM than quoted |
| `ctx.payment_ambiguous` | CTX tx submitted but outcome unknown |

All events are emitted via `logger.event()` which writes a JSON line to stdout and pushes to the in-process event bus for SSE dashboard consumers.

---

## Order State Machine

```
                        ┌──────────────────────────────────┐
                        │      on-chain event received      │
                        └─────────────┬────────────────────┘
                                      │
                          ┌───────────▼───────────┐
                          │   validation checks    │
                          └──┬──────────────────┬─┘
                             │ FAIL             │ PASS
                             ▼                  ▼
                    unmatched_payments     ┌──────────┐
                    (any reason code)      │ ordering │  ← atomic claim
                                          └────┬─────┘
                                               │
                              ┌────────────────┼───────────────────┐
                              │                │                   │
                         getInvoice()    payCtxOrder()        notifyPaid()
                         checkpoint      checkpoint           checkpoint
                              │                │                   │
                              │           ┌────┴────┐              │
                              │      ambiguous?  failure?          │
                              │           │         │              │
                              │     failed(parked) failed──────►refund
                              │     (no refund)   or quarantine
                              │
                           ◄──┴─── all steps succeeded ───────────►
                                                                fulfilled
```

---

## Checkpoint Persistence Model

The three VCC steps write to the database immediately upon success, before the next step begins:

| Checkpoint | Columns written | Reconciler uses |
|------------|-----------------|-----------------|
| After `getInvoice` | `vcc_job_id`, `callback_nonce`, `ctx_invoice_xlm`, `settlement_xlm_usd_rate` | `vcc_job_id IS NULL` to detect pre-invoice crash |
| After `payCtxOrder` | `xlm_sent_at`, `ctx_stellar_txid` | `ctx_stellar_txid IS NOT NULL` to detect pre-notify crash |
| After `notifyPaid` | `vcc_notified_at` | `vcc_notified_at IS NOT NULL` = fully complete |

If the process crashes between steps, `jobs.js` scans `status = 'ordering'` rows and resumes from the last checkpoint rather than restarting from scratch — protecting against double CTX payment.

---

## Security Properties

| Threat | Mitigation |
|--------|-----------|
| Treasury loss via underpayment (F0) | `compareDecimal` with BigInt arithmetic; underpaid → `unmatched_payments` |
| Treasury loss via corrupt `amount_usdc` (F2) | `parseStrictPositiveStroops` strict guard; `null` result → `unmatched_payments` |
| Double-spend via ambiguous CTX tx (F1-jobs) | Park + store `ctx_stellar_txid`; no auto-refund until ops verifies |
| Double-claim via duplicate events | Atomic `WHERE … AND status = 'pending_payment'` UPDATE |
| Crash handler wedging order in `ordering` (F1) | `safeErrorMessage` never throws; outer `catch` always executes cleanup |
| Internal vocabulary leakage to agents | `publicMessage()` from `lib/sanitize-error` maps raw errors to stable codes |
| Uncloneable / circular field shapes in logger | `logger.event()` uses `safeStringify` + `structuredClone` with try/catch fallthrough |

---

## Integration Points

| Module | Role |
|--------|------|
| `src/payments/stellar.js` | Event watcher — calls `handlePayment` for each contract event |
| `src/db.js` | SQLite database — all reads/writes go through this module |
| `src/vcc-client.js` | `getInvoice`, `notifyPaid` — VCC service calls |
| `src/payments/xlm-sender.js` | `payCtxOrder`, `parseStellarPayUri` — on-chain payment submission |
| `src/payments/xlm-price.js` | `getXlmUsdPrice` — non-critical telemetry oracle |
| `src/fulfillment.js` | `refundOrQuarantine` — post-failure cleanup |
| `src/lib/logger.js` | `event()` — business event emission and SSE bus |
| `src/lib/sanitize-error.js` | `publicMessage()` — agent-safe error codes |
| `src/jobs.js` | Reconciler — resumes stuck `ordering` orders from checkpoints |

---

## Test Coverage

### Unit Tests (`test/unit/payment-handler.test.js`)

| Suite | What is covered |
|-------|----------------|
| `F1-payment-handler: safeErrorMessage` | All thrown-value shapes: `Error`, plain string, `null`, `undefined`, number, getter-throwing Error, un-stringifiable object |
| `F2-payment-handler: parseStrictPositiveStroops` | Full acceptance/rejection matrix including the `'0'` treasury-drain case |
| `F2-payment-handler: corrupt order.amount_usdc is fail-closed` | DB-backed end-to-end: corrupt rows leave order in `pending_payment`, appear in `unmatched_payments` with `reason = 'corrupt_order'`; valid rows do claim |
| `F3-payment-handler: usdc_overpaid bizEvent` | Overpayment emits `payment.usdc_overpaid` with correct fields; exact match does not |

### Integration Tests (`test/integration/`)

- `orders.test.js` — full order lifecycle including the payment → fulfill → webhook path
- `vcc-callback.test.js` — VCC webhook callback handling
- `jobs.test.js` — reconciliation and retry logic for stuck orders

### E2E

- `test-e2e-v2.js` / `test-batch-e2e.js` — full pipeline from Stellar event emission through card delivery

---

## Operator Runbook

### Investigating `unmatched_payments`

```sql
-- List recent unmatched payments
SELECT * FROM unmatched_payments
ORDER BY created_at DESC LIMIT 50;

-- Find the corresponding order (if any)
SELECT * FROM orders WHERE id = '<claimed_order_id>';

-- Mark as handled after manual refund
DELETE FROM unmatched_payments WHERE id = '<row_id>';
```

### Investigating Parked Orders (Ambiguous CTX Payment)

```sql
-- Find all parked ambiguous orders
SELECT id, status, error, ctx_stellar_txid, updated_at
FROM orders
WHERE status = 'failed'
  AND ctx_stellar_txid IS NOT NULL
  AND error LIKE '%ctx_payment_ambiguous%'
ORDER BY updated_at DESC;
```

1. Use `ctx_stellar_txid` to query the Stellar network (Horizon or Soroban RPC) and confirm whether the tx landed.
2. If **not landed**: reset `status = 'pending_payment'`, clear `ctx_stellar_txid`, and allow the watcher to retry. Or re-run fulfillment manually.
3. If **landed**: the VCC has already received payment. Deliver the card manually or trigger `notifyPaid` directly. Do **not** issue a Stellar refund.

### Investigating Stuck `ordering` Orders

```sql
-- Find orders stuck in 'ordering' with no vcc_job_id (pre-invoice crash)
SELECT id, status, created_at, updated_at
FROM orders
WHERE status = 'ordering'
  AND vcc_job_id IS NULL
  AND updated_at < datetime('now', '-5 minutes');

-- Find orders with invoice but no xlm_sent_at (crashed between invoice and CTX payment)
SELECT id, vcc_job_id, ctx_stellar_txid, xlm_sent_at
FROM orders
WHERE status = 'ordering'
  AND vcc_job_id IS NOT NULL
  AND xlm_sent_at IS NULL;
```

The `jobs.js` reconciler handles these automatically on its next sweep. If the reconciler itself is stuck, check `system_state` for the reconciler heartbeat and restart the backend process.

---

## References

- [Stellar Payment Events — Stellar Docs](https://developers.stellar.org/docs/learn/concepts/events)
- [Soroban Contract Events — Stellar Docs](https://developers.stellar.org/docs/learn/soroban/rust-contract-fundamentals/events)
- [`src/payments/stellar.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/payments/stellar.js) — Event watcher and cursor persistence
- [`src/vcc-client.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/vcc-client.js) — VCC API client with circuit breaker
- [`src/payments/xlm-sender.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/payments/xlm-sender.js) — On-chain payment submission
- [`src/fulfillment.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/fulfillment.js) — Refund, quarantine, and webhook delivery
- [`src/lib/sanitize-error.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/src/lib/sanitize-error.js) — Agent-safe error code mapping
- [`docs/PAYMENT_FLOW.md`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/docs/PAYMENT_FLOW.md) — Higher-level architecture overview
- [`test/unit/payment-handler.test.js`](file:///c:/Users/supre/Documents/Stellar_Card/stellar_card-backend/test/unit/payment-handler.test.js) — Unit test suite
