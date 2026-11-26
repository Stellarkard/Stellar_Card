// @ts-check
// Small AES-256-GCM "secret box" used for at-rest encryption of
// short-lived secrets (agent claim payloads, VCC tokens, etc.).
//
// Format: "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>"
//
// Key source: first of these env vars that is set —
//   CARDS402_SECRET_BOX_KEY  (preferred, new)
//   VCC_TOKEN_KEY            (legacy, kept for backwards-compat)
// Each must be a 32-byte (64-hex) random value. Generate with:
//   openssl rand -hex 32
//
// If no key is configured, behaviour depends on NODE_ENV:
//
//   production → seal() throws. Silent plaintext fallback in prod is how
//                claim payloads (raw api keys + webhook secrets) ended up
//                stored plaintext in the 2026-04-13 adversarial audit
//                (finding F5). The claim endpoint's entire purpose is to
//                keep raw keys out of the DB and the chat transcript; if
//                the key is missing in prod, we refuse to seal at all so
//                the error surfaces at mint time rather than at restore.
//
//   test / dev → seal() returns plaintext (with a one-time warning). Local
//                workflows and the test suite don't set the key and
//                shouldn't need to.

const crypto = require('crypto');

const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

// #960: versioned sealed-blob format. New blobs are written as
//   "v1:<salt_hex>:<iv_hex>:<tag_hex>:<ciphertext_hex>"
// where the key is derived from the environment master secret plus the
// per-blob random salt via scrypt. The legacy "enc:<iv>:<tag>:<ct>"
// format (raw 32-byte key, no salt) is still accepted on read so rows
// written before this change keep decrypting.
const V1_PREFIX = 'v1';
const V1_BLOB_RE = /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;
const SALT_BYTES = 16;
const SALT_HEX_LEN = SALT_BYTES * 2;
// scrypt cost parameters. N=2^15 keeps derivation well under ~100ms on
// commodity hardware while making offline brute force of a weak master
// secret expensive. r/p follow the scrypt paper's defaults.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
// scrypt's memory use is ~128 * N * r bytes; Node's default maxmem
// (32 MiB) is too small for N=32768, r=8 (~32 MiB + overhead), so raise
// it explicitly.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
=======

// Adversarial audit F1-secret-box (2026-04-15): strict regex for the
// "already sealed" idempotency check in seal(). The previous impl
// used `startsWith('enc:')`, so a plaintext value that happened to
// start with "enc:" (e.g. "enc:my_secret_payload") was returned
// verbatim instead of being encrypted. The caller would think the
// value was sealed, but the DB would hold plaintext. No current
// call site passes such input, but the check should verify the
// full format of a real sealed blob rather than just the marker
// prefix. A match requires the enc: literal plus three
// colon-separated hex fields — exactly the shape seal() produces.
const SEALED_BLOB_RE = /^enc:[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

// Adversarial audit F2-secret-box (2026-04-15): AES-256-GCM uses
// a 12-byte IV (24 hex chars) and a 16-byte authentication tag
// (32 hex chars). These are CONSTANT for every blob this module
// produces — seal() always generates crypto.randomBytes(12) for
// the IV and AES-GCM always emits a 16-byte tag at authTagLength:
// 16. The open() path must enforce both lengths BEFORE calling
// setAuthTag, because Node's setAuthTag passes through to OpenSSL's
// EVP_CTRL_GCM_SET_TAG which accepts any tag length from 4 to 16
// bytes and silently downgrades authentication strength to match.
// A sealed blob with a 4-byte tag (`enc:<iv>:<4-byte-tag>:<ct>`)
// would be accepted by the old code and authenticated at 32-bit
// strength — forgeable with ~2^32 attempts. The previous code
// comment claimed "Crypto layer enforces IV length / tag length"
// but that claim was incorrect for Node's setAuthTag surface.
// Making it true with explicit length checks.
const IV_HEX_LEN = 24; // 12 bytes
const TAG_HEX_LEN = 32; // 16 bytes

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// F1 fix: strict-validate any key env var that is set, regardless of
// whether it's the preferred or the legacy name. env.js already
// validates CARDS402_SECRET_BOX_KEY via zod, but the legacy
// VCC_TOKEN_KEY name is not enumerated in the schema — so a typo
// (wrong length or non-hex chars) would silently fall through to the
// dev/test plaintext-fallback path and the operator would think
// encryption was enabled when it wasn't. Validating at module load
// means the next seal()/open() call sees a hard failure rather than a
// confusing silent downgrade.
//
// F2: if both names are set to DIFFERENT values, warn loudly. Operators
// rotating by adding a new var without unsetting the old one otherwise
// get no signal that their rotation didn't cover the legacy fallback.
function loadKeyFromEnv() {
  const preferred = process.env.CARDS402_SECRET_BOX_KEY;
  const legacy = process.env.VCC_TOKEN_KEY;
  for (const [name, val] of [
    ['CARDS402_SECRET_BOX_KEY', preferred],
    ['VCC_TOKEN_KEY', legacy],
  ]) {
    if (val && !KEY_HEX_RE.test(val)) {
      throw new Error(
        `secret-box: ${name} must be 64 hex characters (32 bytes). ` +
          `Generate one with \`openssl rand -hex 32\`.`,
      );
    }
  }
  if (preferred && legacy && preferred !== legacy) {
    console.warn(
      '[secret-box] both CARDS402_SECRET_BOX_KEY and VCC_TOKEN_KEY are set ' +
        'to different values — using CARDS402_SECRET_BOX_KEY. Unset the ' +
        'legacy VCC_TOKEN_KEY to remove this warning.',
    );
  }
  const hex = preferred || legacy;
  if (!hex) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * #960: load the master secret used for v1 (salt-derived) blobs. The
 * master secret is an arbitrary-length string; it is NOT the raw AES
 * key — the AES key is derived per-blob via scrypt(master, salt). This
 * lets operators rotate the master secret without re-keying every row
 * by hand (see rotateKey()).
 *
 * Resolution order:
 *   CARDS402_SECRET_BOX_MASTER_SECRET  (preferred, new)
 *   CARDS402_SECRET_BOX_KEY            (64-hex legacy key, reused as master)
 *   VCC_TOKEN_KEY                      (legacy, kept for backwards-compat)
 *
 * Returns null when none are set.
 */
function loadMasterSecret() {
  const master = process.env.CARDS402_SECRET_BOX_MASTER_SECRET;
  if (master) {
    if (master.length < 16) {
      throw new Error(
        'secret-box: CARDS402_SECRET_BOX_MASTER_SECRET must be at least 16 characters. ' +
          'Generate one with `openssl rand -hex 32`.',
      );
    }
    return master;
  }
  // Fall back to the legacy 64-hex key as the master secret so existing
  // deployments keep working without a new env var.
  const hex = process.env.CARDS402_SECRET_BOX_KEY || process.env.VCC_TOKEN_KEY;
  if (!hex) return null;
  if (!KEY_HEX_RE.test(hex)) {
    throw new Error(
      'secret-box: CARDS402_SECRET_BOX_KEY / VCC_TOKEN_KEY must be 64 hex characters (32 bytes). ' +
        'Generate one with `openssl rand -hex 32`.',
    );
  }
  return hex;
}

/**
 * Derive a 32-byte AES key from a master secret and a per-blob salt
 * using scrypt. The returned Buffer is the caller's to zeroize.
 * @param {string} master
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(master, salt) {
  return crypto.scryptSync(master, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

function getKey() {
  // Re-read the env on every call so tests that mutate process.env
  // between cases see fresh values. The validation loop above is
  // cheap — two regex tests and a string compare.
  return loadKeyFromEnv();
}

let warnedAboutMissingKey = false;

/**
 * Seal a plaintext secret. Returns the stored form; idempotent for
 * already-sealed values. Throws in production when no key is configured
 * so callers cannot accidentally persist plaintext credentials.
 * @param {string} plaintext
 */
function seal(plaintext) {
  if (typeof plaintext !== 'string') throw new Error('seal: plaintext must be a string');
  // F1-secret-box: full-format idempotency check. A plaintext that
  // merely starts with "enc:" is NOT a sealed blob and MUST be
  // encrypted, not returned verbatim. SEALED_BLOB_RE requires the
  // four-part colon-separated hex shape seal() actually produces.
  if (SEALED_BLOB_RE.test(plaintext)) return plaintext; // already sealed
  const key = getKey();
  if (!key) {
    if (isProduction()) {
      throw new Error(
        'secret-box: CARDS402_SECRET_BOX_KEY is required in production. ' +
          'Generate one with `openssl rand -hex 32` and set it in the environment ' +
          'before restarting the backend.',
      );
    }
    if (!warnedAboutMissingKey) {
      console.warn(
        '[secret-box] CARDS402_SECRET_BOX_KEY not set — sealing as plaintext (dev/test only)',
      );
      warnedAboutMissingKey = true;
    }
    return plaintext;
  }
  const data = Buffer.from(plaintext, 'utf8');
  try {
    return sealBytes(data, key);
  } finally {
    // #595: wipe the transient plaintext and key copies. The caller's
    // JS string is immutable and can't be wiped — callers holding raw
    // card secrets should prefer sealBuffer() with a Buffer they own.
    zeroize(data);
    zeroize(key);
  }
}

/**
 * #960: seal a plaintext secret into the versioned v1 format using a
 * per-blob random salt and a scrypt-derived key. This is the preferred
 * entry point for new CVV / card-secret writes. Falls back to the
 * legacy seal() behaviour when no master secret is configured (dev/test
 * plaintext fallback, or prod throw) so callers can migrate gradually.
 * @param {string} plaintext
 */
function sealV1(plaintext) {
  if (typeof plaintext !== 'string') throw new Error('sealV1: plaintext must be a string');
  if (V1_BLOB_RE.test(plaintext) || SEALED_BLOB_RE.test(plaintext)) return plaintext;
  const master = loadMasterSecret();
  if (!master) {
    // No master secret: defer to seal() so prod still throws and
    // dev/test still gets the plaintext fallback with its warning.
    return seal(plaintext);
  }
  const data = Buffer.from(plaintext, 'utf8');
  const salt = crypto.randomBytes(SALT_BYTES);
  let key = null;
  try {
    key = deriveKey(master, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    try {
      return `${V1_PREFIX}:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString(
        'hex',
      )}:${ct.toString('hex')}`;
    } finally {
      zeroize(ct);
    }
  } finally {
    zeroize(data);
    zeroize(salt);
    zeroize(key);
  }
}

/**
 * Overwrite a Buffer / typed array with zeros in place (#595).
 * No-op for null/undefined; returns the same buffer for chaining.
 * @template {Uint8Array | null | undefined} T
 * @param {T} buf
 * @returns {T}
 */
function zeroize(buf) {
  if (buf && typeof buf.fill === 'function') buf.fill(0);
  return buf;
}

/**
 * Encrypt raw bytes with AES-256-GCM (12-byte random IV, 16-byte tag)
 * into the "enc:<iv>:<tag>:<ct>" format. Intermediate ciphertext
 * buffers are hex-encoded and then wiped.
 * @param {Buffer} data
 * @param {Buffer} key
 */
function sealBytes(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  try {
    return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
  } finally {
    zeroize(ct);
  }
}

/**
 * Seal secret bytes the caller owns (#595). Unlike seal(), the input
 * never becomes a JS string. With `{ wipe: true }` the input buffer is
 * zeroized after encryption (and on failure), so the caller doesn't
 * have to remember to.
 *
 * Same key rules as seal(): throws in production without a key; in
 * dev/test without a key returns the plaintext as a UTF-8 string.
 * @param {Buffer} data
 * @param {{ wipe?: boolean }} [opts]
 */
function sealBuffer(data, opts = {}) {
  if (!Buffer.isBuffer(data)) throw new Error('sealBuffer: data must be a Buffer');
  try {
    const key = getKey();
    if (!key) return seal(data.toString('utf8'));
    try {
      return sealBytes(data, key);
    } finally {
      zeroize(key);
    }
  } finally {
    if (opts.wipe) zeroize(data);
  }
}

/**
 * Open a sealed secret. Returns the plaintext. Pass-through for
 * non-sealed values (so old plaintext rows on upgrade still work).
 * Throws on tampered ciphertext via the GCM tag check, and on
 * malformed stored blobs before reaching the crypto layer so the
 * caller sees a clear "malformed sealed blob" error instead of a
 * generic `Buffer.from: first argument must be of type string`.
 * @param {string} stored
 */
function open(stored) {
  if (typeof stored !== 'string') throw new Error('open: stored must be a string');
  if (stored.startsWith(`${V1_PREFIX}:`)) {
    const plain = openV1ToBuffer(stored);
    try {
      return plain.toString('utf8');
    } finally {
      zeroize(plain);
    }
  }
  if (!stored.startsWith('enc:')) return stored;
  const { key, ivHex, tagHex, ctHex } = parseSealed(stored);
  const plain = decryptBytes(key, ivHex, tagHex, ctHex);
  try {
    return plain.toString('utf8');
  } finally {
    // #595: wipe the decrypted bytes and the key copy.
    zeroize(plain);
  }
}

/**
 * #960: decrypt a v1 blob into a Buffer the caller owns. Validates the
 * blob shape and salt/IV/tag lengths before touching the crypto layer,
 * then derives the key from the master secret and the stored salt.
 * @param {string} stored
 * @returns {Buffer}
 */
function openV1ToBuffer(stored) {
  const master = loadMasterSecret();
  if (!master) {
    throw new Error(
      'secret-box: CARDS402_SECRET_BOX_MASTER_SECRET (or CARDS402_SECRET_BOX_KEY) not set, cannot decrypt v1 blob. ' +
        'Generate one with `openssl rand -hex 32` and set it in the environment.',
    );
  }
  const parts = stored.split(':');
  if (parts.length !== 5) {
    throw new Error(
      `secret-box: malformed v1 sealed blob (expected 5 colon-separated parts, got ${parts.length})`,
    );
  }
  const [, saltHex, ivHex, tagHex, ctHex] = parts;
  if (
    !/^[0-9a-f]+$/i.test(saltHex) ||
    !/^[0-9a-f]+$/i.test(ivHex) ||
    !/^[0-9a-f]+$/i.test(tagHex) ||
    !/^[0-9a-f]*$/i.test(ctHex)
  ) {
    throw new Error(
      'secret-box: malformed v1 sealed blob (non-hex characters in salt/iv/tag/ciphertext)',
    );
  }
  if (saltHex.length !== SALT_HEX_LEN) {
    throw new Error(
      `secret-box: malformed v1 sealed blob (salt is ${saltHex.length / 2} bytes, expected ${SALT_BYTES})`,
    );
  }
  if (ivHex.length !== IV_HEX_LEN) {
    throw new Error(
      `secret-box: malformed v1 sealed blob (IV is ${ivHex.length / 2} bytes, expected 12)`,
    );
  }
  if (tagHex.length !== TAG_HEX_LEN) {
    throw new Error(
      `secret-box: malformed v1 sealed blob (auth tag is ${tagHex.length / 2} bytes, expected 16)`,
    );
  }
  const salt = Buffer.from(saltHex, 'hex');
  let key = null;
  try {
    key = deriveKey(master, salt);
    return decryptBytes(key, ivHex, tagHex, ctHex);
  } finally {
    zeroize(salt);
    zeroize(key);
  }
}

/**
 * AES-256-GCM decrypt to a Buffer. Always wipes the key and the
 * ciphertext copy; the returned plaintext buffer is the caller's to
 * wipe. Throws on a bad auth tag (tamper / wrong key).
 * @param {Buffer} key
 * @param {string} ivHex
 * @param {string} tagHex
 * @param {string} ctHex
 */
function decryptBytes(key, ivHex, tagHex, ctHex) {
  const ct = Buffer.from(ctHex, 'hex');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const head = decipher.update(ct);
    const tail = decipher.final();
    const out = Buffer.concat([head, tail]);
    zeroize(head);
    zeroize(tail);
    return out;
  } finally {
    zeroize(ct);
    zeroize(key);
  }
}

/**
 * Open a sealed secret straight into a Buffer the caller owns (#595),
 * so the plaintext never becomes an immutable JS string. The caller
 * MUST zeroize() it when done (card-vault's withOpenedCard does this
 * automatically). Unsealed legacy values are returned as a Buffer copy.
 * @param {string} stored
 * @returns {Buffer}
 */
function openToBuffer(stored) {
  if (typeof stored !== 'string') throw new Error('openToBuffer: stored must be a string');
  if (stored.startsWith(`${V1_PREFIX}:`)) return openV1ToBuffer(stored);
  if (!stored.startsWith('enc:')) return Buffer.from(stored, 'utf8');
  const { key, ivHex, tagHex, ctHex } = parseSealed(stored);
  return decryptBytes(key, ivHex, tagHex, ctHex);
}

/**
 * #960: re-encrypt a stored secret under a new master secret. Decrypts
 * `stored` using the CURRENT environment master secret, then re-seals
 * the plaintext into the v1 format using `newMasterSecret`. Returns the
 * new stored string; the caller is responsible for persisting it.
 *
 * Plaintext (unsealed) values are sealed under the new master secret
 * directly, so this doubles as a migration helper for legacy rows.
 *
 * Throws if `stored` cannot be decrypted under the current master
 * secret (tampered blob, wrong key) — rotation must never silently
 * drop or corrupt a record.
 * @param {string} stored
 * @param {string} newMasterSecret
 * @returns {string}
 */
function rotateKey(stored, newMasterSecret) {
  if (typeof stored !== 'string') throw new Error('rotateKey: stored must be a string');
  if (typeof newMasterSecret !== 'string' || newMasterSecret.length < 16) {
    throw new Error('rotateKey: newMasterSecret must be a string of at least 16 characters');
  }
  // Decrypt under the current master secret. Plaintext rows pass
  // through open() unchanged; sealed rows are authenticated first.
  const plain = openToBuffer(stored);
  try {
    const salt = crypto.randomBytes(SALT_BYTES);
    let key = null;
    try {
      key = deriveKey(newMasterSecret, salt);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      try {
        return `${V1_PREFIX}:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString(
          'hex',
        )}:${ct.toString('hex')}`;
      } finally {
        zeroize(ct);
      }
    } finally {
      zeroize(salt);
      zeroize(key);
    }
  } finally {
    zeroize(plain);
  }
}


/**
 * Validate a sealed blob's shape and load the key. Shared by open() and
 * openToBuffer() so both enforce the same IV / tag length rules.
 * @param {string} stored
 */
function parseSealed(stored) {
  const key = getKey();
  if (!key) {
    throw new Error(
      'secret-box: CARDS402_SECRET_BOX_KEY not set, cannot decrypt. Generate one with `openssl rand -hex 32` and set it in the environment.',
    );
  }
  // Expected format: enc:<iv_hex>:<tag_hex>:<ct_hex> — exactly four
  // colon-separated parts, each the middle three being pure hex. A
  // truncated row (common failure mode for a half-written UPDATE or a
  // partial restore) used to land in Buffer.from(undefined, 'hex') and
  // throw an opaque TypeError; validate the shape here so the caller
  // sees a specific "malformed sealed blob" error and can handle it
  // (log the row, surface a 500 with context, skip the row, etc.).
  const parts = stored.split(':');
  if (parts.length !== 4) {
    throw new Error(
      `secret-box: malformed sealed blob (expected 4 colon-separated parts, got ${parts.length})`,
    );
  }
  const [, ivHex, tagHex, ctHex] = parts;
  if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(tagHex) || !/^[0-9a-f]*$/i.test(ctHex)) {
    throw new Error('secret-box: malformed sealed blob (non-hex characters in iv/tag/ciphertext)');
  }
  // F2-secret-box: enforce exact IV (12 bytes / 24 hex) and tag
  // (16 bytes / 32 hex) lengths before handing off to setAuthTag.
  // Node's setAuthTag passes through to OpenSSL which accepts any
  // GCM tag length from 4-16 bytes and silently downgrades the
  // authentication strength to match — a 4-byte tag drops forgery
  // resistance from 2^128 to 2^32. The previous comment here
  // claimed the crypto layer enforced these lengths, but it does
  // not for setAuthTag. Make the claim true at this layer.
  if (ivHex.length !== IV_HEX_LEN) {
    throw new Error(
      `secret-box: malformed sealed blob (IV is ${ivHex.length / 2} bytes, expected 12)`,
    );
  }
  if (tagHex.length !== TAG_HEX_LEN) {
    throw new Error(
      `secret-box: malformed sealed blob (auth tag is ${tagHex.length / 2} bytes, expected 16)`,
    );
  }
  return { key, ivHex, tagHex, ctHex };
}

/** True if a box key is configured (so callers can refuse to seal plaintext in prod). */
function hasKey() {
  const key = getKey();
  zeroize(key);
  return key !== null;
}

module.exports = {
  seal,
  open,
  hasKey,
  sealBuffer,
  openToBuffer,
  zeroize,
  // #960: versioned (salt-derived) format + key rotation.
  sealV1,
  rotateKey,
};
