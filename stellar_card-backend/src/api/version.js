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
const rateLimitHandler = require('../middleware/rateLimitHandler');

const router = Router();

const versionLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('Version endpoint rate limit exceeded. Retry in a minute.'),
});

// The single source of truth for "what does this deploy speak". Exported
// so api/openapi.js can stamp the same version into the published spec —
// a spec whose info.version disagrees with GET /api/version is worse than
// an undated one, because tooling trusts it to pick a client.
const VERSION_PAYLOAD = Object.freeze({
  service: 'stellar_card',
  version: '0.1.0',
  hmac_protocol: 'v3',
  features: Object.freeze([
    'idempotency_key',
    'soroban_contract',
    'webhook_circuit_breaker',
    'callback_nonce',
  ]),
});

/**
 * @openapi
 * /api/version:
 *   get:
 *     tags: [System]
 *     summary: Service version and enabled features
 *     description: Unauthenticated — used for deploy-time compatibility checks.
 *     responses:
 *       200:
 *         description: Version info.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 service: { type: string, example: stellar_card }
 *                 version: { type: string, example: 0.1.0 }
 *                 hmac_protocol: { type: string, example: v3 }
 *                 features:
 *                   type: array
 *                   items: { type: string }
 */
router.get('/api/version', versionLimiter, (_req, res) => {
  res.json(VERSION_PAYLOAD);
});

module.exports = router;
module.exports.VERSION_PAYLOAD = VERSION_PAYLOAD;
