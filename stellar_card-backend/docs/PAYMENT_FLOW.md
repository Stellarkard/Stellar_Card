# Payment Handler Flow Documentation

## Overview

The payment handler is responsible for processing on-chain payments from agents' Stellar wallets to the Stellar_Card receiver contract. It validates payments, claims orders, fulfills virtual credit card requests, and handles reconciliation for failed or ambiguous transactions.

This document describes the complete flow, error scenarios, and recovery mechanisms.

## Architecture

```
Agent Wallet          Receiver Contract      Payment Handler       VCC Service       Treasury
    │                      │                      │                    │               │
    ├─ pay_usdc/xlm ──────►│                      │                    │               │
    │                      ├─ emit event ────────►│                    │               │
    │                      │                      ├─ validate ─────────┤               │
    │                      │                      ├─ claim order ──────┤               │
    │                      │                      ├─ fulfill VCC ──────┤──────────────►│
    │                      │                      │◄─ card details ────┤               │
    │                      │◄─ refund (failed) ───┤                    │               │
```

## Payment Processing Flow

### Step 1: On-Chain Event Reception

**Trigger**: Agent calls `pay_usdc()` or `pay_xlm()` on the receiver contract

**Event Emitted**:
```
Topic: ['pay_usdc' | 'pay_xlm', order_id, from_address]
Data: amount (stroops)
```

The Stellar watcher (`src/payments/stellar.js`) monitors the contract for payment events and invokes `handlePayment()` for each event.

### Step 2: Payment Validation

The handler performs four layers of validation:

#### 2a. Order Lookup
- Query `orders` table for the order_id from the event
- **F7 Failure**: Unknown order_id → Record to `unmatched_payments` with reason `'unknown_order'`
- **F7 Failure**: Order exists but status ≠ `'pending_payment'` → Record as `'order_status_<status>'`

Possible statuses:
- `pending_payment` → Ready to accept payment (✓)
- `ordering` → Already claimed by another event
- `fulfilled` → VCC delivered
- `failed` → Order failed and refunded
- `expired` → Order timeout passed

#### 2b. Amount Validation (F0: Treasury Loss Prevention)

Adversarial audit finding: Without amount validation, a $0.01 payment against a $100 order would cause the system to spend $100 treasury to fulfill it.

**USDC Branch**:
```javascript
if (paymentAsset === 'usdc_soroban') {
  const expected = order.amount_usdc;
  const expectedStroops = parseStrictPositiveStroops(expected);
  
  // F2: Validate order.amount_usdc strictly
  if (expectedStroops === null) {
    // Corrupt amount_usdc (empty, NaN, etc.)
    recordUnmatchedPayment(reason: 'corrupt_order');
    return;
  }
  
  const cmp = compareDecimal(amountUsdc, expected);
  if (cmp < 0) {
    // Underpayment: Treasury loss vector
    recordUnmatchedPayment(reason: 'underpaid_usdc');
    return;
  }
  if (cmp > 0) {
    // Overpayment: Normal (rounding), track excess for refund bookkeeping
    excessUsdc = overpayment_amount;
    logger.event('payment.usdc_overpaid', {...});
  }
}
```

**XLM Branch**:
```javascript
if (paymentAsset === 'xlm_soroban') {
  const expected = order.expected_xlm_amount;
  
  if (!expected) {
    // XLM not quoted (oracle unavailable during order creation)
    recordUnmatchedPayment(reason: 'xlm_not_quoted');
    return;
  }
  
  const cmp = compareDecimal(amountXlm, expected);
  if (cmp < 0) {
    // Underpayment
    recordUnmatchedPayment(reason: 'underpaid_xlm');
    return;
  }
  if (cmp > 0) {
    // Overpayment (symmetric with USDC)
    excessXlm = overpayment_amount;
    logger.event('payment.xlm_overpaid', {...});
  }
}
```

#### 2c. Atomic Order Claim

Prevents race conditions where two payment events for the same order arrive concurrently:

```sql
UPDATE orders
SET status = 'ordering', payment_asset = ?, stellar_txid = ?,
    sender_address = ?, payment_xlm_amount = ?,
    excess_usdc = COALESCE(?, excess_usdc),
    updated_at = ?
WHERE id = ? AND status = 'pending_payment'
```

**Outcome**:
- `changes === 1`: Claimed successfully → Continue to step 3 (fulfillment)
- `changes === 0`: Lost race → Record as `'duplicate_payment'`

### Step 3: VCC Fulfillment

Once the order is claimed and payment is validated, initiate VCC fulfillment.

#### 3a. Get Invoice

```javascript
const { vccJobId, paymentUrl, callbackNonce } = await getInvoice(
  orderId,
  order.amount_usdc,
  order.request_id
);
```

Returns:
- `vccJobId`: Unique identifier for this fulfillment job
- `paymentUrl`: Stellar payment URI for paying the CTX invoice
- `callbackNonce`: Secret for webhook authentication

#### 3b. Execute CTX Payment (F1: Ambiguous Outcome Handling)

Adversarial audit F1 identified an issue: if the CTX payment is submitted but the response is lost, marking it as failed and auto-refunding would spend treasury twice:

1. Refund to agent
2. CTX already received payment

**Solution**: Distinguish ambiguous outcomes from definitive failures.

```javascript
try {
  ctxTxHash = await xlmSender.payCtxOrder(paymentUrl, {
    paymentAsset,
    maxUsdc: order.amount_usdc,
  });
} catch (payErr) {
  const status = payErr?.stellarStatus;      // 'unknown', 'applied_failed', etc.
  const txHash = payErr?.txHash;             // Pre-computed before response loss

  if ((status === 'unknown' || status === 'applied_failed') && txHash) {
    // Ambiguous: CTX payment MAY have landed
    db.prepare(
      `UPDATE orders SET status = 'failed', error = ?, ctx_stellar_txid = ?, ...`
    ).run(publicMessage('ctx_payment_ambiguous'), txHash, ...);
    
    logger.event('ctx.payment_ambiguous', { stellar_status: status, tx_hash: txHash, ... });
    console.error(`[payment] order AMBIGUOUS [${status}] hash=${txHash} — parked, NO auto-refund`);
    
    // Operators verify on-chain via ctx_stellar_txid and either:
    // 1. Unpark for retry (if not landed)
    // 2. Manually refund (if landed)
    return;
  }
  
  // Non-ambiguous failure: fall through to outer catch for auto-refund
  throw payErr;
}
```

#### 3c. Notify VCC

```javascript
await notifyPaid(vccJobId);
```

Tells VCC to deliver the card credentials.

#### 3d. Update Order Status

```sql
UPDATE orders SET vcc_notified_at = ?, updated_at = ? WHERE id = ?
```

Order is now complete.

### Step 4: Error Handling

If any step fails, the order is marked `failed` and a refund is scheduled:

```javascript
catch (err) {
  const safeMessage = safeErrorMessage(err);  // F1: Defensive message extraction
  
  db.prepare(
    `UPDATE orders SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
  ).run(publicMessage(safeMessage), new Date().toISOString(), orderId);
  
  refundOrQuarantine(orderId, publicMessage(safeMessage)).catch(...);
}
```

**F3: Refund-or-Quarantine Logic**: If `ctx_stellar_txid` is set (meaning CTX payment succeeded but a later step failed), `refundOrQuarantine` detects this and quarantines instead of refunding, preventing double-spend.

## Error Scenarios

### F7: Unmatched Payments

Payments that don't match a valid pending order are recorded to `unmatched_payments` table for ops to investigate and refund.

**Common Reasons**:

| Reason | Cause | Action |
|--------|-------|--------|
| `unknown_order` | order_id doesn't exist in DB | Check order was created |
| `order_status_*` | Order already claimed, fulfilled, or failed | Check order history |
| `corrupt_order` | order.amount_usdc is empty/NaN/invalid | Data migration issue |
| `underpaid_usdc` | Paid amount < expected amount | Agent error or adversarial |
| `underpaid_xlm` | Paid amount < expected XLM | Agent error or adversarial |
| `xlm_not_quoted` | XLM not available during order creation | Price oracle was down |
| `unknown_asset` | Asset is neither USDC nor XLM | Contract emit error |
| `duplicate_payment` | Order already claimed by another event | Race condition (rare) |

**Operator Response**:
- Check `unmatched_payments` table regularly
- Verify order exists and query its status
- For genuine agent errors: refund manually via `refund_unmatched_payment` procedure
- For suspicious activity: escalate to security team

### F1: Ambiguous Payment Outcomes

When submitting a payment to CTX, the following outcomes are possible:

| Outcome | Action |
|---------|--------|
| **Success** | Response received, txid confirmed | Continue |
| **Definite failure** | Response received, payment failed | Refund automatically |
| **Ambiguous** | Response lost, but pre-computed txid available | Park order, ops verify on-chain |

The handler stores the pre-computed `txHash` before submitting to defend against response loss:

```javascript
let ctxTxHash = null;
try {
  ctxTxHash = await xlmSender.payCtxOrder(...);  // Computes hash internally
} catch (payErr) {
  const txHash = payErr?.txHash;  // Pre-computed before submit
  
  if (payErr?.stellarStatus === 'unknown' && txHash) {
    // Park and alert ops
  }
}
```

### F2: Corrupt Order Amount

If `order.amount_usdc` is not a valid positive decimal string (e.g., empty, NaN, negative, or garbage), the order is treated as corrupt and the incoming payment is quarantined instead of claimed.

**Example**:
```sql
-- Corrupt order (empty amount_usdc)
INSERT INTO orders (id, ..., amount_usdc) VALUES ('order123', ..., '');

-- Agent pays $100, but order amount is corrupt
-- Handler rejects it and records to unmatched_payments
-- Order stays in pending_payment for ops to investigate
```

**Handling**:
1. Fix the corrupt row in the database
2. Create a new order for the agent or refund manually
3. Delete from `unmatched_payments` once handled

## Reconciliation

### Jobs Reconciler (`src/jobs.js`)

Runs periodically (default: every 5 minutes) to find stuck orders and recover from crashes:

```javascript
-- Find orders stuck in 'ordering' with no vcc_job_id
SELECT * FROM orders
WHERE status = 'ordering'
  AND vcc_job_id IS NULL
  AND updated_at < NOW() - INTERVAL '5 minutes'
```

**Action**: Retry or refund based on error pattern.

### Unmatched Payments Reconciler

Ops review `unmatched_payments` table and manually refund or escalate.

### Refund Tracking

- **Excess USDC**: Tracked in `orders.excess_usdc` for refund bookkeeping
- **Excess XLM**: Logged to bizEvent stream (schema doesn't track yet)
- **Refunds**: Executed via scheduled jobs or manual approval

## State Machine

```
Order Created
  │
  ├─ pending_payment ─────────────────┐
  │                                   │
  │ (payment event received)          │
  │                                   ▼
  │                          unknown_order?
  │                          invalid_amount?
  │                          duplicate_payment?
  │                                   │
  │                                   ├─ YES ─► unmatched_payments
  │                                   │
  │                                   ├─ NO
  │                                   │
  │                                   ▼
  │                              ordering
  │                                   │
  │                                   ├─► getInvoice()
  │                                   │
  │                                   ├─► payCtxOrder()
  │                                   │    │
  │                                   │    ├─► Success
  │                                   │    │    │
  │                                   │    │    ├─► notifyPaid()
  │                                   │    │    │
  │                                   │    │    ├─► fulfilled ◄─────┐
  │                                   │    │                        │
  │                                   │    ├─► Ambiguous           │
  │                                   │    │    │                  │
  │                                   │    │    ├─► failed (parked) │
  │                                   │    │    │    (ops verify)   │
  │                                   │    │                        │
  │                                   │    ├─► Definite Failure     │
  │                                   │         │                   │
  │                                   │         ├─► failed ─────────┤
  │                                   │         │                   │
  │                                   │         ├─► scheduled_refund
  │                                   │
  └────────────────────────────────────────────────────────────────►fulfilled
```

## Testing

### Unit Tests

Located in `test/unit/payment-handler.test.js`:
- Payment validation edge cases
- Amount comparison precision
- Error message safety
- Order state transitions

### Integration Tests

Located in `test/integration/`:
- `orders.test.js` - Full order lifecycle
- `vcc-callback.test.js` - VCC webhook handling
- `jobs.test.js` - Reconciliation and retry logic

### Manual Testing

```bash
# Test payment validation (amount comparison)
npm test test/unit/payment-handler.test.js

# Test full order lifecycle
npm test test/integration/orders.test.js
```

## Performance Considerations

- **Database queries**: All indexed on order_id for <1ms latency
- **Amount comparison**: Uses BigInt, no float rounding errors
- **Event processing**: Async, non-blocking
- **Refund scheduling**: Deferred to background job queue
- **Rate limiting**: Applied at API boundary, not in payment handler

## Monitoring and Alerts

### Key Metrics

- Payment event latency: <100ms p95
- Order state transitions: 5-10s (dependent on VCC response time)
- Unmatched payment rate: Should be <0.1%
- Reconciliation success rate: Should be 100% (failures indicate bugs)

### Alert Thresholds

- High unmatched payment rate (>0.5%) → Investigate
- Stuck orders in 'ordering' state (>5 min) → Check VCC service
- Reconciliation failures → Check database connectivity
- Corrupt order amounts detected → Data integrity issue

## References

- [Stellar Payment Events](https://developers.stellar.org/docs/learn/concepts/events)
- [Soroban Contract Events](https://developers.stellar.org/docs/learn/soroban/rust-contract-fundamentals/events)
- [VCC API Documentation](./VCC_API.md)
- [Reconciliation Guide](./RECONCILIATION.md)
