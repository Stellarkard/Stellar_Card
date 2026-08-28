/**
 * Tests for client-side encryption module (Issue #522 — Part 4).
 *
 * Covers:
 *   - encrypt / decrypt round-trip
 *   - Wrong passphrase is rejected
 *   - Tampered ciphertext is rejected
 *   - Each call produces unique salt and IV
 *   - Context binding prevents cross-purpose decryption
 *   - encryptStellarKey / decryptStellarKey convenience wrappers
 *   - reEncrypt: passphrase rotation
 *   - verifyPassphrase: returns true/false without exposing plaintext
 *   - Unsupported version throws
 */
import { describe, expect, it } from 'vitest';

import {
  decrypt,
  decryptStellarKey,
  encrypt,
  encryptStellarKey,
  reEncrypt,
  verifyPassphrase,
  type EncryptedPayload,
} from '../encryption';

// ── encrypt / decrypt round-trip ─────────────────────────────────────────────

describe('encrypt / decrypt round-trip', () => {
  it('decrypts back to the original plaintext', async () => {
    const plaintext = 'hello-world';
    const payload = await encrypt(plaintext, { passphrase: 'secret' });
    const result = await decrypt({ payload, passphrase: 'secret' });
    expect(result).toBe(plaintext);
  });

  it('handles empty string plaintext', async () => {
    const payload = await encrypt('', { passphrase: 'secret' });
    const result = await decrypt({ payload, passphrase: 'secret' });
    expect(result).toBe('');
  });

  it('handles unicode / non-ASCII plaintext', async () => {
    const plaintext = '🔑 Stellar: café résumé こんにちは';
    const payload = await encrypt(plaintext, { passphrase: 'unicode-pass' });
    const result = await decrypt({ payload, passphrase: 'unicode-pass' });
    expect(result).toBe(plaintext);
  });

  it('handles a long plaintext (>1 KB)', async () => {
    const plaintext = 'x'.repeat(2000);
    const payload = await encrypt(plaintext, { passphrase: 'long-pass' });
    const result = await decrypt({ payload, passphrase: 'long-pass' });
    expect(result).toBe(plaintext);
  });

  it('produces a payload with the expected fields', async () => {
    const payload = await encrypt('data', { passphrase: 'test' });
    expect(typeof payload.value).toBe('string');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.salt).toBe('string');
    expect(payload.version).toBe(1);
  });
});

// ── wrong passphrase ──────────────────────────────────────────────────────────

describe('wrong passphrase', () => {
  it('throws when passphrase is incorrect', async () => {
    const payload = await encrypt('secret-data', { passphrase: 'correct' });
    await expect(decrypt({ payload, passphrase: 'wrong' })).rejects.toThrow();
  });

  it('throws on empty passphrase when encrypted with non-empty', async () => {
    const payload = await encrypt('data', { passphrase: 'real-pass' });
    await expect(decrypt({ payload, passphrase: '' })).rejects.toThrow();
  });
});

// ── tampered ciphertext ───────────────────────────────────────────────────────

describe('tampered ciphertext', () => {
  it('throws when the ciphertext value is modified', async () => {
    const payload = await encrypt('sensitive', { passphrase: 'pass' });
    // Flip a character in the base64 ciphertext to simulate tampering
    const tampered: EncryptedPayload = {
      ...payload,
      value: payload.value.slice(0, -4) + 'AAAA',
    };
    await expect(decrypt({ payload: tampered, passphrase: 'pass' })).rejects.toThrow();
  });

  it('throws when the IV is swapped from another payload', async () => {
    const payload1 = await encrypt('data1', { passphrase: 'pass' });
    const payload2 = await encrypt('data2', { passphrase: 'pass' });
    const corrupted: EncryptedPayload = { ...payload1, iv: payload2.iv };
    await expect(decrypt({ payload: corrupted, passphrase: 'pass' })).rejects.toThrow();
  });
});

// ── salt and IV uniqueness ────────────────────────────────────────────────────

describe('salt and IV uniqueness', () => {
  it('generates a different salt on every call', async () => {
    const a = await encrypt('same', { passphrase: 'same' });
    const b = await encrypt('same', { passphrase: 'same' });
    expect(a.salt).not.toBe(b.salt);
  });

  it('generates a different IV on every call', async () => {
    const a = await encrypt('same', { passphrase: 'same' });
    const b = await encrypt('same', { passphrase: 'same' });
    expect(a.iv).not.toBe(b.iv);
  });

  it('produces different ciphertext on every call (semantic security)', async () => {
    const a = await encrypt('same-plaintext', { passphrase: 'same-pass' });
    const b = await encrypt('same-plaintext', { passphrase: 'same-pass' });
    expect(a.value).not.toBe(b.value);
  });
});

// ── context binding ───────────────────────────────────────────────────────────

describe('context binding', () => {
  it('decrypts correctly when context matches', async () => {
    const payload = await encrypt('data', { passphrase: 'pass', context: 'my-context' });
    const result = await decrypt({ payload, passphrase: 'pass', context: 'my-context' });
    expect(result).toBe('data');
  });

  it('fails to decrypt when context is omitted at decrypt time', async () => {
    const payload = await encrypt('data', { passphrase: 'pass', context: 'ctx' });
    await expect(decrypt({ payload, passphrase: 'pass' })).rejects.toThrow();
  });

  it('fails to decrypt when context differs', async () => {
    const payload = await encrypt('data', { passphrase: 'pass', context: 'ctx-a' });
    await expect(decrypt({ payload, passphrase: 'pass', context: 'ctx-b' })).rejects.toThrow();
  });
});

// ── encryptStellarKey / decryptStellarKey ─────────────────────────────────────

describe('encryptStellarKey / decryptStellarKey', () => {
  // A well-formed Stellar secret key starts with 'S' and is 56 chars
  const FAKE_SECRET = 'SCZANGBA5YHTNYVSK5XAZMGZZ26MQMZAAJXF7BZNLQQ5NCTWNX5';

  it('round-trips a Stellar secret key', async () => {
    const payload = await encryptStellarKey(FAKE_SECRET, 'wallet-pass');
    const result = await decryptStellarKey(payload, 'wallet-pass');
    expect(result).toBe(FAKE_SECRET);
  });

  it('uses stellar-secret context — cross-context decrypt fails', async () => {
    const payload = await encryptStellarKey(FAKE_SECRET, 'wallet-pass');
    // Trying to decrypt without the stellar-secret context should fail
    await expect(decrypt({ payload, passphrase: 'wallet-pass' })).rejects.toThrow();
  });

  it('throws on wrong passphrase', async () => {
    const payload = await encryptStellarKey(FAKE_SECRET, 'correct-pass');
    await expect(decryptStellarKey(payload, 'wrong-pass')).rejects.toThrow();
  });
});

// ── reEncrypt (passphrase rotation) ──────────────────────────────────────────

describe('reEncrypt', () => {
  it('produces a payload decryptable with the new passphrase', async () => {
    const original = await encrypt('my-secret', { passphrase: 'old-pass' });
    const rotated = await reEncrypt(original, 'old-pass', 'new-pass');
    const result = await decrypt({ payload: rotated, passphrase: 'new-pass' });
    expect(result).toBe('my-secret');
  // reEncrypt = decrypt + encrypt = 2 PBKDF2 derivations at 600K iterations each
  }, 15_000);

  it('old passphrase no longer decrypts after reEncrypt', async () => {
    const original = await encrypt('my-secret', { passphrase: 'old-pass' });
    const rotated = await reEncrypt(original, 'old-pass', 'new-pass');
    await expect(decrypt({ payload: rotated, passphrase: 'old-pass' })).rejects.toThrow();
  // reEncrypt = 2 derivations, then failed decrypt = 1 more = 3 total
  }, 15_000);

  it('preserves context through rotation', async () => {
    const original = await encrypt('data', { passphrase: 'old', context: 'ctx' });
    const rotated = await reEncrypt(original, 'old', 'new', 'ctx');
    const result = await decrypt({ payload: rotated, passphrase: 'new', context: 'ctx' });
    expect(result).toBe('data');
  // reEncrypt runs 3 PBKDF2 derivations (decrypt + encrypt) at 600K iterations each
  }, 15_000);

  it('throws when old passphrase is wrong', async () => {
    const original = await encrypt('data', { passphrase: 'correct' });
    await expect(reEncrypt(original, 'wrong', 'new-pass')).rejects.toThrow();
  });
});

// ── verifyPassphrase ──────────────────────────────────────────────────────────

describe('verifyPassphrase', () => {
  it('returns true for the correct passphrase', async () => {
    const payload = await encrypt('data', { passphrase: 'correct' });
    expect(await verifyPassphrase(payload, 'correct')).toBe(true);
  });

  it('returns false for an incorrect passphrase', async () => {
    const payload = await encrypt('data', { passphrase: 'correct' });
    expect(await verifyPassphrase(payload, 'wrong')).toBe(false);
  });

  it('returns false for an empty passphrase when encrypted with non-empty', async () => {
    const payload = await encrypt('data', { passphrase: 'correct' });
    expect(await verifyPassphrase(payload, '')).toBe(false);
  });

  it('handles context correctly — correct passphrase + context returns true', async () => {
    const payload = await encrypt('data', { passphrase: 'pass', context: 'ctx' });
    expect(await verifyPassphrase(payload, 'pass', 'ctx')).toBe(true);
  });

  it('returns false when context is missing at verify time', async () => {
    const payload = await encrypt('data', { passphrase: 'pass', context: 'ctx' });
    expect(await verifyPassphrase(payload, 'pass')).toBe(false);
  });
});

// ── unsupported version ───────────────────────────────────────────────────────

describe('unsupported version', () => {
  it('throws for version != 1', async () => {
    const payload = await encrypt('data', { passphrase: 'pass' });
    const future: EncryptedPayload = { ...payload, version: 99 };
    await expect(decrypt({ payload: future, passphrase: 'pass' })).rejects.toThrow(
      'Unsupported encryption version: 99',
    );
  });
});
