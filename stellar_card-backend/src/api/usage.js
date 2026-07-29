// @ts-check
// Authenticated read-only agent surface: spend summary and policy
// preview. Mounted at /v1 AFTER the auth chain, so req.apiKey is always
// populated by the time these handlers run.
//
// Both endpoints run aggregate queries over the orders table on every
// request, so they share orderPollLimiter with /v1/orders polling rather
// than getting a looser budget of their own — otherwise a compromised
// key could enumerate the owner's daily spend and bruteforce policy
// thresholds without burning order-creation budget.

const { Router } = require('express');
const { z } = require('zod');
const db = require('../db');
const { validate, patternString } = require('../lib/validate');
const { buildBudget, policyCheck, orderPollLimiter } = require('./orders');

const router = Router();

// ── Request schema ─────────────────────────────────────────────────────────
//
// The same decimal shape POST /v1/orders enforces on amount_usdc, so a
// dry-run preview and the order it previews agree on what a valid amount
// is. The hand-written guard this replaces used
// `isNaN(parseFloat(amount))`, which accepts "10abc" as 10 and
// "10.12345" as sub-cent precision the issuer cannot represent — a
// preview that answers a question the real endpoint would reject.
const AMOUNT_SHAPE = /^\d+(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = 'Query param ?amount= must be a positive number';

const PolicyCheckQuery = z.object({
  amount: patternString(AMOUNT_SHAPE, AMOUNT_MESSAGE, { trim: true }).superRefine((value, ctx) => {
    // Shape and range need separate checks but share one message: the
    // endpoint has always returned a single `invalid_amount` code and
    // clients match on it.
    if (!(parseFloat(String(value)) > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: AMOUNT_MESSAGE });
    }
  }),
});

const validatePolicyCheck = validate({
  query: PolicyCheckQuery,
  errorCodes: { amount: 'invalid_amount' },
});

// GET /v1/usage — agent's own spend and order summary
// Runs COUNT + SUM over orders. Same per-key throttle as the rest of
// the agent read surface.
//
// Adversarial audit (2026-04-15):
//
// F2-usage: in_progress previously used `NOT IN ('delivered','failed',
//   'refunded')` as the complement filter — which incorrectly counted
//   EXPIRED and REJECTED orders (both terminal-negative) as still in
//   progress. An agent with 5 dead expired orders saw "5 orders in
//   progress" when nothing was actually in flight. Now excludes every
//   terminal status from the complement and uses COALESCE so an empty
//   orders table returns 0 instead of null per-bucket.
//
// F3-usage: added explicit expired and rejected counters so agents
//   can see the full picture — previously both were hidden inside the
//   wrong in_progress bucket.
router.get('/usage', orderPollLimiter, (req, res) => {
  const counts = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
      COALESCE(SUM(CASE WHEN status NOT IN ('delivered','failed','refunded','expired','rejected') THEN 1 ELSE 0 END), 0) AS in_progress
    FROM orders WHERE api_key_id = ?
  `,
    )
    .get(req.apiKey.id);
  res.json({
    api_key_id: req.apiKey.id,
    label: req.apiKey.label,
    budget: buildBudget(req.apiKey),
    orders: counts,
  });
});

// GET /v1/policy/check?amount=X — dry-run policy check without creating an order
// Runs a SUM over orders per request, so it needs the same per-key
// throttle as /v1/orders polling. Before this limiter was added, a
// compromised key could enumerate the owner's daily spend and bruteforce
// policy thresholds without burning order-creation budget.
router.get('/policy/check', orderPollLimiter, validatePolicyCheck, (req, res) => {
  return res.json(policyCheck(req.apiKey.id, parseFloat(String(req.query.amount).trim())));
});

module.exports = router;
