// @ts-check
// Parse the Authorization: Payment credential per the MPP spec.
//
// The credential is an RFC 7235-style auth header:
//   Authorization: Payment scheme="stellar", challenge="mpp_c_...", tx_hash="abc...", nonce="deadbeef..."
//
// Parameters are comma-separated key=value pairs. Values may be quoted
// or bare. Whitespace around separators is tolerated. Unknown extra
// params are ignored (forward-compat for future MPP extensions).
//
// This module also issues and validates scoped, time-limited JWT
// credentials for verified AI agents (HMAC SHA-256, compact JWS format).

const crypto = require('crypto');

/** Default credential lifetime: 1 hour. */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * @typedef {object} ParsedCredential
 * @property {string} scheme - Payment method scheme (e.g. 'stellar')
 * @property {string} challenge - Challenge id the credential is paying against
 * @property {string} txHash - On-chain tx hash proving the payment
 * @property {string} nonce - 32-byte hex random nonce (replay protection)
 */

/**
 * Parse an Authorization: Payment header value.
 * @param {string|undefined} header
 * @returns {{ok: true, credential: ParsedCredential} | {ok: false, reason: string}}
 */
function parsePaymentCredential(header) {
  if (typeof header !== 'string' || header.length === 0) {
    return { ok: false, reason: 'missing_header' };
  }
  // Scheme comparison is case-insensitive per HTTP spec (§4.2 of RFC 7235).
  // Strip leading 'Payment' token then parse params.
  const match = header.match(/^Payment\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'not_payment_scheme' };
  const paramString = match[1].trim();
  if (paramString.length === 0) return { ok: false, reason: 'empty_params' };

  const params = /** @type {Record<string,string>} */ ({});
  // Split on commas that aren't inside quotes. Since quoted values can
  // technically contain commas (RFC 7235 quoted-string), we tokenise
  // char-by-char rather than naïvely splitting.
  for (const token of splitAuthParams(paramString)) {
    const eq = token.indexOf('=');
    if (eq < 0) return { ok: false, reason: 'malformed_param' };
    const key = token.slice(0, eq).trim().toLowerCase();
    let value = token.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    if (!key) return { ok: false, reason: 'empty_key' };
    // Reject duplicate params — ambiguous, and an attacker could smuggle
    // a second challenge= to override the first after partial parsing.
    if (key in params) return { ok: false, reason: `duplicate_param:${key}` };
    params[key] = value;
  }

  const scheme = params['scheme'];
  const challenge = params['challenge'];
  const txHash = params['tx_hash'];
  const nonce = params['nonce'];

  if (!scheme) return { ok: false, reason: 'missing_scheme' };
  if (!challenge) return { ok: false, reason: 'missing_challenge' };
  if (!txHash) return { ok: false, reason: 'missing_tx_hash' };
  if (!nonce) return { ok: false, reason: 'missing_nonce' };

  // Sanity-check challenge id shape — we only emit mpp_c_... ids.
  if (!/^mpp_c_[A-Za-z0-9_-]+$/.test(challenge)) {
    return { ok: false, reason: 'malformed_challenge_id' };
  }
  // Stellar tx hashes are 64 hex chars. Reject anything else — a
  // wrongly-sized value can't identify a tx and might smuggle control
  // bytes into logs / RPC requests.
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: 'malformed_tx_hash' };
  }
  // Nonce must be exactly 32 bytes (64 hex chars) of randomness.
  if (!/^[0-9a-fA-F]{64}$/.test(nonce)) {
    return { ok: false, reason: 'malformed_nonce' };
  }
  if (scheme.toLowerCase() !== 'stellar') {
    return { ok: false, reason: `unsupported_scheme:${scheme}` };
  }

  return {
    ok: true,
    credential: { scheme: scheme.toLowerCase(), challenge, txHash, nonce: nonce.toLowerCase() },
  };
}

/**
 * Split an RFC 7235 auth parameter string on commas, respecting quoted
 * values. Returns an array of raw key=value tokens.
 * @param {string} s
 */
function splitAuthParams(s) {
  const out = [];
  let buf = '';
  let inQuote = false;
  let escape = false;
  for (const ch of s) {
    if (escape) {
      buf += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      buf += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      buf += ch;
      inQuote = !inQuote;
      continue;
    }
    if (ch === ',' && !inQuote) {
      if (buf.trim().length > 0) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

/**
 * Resolve the HMAC secret used to sign agent credentials. Prefers the
 * dedicated MPP_CREDENTIAL_SECRET, falling back to VCC_CALLBACK_SECRET
 * for deployments that haven't provisioned a separate key yet.
 * @returns {string}
 */
function getCredentialSecret() {
  const secret = process.env.MPP_CREDENTIAL_SECRET || process.env.VCC_CALLBACK_SECRET;
  if (!secret) {
    throw new Error('MPP_CREDENTIAL_SECRET (or VCC_CALLBACK_SECRET) must be set');
  }
  return secret;
}

/** @param {string|Buffer} input @returns {string} base64url encoding */
function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

/** @param {string} input @returns {Buffer} */
function base64urlDecode(input) {
  return Buffer.from(input, 'base64url');
}

/**
 * Sign a compact JWT (JWS, HMAC SHA-256) credential for a verified agent.
 * @param {{agentId: string, scope: string|object, ttlMs?: number}} opts
 * @returns {string} compact JWT
 */
function signCredential({ agentId, scope, ttlMs = DEFAULT_TTL_MS }) {
  if (typeof agentId !== 'string' || agentId.length === 0) {
    throw new Error('agentId is required');
  }
  if (scope === undefined || scope === null) {
    throw new Error('scope is required');
  }
  const now = Date.now();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: agentId,
    scope,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000),
    jti: crypto.randomBytes(16).toString('hex'),
  };
  const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(
    JSON.stringify(payload)
  )}`;
  const signature = crypto
    .createHmac('sha256', getCredentialSecret())
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

/**
 * Verify a compact JWT credential issued by signCredential.
 * @param {string|undefined} token
 * @returns {{ok: true, claims: object} | {ok: false, reason: string}}
 */
function verifyCredential(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'missing_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }
  if (!header || header.alg !== 'HS256') {
    return { ok: false, reason: 'unsupported_alg' };
  }

  const expected = crypto
    .createHmac('sha256', getCredentialSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let provided;
  try {
    provided = base64urlDecode(signatureB64);
  } catch {
    return { ok: false, reason: 'malformed_signature' };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, claims: payload };
}

module.exports = { parsePaymentCredential, signCredential, verifyCredential };
