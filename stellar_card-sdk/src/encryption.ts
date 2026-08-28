/**
 * Secure client-side encryption for key storage (Issue #532 — Part 5).
 *
 * Provides AES-256-GCM encryption/decryption using the Web Crypto API
 * for encrypting Stellar secret keys and other sensitive data at rest.
 *
 * Uses PBKDF2 for key derivation from a passphrase, and AES-256-GCM
 * for authenticated encryption. Each encryption operation generates a
 * fresh random IV and salt, producing ciphertext that is safe to store
 * on disk or in configuration files.
 *
 * @example
 * ```typescript
 * import { encrypt, decrypt } from './encryption';
 *
 * // Encrypt a secret key with a passphrase
 * const encrypted = await encrypt(secretKey, 'my-passphrase');
 *
 * // Store encrypted.value and encrypted.salt + encrypted.iv as needed
 *
 * // Decrypt later
 * const decrypted = await decrypt(encrypted, 'my-passphrase');
 * // decrypted === secretKey
 * ```
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** PBKDF2 iteration count — OWASP recommends ≥600,000 for SHA-256 (2023+). */
const PBKDF2_ITERATIONS = 600_000;

/** Salt length in bytes. */
const SALT_BYTES = 32;

/** IV/nonce length in bytes for AES-GCM. */
const IV_BYTES = 12;

/** AES-256-GCM key length in bits. */
const KEY_LENGTH_BITS = 256;

/** Algorithm identifiers for Web Crypto API. */
const PBKDF2_ALGO = 'PBKDF2';
const AES_GCM_ALGO = 'AES-GCM';
const SHA_256 = 'SHA-256';

// ── Types ────────────────────────────────────────────────────────────────────

/** Encrypted payload — safe to serialize to JSON and store on disk. */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext (includes the AES-GCM auth tag). */
  value: string;
  /** Base64-encoded IV/nonce used for this encryption. */
  iv: string;
  /** Base64-encoded PBKDF2 salt used to derive the encryption key. */
  salt: string;
  /** Version of the encryption scheme (for future migration). */
  version: number;
}

/** Options for the encrypt function. */
export interface EncryptOptions {
  /** Passphrase to derive the encryption key from. */
  passphrase: string;
  /**
   * Optional context string mixed into the PBKDF2 derivation via
   * HKDF-like label binding. Useful when the same passphrase encrypts
   * different data types (e.g. "stellar-secret" vs "config-api-key").
   */
  context?: string;
}

/** Options for the decrypt function. */
export interface DecryptOptions {
  /** The encrypted payload returned by {@link encrypt}. */
  payload: EncryptedPayload;
  /** Passphrase that was used to encrypt the data. */
  passphrase: string;
  /** Must match the `context` passed to {@link encrypt} if one was used. */
  context?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Encode a Uint8Array to base64.
 */
function toBase64(bytes: Uint8Array): string {
  // Node.js 18+ and all modern browsers support btoa on binary strings.
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to Uint8Array.
 */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Concatenate two Uint8Arrays.
 */
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Derive an AES-256 key from a passphrase using PBKDF2.
 *
 * @param passphrase - The user's passphrase.
 * @param salt - Random salt bytes.
 * @param context - Optional context string to bind the derived key to a
 *   specific use case. Prepended to the passphrase as `context:passphrase`
 *   before PBKDF2.
 * @returns A CryptoKey suitable for AES-GCM encrypt/decrypt.
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  context?: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const label = context ? `${context}:${passphrase}` : passphrase;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(label),
    PBKDF2_ALGO,
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: PBKDF2,
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: SHA_256,
    },
    keyMaterial,
    { name: AES_GCM_ALGO, length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate cryptographically secure random bytes.
 */
function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM with a passphrase-derived key.
 *
 * Each call generates a fresh random salt and IV, so encrypting the same
 * plaintext twice with the same passphrase produces different ciphertext.
 * The salt and IV are included in the returned {@link EncryptedPayload}
 * and are not secret — they are needed for decryption.
 *
 * @param plaintext - The string to encrypt (e.g., a Stellar secret key).
 * @param options - Passphrase and optional context for key derivation.
 * @returns An {@link EncryptedPayload} safe for JSON serialization and disk storage.
 *
 * @example
 * ```typescript
 * const payload = await encrypt('S...", { passphrase: 'correct-horse-battery-staple' });
 * fs.writeFileSync('key.enc', JSON.stringify(payload));
 * ```
 */
export async function encrypt(
  plaintext: string,
  options: EncryptOptions,
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(options.passphrase, salt, options.context);

  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_GCM_ALGO, iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    value: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    version: 1,
  };
}

/**
 * Decrypt an {@link EncryptedPayload} that was produced by {@link encrypt}.
 *
 * @param options - The encrypted payload, passphrase, and matching context.
 * @returns The original plaintext string.
 * @throws {Error} When decryption fails (wrong passphrase, tampered ciphertext, etc.).
 *
 * @example
 * ```typescript
 * const secret = await decrypt({ payload, passphrase: 'correct-horse-battery-staple' });
 * const keypair = Keypair.fromSecret(secret);
 * ```
 */
export async function decrypt(options: DecryptOptions): Promise<string> {
  const { payload, passphrase, context } = options;

  if (payload.version !== 1) {
    throw new Error(`Unsupported encryption version: ${payload.version}`);
  }

  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.value);
  const key = await deriveKey(passphrase, salt, context);

  const plaintext = await crypto.subtle.decrypt(
    { name: AES_GCM_ALGO, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Encrypt a Stellar secret key with context binding to prevent misuse.
 *
 * Convenience wrapper around {@link encrypt} that automatically sets the
 * context to `"stellar-secret"` so the derived key is bound to this
 * specific use case.
 *
 * @param secretKey - A Stellar secret key (S...).
 * @param passphrase - The passphrase for encryption.
 * @returns An {@link EncryptedPayload} safe for storage.
 */
export async function encryptStellarKey(
  secretKey: string,
  passphrase: string,
): Promise<EncryptedPayload> {
  return encrypt(secretKey, { passphrase, context: 'stellar-secret' });
}

/**
 * Decrypt a Stellar secret key encrypted with {@link encryptStellarKey}.
 *
 * @param payload - The encrypted payload from {@link encryptStellarKey}.
 * @param passphrase - The passphrase used during encryption.
 * @returns The decrypted Stellar secret key (S...).
 * @throws {Error} When decryption fails.
 */
export async function decryptStellarKey(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<string> {
  return decrypt({ payload, passphrase, context: 'stellar-secret' });
}

/**
 * Re-encrypt a payload with a new passphrase.
 *
 * Decrypts with the old passphrase, then re-encrypts with the new one.
 * Useful for passphrase rotation without exposing the plaintext.
 *
 * @param payload - The existing encrypted payload.
 * @param oldPassphrase - The current passphrase.
 * @param newPassphrase - The new passphrase to encrypt with.
 * @param context - Optional context (must match the original encryption context).
 * @returns A new {@link EncryptedPayload} encrypted with the new passphrase.
 */
export async function reEncrypt(
  payload: EncryptedPayload,
  oldPassphrase: string,
  newPassphrase: string,
  context?: string,
): Promise<EncryptedPayload> {
  const plaintext = await decrypt({ payload, passphrase: oldPassphrase, context });
  return encrypt(plaintext, { passphrase: newPassphrase, context });
}

/**
 * Verify that a passphrase can decrypt a payload without exposing the plaintext.
 *
 * Useful for validating a passphrase before attempting a full decrypt
 * (e.g., at wallet unlock time).
 *
 * @param payload - The encrypted payload to verify against.
 * @param passphrase - The passphrase to test.
 * @param context - Optional context (must match the original encryption context).
 * @returns `true` if the passphrase is correct, `false` otherwise.
 */
export async function verifyPassphrase(
  payload: EncryptedPayload,
  passphrase: string,
  context?: string,
): Promise<boolean> {
  try {
    await decrypt({ payload, passphrase, context });
    return true;
  } catch {
    return false;
  }
}
