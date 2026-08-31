// @ts-check
// GET /api/version — deploy-time compatibility check (audit C-9).
//
// Unauthenticated and intentionally cheap: SDKs call it on startup to
// decide whether the server speaks a protocol they understand, and
// deploy tooling polls it to confirm a rollout landed. The rate limit is
// generous enough for both and low enough that it cannot be turned into
// a free amplification target.

const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');

const router = Router();

const versionLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

router.get('/api/version', versionLimiter, (_req, res) => {
  res.json({
    service: 'stellar_card',
    version: '0.1.0',
    hmac_protocol: 'v3',
    features: ['idempotency_key', 'soroban_contract', 'webhook_circuit_breaker', 'callback_nonce'],
  });
});

module.exports = router;
